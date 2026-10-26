import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../errors/domain.error';
import type { AuthIdentity, ChallengeDto, InitialEmailVerification, UserDto, VerificationChannel } from './identity.types';
import type { InitialEmailRequest, InitialEmailVerificationRequester } from './notifications/initial-email-verification';
import type { VerificationDelivery } from './notifications/verification-delivery';
import type { PostgresVerificationRepository, VerificationUser } from './verification.repository';
import { validateChannel, validateConfirmation } from './validators/verification.validator';

/**
 * Emite e confirma desafios protegidos por HMAC, coordenando entrega, cotas e estado da conta.
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
   * Impõe a ordem do onboarding antes de operar no canal telefônico.
   * @param {VerificationUser} user - Estado atual bloqueado da conta.
   * @param {VerificationChannel} channel - Canal solicitado.
   * @returns {void} Conclui quando a pré-condição é atendida.
   * @throws {DomainError} EMAIL_VERIFICATION_REQUIRED antes de enviar ou validar telefone.
   */
  private requireEmail(user: VerificationUser, channel: VerificationChannel): void {
    if (channel === 'phone' && !user.email_verified_at) {
      throw new DomainError('EMAIL_VERIFICATION_REQUIRED', 'Confirme o e-mail antes de verificar o telefone.', {});
    }
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
      // O header exige segundos inteiros: ceil evita liberar a tentativa antes do
      // prazo; o mínimo 1 cobre frações de segundo até o instante de liberação.
      retry_after_seconds: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)),
      retry_at: until.toISOString(),
    });
  }

  /** Adaptador do contrato da Issue 3. O destino vem do banco, não de input.email. */
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
   * @throws {DomainError} Canal inválido, pré-condição, canal já confirmado, cota ou falha de entrega.
   */
  async send(identity: AuthIdentity, channel: VerificationChannel): Promise<ChallengeDto> {
    return this.issue(identity.user_id, validateChannel(channel));
  }

  /**
   * Decide a cota e substitui o desafio somente após aceitação da entrega.
   * @param {string} userId - Conta cujo lock serializa os dois canais.
   * @param {VerificationChannel} channel - Canal da emissão.
   * @returns {Promise<ChallengeDto>} Desafio corrente após commit.
   * @throws {DomainError} Recusas de verificação/entrega ou cotas com retry_at e Retry-After.
   * @throws {Error} Falhas internas de persistência que provocam rollback.
   */
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
        // Três dias são 72 horas a partir da tentativa excedente, em milissegundos.
        // Não é o fim de um terceiro dia civil nem uma extensão a cada tentativa.
        const until = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
        await transaction.blockDelivery(channel, until);
        return { error: this.deliveryLimitError('VERIFICATION_DELIVERY_BLOCKED', until, now) };
      }
      if (hourly && hourly.window_expires_at > now && hourly.request_count >= 3) {
        return { error: this.deliveryLimitError('VERIFICATION_RATE_LIMITED', hourly.window_expires_at, now) };
      }
      const id = randomUUID();
      // randomInt usa entropia criptográfica no intervalo [0, 1_000_000).
      // padStart mantém seis posições mesmo em valores como 000007.
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      // As validades são durações exatas (30/5 minutos), sem dependência de fuso
      // ou calendário. O relógio já foi obtido depois da aquisição do lock.
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
      // Contadores e desafio são commitados juntos. Uma falha anterior do mock
      // sai por exceção e não cobra cota nem apaga o desafio ainda válido.
      // NOTE: A outbox em memória não participa do rollback de uma falha posterior do banco.
      await transaction.recordDelivery(channel, now, limits);
      return { challenge: { challenge_id: id, channel, expires_at: expires.toISOString() } };
    });
    // O bloqueio diário deve sobreviver ao HTTP 429, como as tentativas da confirmação.
    if (result.error) throw result.error;
    return result.challenge!;
  }

  /**
   * Confere propriedade, estado e HMAC antes de consumir o desafio atomicamente.
   * @param {AuthIdentity} identity - Conta/sessão autenticadas pelo middleware HTTP.
   * @param {VerificationChannel} rawChannel - Canal validado antes da transação.
   * @param {unknown} input - UUID e código recebidos sem coerção de tipos.
   * @returns {Promise<{user: UserDto}>} Conta atualizada, sem segredos nem dados de outros proprietários.
   * @throws {DomainError} Entrada/pré-condição inválida ou desafio incorreto, expirado, consumido, revogado ou excedido.
   * @throws {Error} Falha transacional, que desfaz confirmação e transferência.
   */
  async confirm(identity: AuthIdentity, rawChannel: VerificationChannel, input: unknown): Promise<{ user: UserDto }> {
    const channel = validateChannel(rawChannel);
    const { challenge_id, code } = validateConfirmation(input);
    const result = await this.repository.withConfirmationLock(identity.user_id, channel, async transaction => {
      this.requireEmail(transaction.user, channel);
      const challenge = await transaction.current(channel);
      // O desafio é consultado pela própria conta e canal antes de comparar UUID.
      // Assim, referências alheias/substituídas têm a mesma recusa e não consomem
      // tentativas do desafio corrente nem revelam o estado de outra conta.
      if (!challenge || challenge.id !== challenge_id) {
        return { error: new DomainError('INVALID_VERIFICATION_CODE', 'Código de verificação inválido.', {}) };
      }
      if (challenge.revoked_at) return { error: new DomainError('VERIFICATION_CODE_REVOKED', 'Código revogado. Solicite um novo envio.', {}) };
      if (challenge.consumed_at) return { error: new DomainError('VERIFICATION_CODE_CONSUMED', 'Este código já foi utilizado.', {}) };
      const now = this.clock();
      if (challenge.expires_at <= now) return { error: new DomainError('VERIFICATION_CODE_EXPIRED', 'Código expirado. Solicite um novo envio.', {}) };
      // timingSafeEqual exige buffers de mesmo tamanho; o teste de comprimento
      // impede exceção para HMAC persistido malformado antes da comparação constante.
      const expected = Buffer.from(challenge.code_hmac, 'hex');
      const actual = Buffer.from(this.hmac(identity.user_id, channel, challenge.id, code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        // A terceira falha grava a revogação imediatamente. Saturar em 3 respeita
        // o check do banco; a recusa só será lançada após persistir esta decisão.
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
