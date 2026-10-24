import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../errors/domain.error';
import type { AuthIdentity, ChallengeDto, InitialEmailVerification, UserDto, VerificationChannel } from './identity.types';
import type { InitialEmailRequest, InitialEmailVerificationRequester } from './notifications/initial-email-verification';
import type { VerificationDelivery } from './notifications/verification-delivery';
import type { PostgresVerificationRepository, VerificationUser } from './verification.repository';
import { validateChannel, validateConfirmation } from './validators/verification.validator';

export class VerificationService implements InitialEmailVerificationRequester {
  private readonly key: string;

  constructor(
    private readonly repository: PostgresVerificationRepository,
    private readonly delivery: VerificationDelivery,
    key: string | undefined = process.env.VERIFICATION_HMAC_KEY,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!key || Buffer.byteLength(key, 'utf8') < 32) {
      throw new Error('VERIFICATION_HMAC_KEY deve conter ao menos 32 bytes e permanecer fora do banco.');
    }
    this.key = key;
  }

  private hmac(userId: string, channel: VerificationChannel, id: string, code: string): string {
    return createHmac('sha256', this.key).update(`${userId}:${channel}:${id}:${code}`).digest('hex');
  }

  private requireEmail(user: VerificationUser, channel: VerificationChannel): void {
    if (channel === 'phone' && !user.email_verified_at) {
      throw new DomainError('EMAIL_VERIFICATION_REQUIRED', 'Confirme o e-mail antes de verificar o telefone.', {});
    }
  }

  private deliveryLimitError(code: 'VERIFICATION_RATE_LIMITED' | 'VERIFICATION_DELIVERY_BLOCKED', until: Date, now: Date) {
    return new DomainError(code, code === 'VERIFICATION_DELIVERY_BLOCKED'
      ? 'Envios bloqueados temporariamente. Tente novamente mais tarde.'
      : 'Limite de envios atingido. Tente novamente mais tarde.', {
      retry_after_seconds: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)),
      retry_at: until.toISOString(),
    });
  }

  /** Adaptador do contrato da Issue 3. O destino vem do banco, não de input.email. */
  async request(input: InitialEmailRequest): Promise<InitialEmailVerification> {
    const challenge = await this.issue(input.user_id, 'email');
    return { delivery_status: 'sent', challenge_id: challenge.challenge_id, expires_at: challenge.expires_at };
  }

  async send(identity: AuthIdentity, channel: VerificationChannel): Promise<ChallengeDto> {
    return this.issue(identity.user_id, validateChannel(channel));
  }

  private async issue(userId: string, channel: VerificationChannel): Promise<ChallengeDto> {
    const result = await this.repository.withUserLock(userId, async transaction => {
      this.requireEmail(transaction.user, channel);
      if (channel === 'email' ? transaction.user.email_verified_at : transaction.user.phone_verified_at) {
        throw new DomainError('CHANNEL_ALREADY_VERIFIED', 'Este canal já está confirmado.', {});
      }
      // O relógio é lido após obter o lock, evitando validade desatualizada em espera.
      const now = this.clock();
      const limits = await transaction.deliveryLimits(channel);
      const daily = limits.find(row => row.window_type === 'day');
      const hourly = limits.find(row => row.window_type === 'hour');
      // Bloqueio prevalece mesmo que a janela diária já tenha expirado.
      if (daily?.blocked_until && daily.blocked_until > now) {
        return { error: this.deliveryLimitError('VERIFICATION_DELIVERY_BLOCKED', daily.blocked_until, now) };
      }
      // O excesso diário tem prioridade quando os dois tetos foram alcançados.
      if (daily && daily.window_expires_at > now && daily.request_count >= 6) {
        const until = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
        await transaction.blockDelivery(channel, until);
        return { error: this.deliveryLimitError('VERIFICATION_DELIVERY_BLOCKED', until, now) };
      }
      if (hourly && hourly.window_expires_at > now && hourly.request_count >= 3) {
        return { error: this.deliveryLimitError('VERIFICATION_RATE_LIMITED', hourly.window_expires_at, now) };
      }
      const id = randomUUID();
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expires = new Date(now.getTime() + (channel === 'email' ? 30 : 5) * 60_000);
      try {
        await this.delivery.sendVerification({ channel,
          destination: channel === 'email' ? transaction.user.email : transaction.user.phone, code });
      } catch {
        throw new DomainError('VERIFICATION_DELIVERY_FAILED', 'Não foi possível enviar o código. Tente novamente.', {});
      }
      // Só substitui o desafio depois de o mock aceitar o envio.
      await transaction.replace({ id, user_id: transaction.user.id, channel,
        code_hmac: this.hmac(userId, channel, id, code), issued_at: now, expires_at: expires });
      await transaction.recordDelivery(channel, now, limits);
      return { challenge: { challenge_id: id, channel, expires_at: expires.toISOString() } };
    });
    // O bloqueio diário deve sobreviver ao HTTP 429, como as tentativas da confirmação.
    if (result.error) throw result.error;
    return result.challenge!;
  }

  async confirm(identity: AuthIdentity, rawChannel: VerificationChannel, input: unknown): Promise<{ user: UserDto }> {
    const channel = validateChannel(rawChannel);
    const { challenge_id, code } = validateConfirmation(input);
    const result = await this.repository.withConfirmationLock(identity.user_id, channel, async transaction => {
      this.requireEmail(transaction.user, channel);
      const challenge = await transaction.current(channel);
      if (!challenge || challenge.id !== challenge_id) {
        return { error: new DomainError('INVALID_VERIFICATION_CODE', 'Código de verificação inválido.', {}) };
      }
      if (challenge.revoked_at) return { error: new DomainError('VERIFICATION_CODE_REVOKED', 'Código revogado. Solicite um novo envio.', {}) };
      if (challenge.consumed_at) return { error: new DomainError('VERIFICATION_CODE_CONSUMED', 'Este código já foi utilizado.', {}) };
      const now = this.clock();
      if (challenge.expires_at <= now) return { error: new DomainError('VERIFICATION_CODE_EXPIRED', 'Código expirado. Solicite um novo envio.', {}) };
      const expected = Buffer.from(challenge.code_hmac, 'hex');
      const actual = Buffer.from(this.hmac(identity.user_id, channel, challenge.id, code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        const attempts = Math.min(challenge.failed_attempts + 1, 3);
        await transaction.failedAttempt(challenge.id, attempts, attempts === 3 ? now : null);
        return { error: attempts === 3
          ? new DomainError('VERIFICATION_ATTEMPTS_EXCEEDED', 'Limite de tentativas atingido. Solicite um novo envio.', {})
          : new DomainError('INVALID_VERIFICATION_CODE', 'Código de verificação inválido.', {}) };
      }
      return { user: await transaction.consumeAndVerify(challenge.id, channel, now) };
    });
    // Fora da transação: erro HTTP não desfaz incremento/revogação já confirmados.
    if (result.error) throw result.error;
    return { user: result.user! };
  }
}
