import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../errors/domain.error';
import type { AuthIdentity, ChallengeDto, InitialEmailVerification, UserDto, VerificationChannel } from './identity.types';
import type { InitialEmailRequest, InitialEmailVerificationRequester } from './notifications/initial-email-verification';
import type { VerificationDelivery } from './notifications/verification-delivery';
import type { PostgresVerificationRepository } from './verification.repository';
import { validateChannel, validateConfirmation } from './validators/verification.validator';

/**
 * Emite e confirma desafios de e-mail protegidos por HMAC, coordenando entrega, cotas e estado da conta.
 * @remarks A credencial numérica só segue para o adaptador interno; nunca é DTO da API.
 */
export class VerificationService implements InitialEmailVerificationRequester {
  private readonly key: string;

  /**
   * @param {PostgresVerificationRepository} repository - Persistência e locks transacionais.
   * @param {VerificationDelivery} delivery - Adaptador local que aceita ou recusa o envio.
   * @param {string | undefined} key - Segredo externo ao banco, com ao menos 32 bytes UTF-8.
   * @param {() => Date} clock - Relógio injetável para validade, tentativas e janelas.
   * @throws {Error} Configuração sem chave HMAC válida; não há segredo provisório automático.
   */
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

  /**
   * Vincula o código ao contexto para impedir reaproveitamento entre contas/canais/desafios.
   * @param {string} userId - ID decimal canônico da conta.
   * @param {VerificationChannel} channel - Canal do desafio.
   * @param {string} id - UUID específico desta emissão.
   * @param {string} code - Seis dígitos originais, preservando zeros.
   * @returns {string} HMAC-SHA256 hexadecimal de 64 caracteres.
   * @remarks Os identificadores usados no contexto não contêm o separador de campos.
   */
  private hmac(userId: string, channel: VerificationChannel, id: string, code: string): string {
    return createHmac('sha256', this.key).update(`${userId}:${channel}:${id}:${code}`).digest('hex');
  }

  /**
   * Monta uma recusa segura e a orientação de cooldown compartilhada com o frontend.
   * @param {"VERIFICATION_RATE_LIMITED" | "VERIFICATION_DELIVERY_BLOCKED"} code - Tipo de recusa.
   * @param {Date} until - Primeiro instante em que a restrição informada termina.
   * @param {Date} now - Referência usada ao avaliar as cotas.
   * @returns {DomainError} Erro ainda não lançado, para permitir commit do bloqueio diário.
   */
  private deliveryLimitError(code: 'VERIFICATION_RATE_LIMITED' | 'VERIFICATION_DELIVERY_BLOCKED', until: Date, now: Date) {
    return new DomainError(code, code === 'VERIFICATION_DELIVERY_BLOCKED'
      ? 'Envios bloqueados temporariamente. Tente novamente mais tarde.'
      : 'Limite de envios atingido. Tente novamente mais tarde.', {
      retry_after_seconds: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)),
      retry_at: until.toISOString(),
    });
  }

  /**
   * Conecta o cadastro ao emissor real de desafios sem exigir uma sessão prévia.
   * @param {InitialEmailRequest} input - Conta recém-criada; o e-mail informado não determina o destino.
   * @returns {Promise<InitialEmailVerification>} Metadados sent após emissão aceita.
   * @throws {DomainError} Recusa de emissão; RegistrationService converte falha em delivery_status failed.
   * @remarks O cadastro deve estar persistido antes desta chamada.
   */
  async request(input: InitialEmailRequest): Promise<InitialEmailVerification> {
    const challenge = await this.issue(input.user_id, 'email');
    return { delivery_status: 'sent', challenge_id: challenge.challenge_id, expires_at: challenge.expires_at };
  }

  /**
   * Solicita envio explícito do canal da própria conta autenticada.
   * @param {AuthIdentity} identity - Identidade resolvida pelo middleware, nunca pelo body.
   * @param {VerificationChannel} channel - Canal validado novamente na borda do serviço.
   * @returns {Promise<ChallengeDto>} UUID e validade, sem código ou HMAC.
   * @throws {DomainError} Canal inválido, canal já confirmado, cota ou falha de entrega.
   */
  async send(identity: AuthIdentity, channel: VerificationChannel): Promise<ChallengeDto> {
    return this.issue(identity.user_id, validateChannel(channel));
  }

  /**
   * Decide a cota e substitui o desafio somente após aceitação da entrega.
   * @param {string} userId - Conta sob lock.
   * @param {VerificationChannel} channel - Canal da emissão.
   * @returns {Promise<ChallengeDto>} Desafio corrente após commit.
   * @throws {DomainError} Recusas de verificação/entrega ou cotas com retry_at e Retry-After.
   * @throws {Error} Falhas internas de persistência que provocam rollback.
   */
  private async issue(userId: string, channel: VerificationChannel): Promise<ChallengeDto> {
    const result = await this.repository.withUserLock(userId, async transaction => {
      if (transaction.user.email_verified_at) {
        throw new DomainError('CHANNEL_ALREADY_VERIFIED', 'Este canal já está confirmado.', {});
      }
      const now = this.clock();
      const limits = await transaction.deliveryLimits(channel);
      const daily = limits.find(row => row.window_type === 'day');
      const hourly = limits.find(row => row.window_type === 'hour');

      if (daily?.blocked_until && daily.blocked_until > now) {
        return { error: this.deliveryLimitError('VERIFICATION_DELIVERY_BLOCKED', daily.blocked_until, now) };
      }
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
      const expires = new Date(now.getTime() + 30 * 60_000);

      try {
        await this.delivery.sendVerification({ channel, destination: transaction.user.email, code });
      } catch {
        throw new DomainError('VERIFICATION_DELIVERY_FAILED', 'Não foi possível enviar o código. Tente novamente.', {});
      }

      await transaction.replace({
        id,
        user_id: transaction.user.id,
        channel,
        code_hmac: this.hmac(userId, channel, id, code),
        issued_at: now,
        expires_at: expires,
      });

      await transaction.recordDelivery(channel, now, limits);
      return { challenge: { challenge_id: id, channel, expires_at: expires.toISOString() } };
    });

    if (result.error) throw result.error;
    return result.challenge!;
  }

  /**
   * Confere propriedade, estado e HMAC antes de consumir o desafio atomicamente.
   * @param {AuthIdentity} identity - Conta/sessão autenticadas pelo middleware HTTP.
   * @param {VerificationChannel} rawChannel - Canal validado antes da transação.
   * @param {unknown} input - UUID e código recebidos sem coerção de tipos.
   * @returns {Promise<{user: UserDto}>} Conta atualizada, sem segredos nem dados de outros proprietários.
   * @throws {DomainError} Entrada/desafio inválido, expirado, consumido, revogado ou excedido.
   * @throws {Error} Falha transacional.
   */
  async confirm(identity: AuthIdentity, rawChannel: VerificationChannel, input: unknown): Promise<{ user: UserDto }> {
    const channel = validateChannel(rawChannel);
    const { challenge_id, code } = validateConfirmation(input);
    const result = await this.repository.withConfirmationLock(identity.user_id, channel, async transaction => {
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

    if (result.error) throw result.error;
    return { user: result.user! };
  }
}
