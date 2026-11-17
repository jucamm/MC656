import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users, rateLimits, verificationChallenges as challenges } from '../../db/schema';
import { DomainError } from '../../errors/domain.error';
import type { VerificationChannel } from './identity.types';
import { publicUserColumns, toUserDto } from './user.repository';

/**
 * Operações permitidas ao contexto transacional; ele não pode abrir uma segunda transação.
 */
type VerificationDatabase = Pick<NodePgDatabase, 'select' | 'insert' | 'update'>;
/**
 * Snapshot público bloqueado da conta; não carrega password_hash para validar canais.
 */
export type VerificationUser = Pick<typeof users.$inferSelect, keyof typeof publicUserColumns>;
/**
 * Registro interno com HMAC; não deve ser retornado diretamente pela API.
 */
export type VerificationChallenge = typeof challenges.$inferSelect;
/**
 * Registro de desafio protegido, preparado pelo emissor após validar conta/canal.
 */
export type NewVerificationChallenge = typeof challenges.$inferInsert;

/** Operações usadas exclusivamente dentro da transação com a conta bloqueada. */
/**
 * Agrupa consultas que participam do mesmo lock e da mesma decisão de commit.
 * @remarks Instâncias não devem escapar do callback do repository nem ser reutilizadas após o commit.
 */
export class VerificationTransaction {
  /**
   * @param {VerificationDatabase} db - Transação ou conexão com lock já adquirido.
   * @param {VerificationUser} user - Conta lida sob lock exclusivo (FOR UPDATE).
   */
  constructor(readonly db: VerificationDatabase, readonly user: VerificationUser) {}

  /**
   * Lê o desafio do canal solicitado pela própria conta bloqueada.
   * @param {VerificationChannel} channel - Canal previamente validado.
   * @returns {Promise<VerificationChallenge | null>} Desafio ou null se nunca emitido.
   */
  async current(channel: VerificationChannel): Promise<VerificationChallenge | null> {
    const [challenge] = await this.db.select().from(challenges).where(
      eq(challenges.user_id, this.user.id),
    );
    return challenge && challenge.channel === channel ? challenge : null;
  }

  /**
   * Carrega cotas vigentes para decidir bloqueio e contagem sob lock.
   * @param {VerificationChannel} channel - Canal cujo contador é independente do outro.
   * @returns {Promise<Array<typeof rateLimits.$inferSelect>>} Janelas hora e dia.
   */
  async deliveryLimits(_channel: VerificationChannel) {
    return this.db.select().from(rateLimits).where(
      eq(rateLimits.user_id, this.user.id),
    );
  }

  /**
   * Aplica bloqueio de 72 horas após exceder a cota diária.
   * @param {VerificationChannel} channel - Par conta/canal que excedeu o teto diário.
   * @param {Date} until - Fim do período de bloqueio em UTC.
   * @returns {Promise<void>} Resolve após o update da janela diária.
   */
  async blockDelivery(channel: VerificationChannel, until: Date): Promise<void> {
    await this.db.update(rateLimits).set({ blocked_until: until })
      .where(eq(rateLimits.user_id, this.user.id));
  }

  /**
   * Incrementa ou inicia janelas preservando a duração fixa a partir do primeiro envio.
   * @param {VerificationChannel} channel - Canal do envio aceito.
   * @param {Date} now - Referência de início de janelas novas.
   * @param {Array<typeof rateLimits.$inferSelect>} previous - Janelas lidas sob o mesmo lock.
   * @returns {Promise<void>} Resolve após persistir hora e dia, sem commit intermediário.
   * @throws {Error} Falha de banco, que reverte também a substituição do desafio.
   */
  async recordDelivery(channel: VerificationChannel, now: Date,
    previous: (typeof rateLimits.$inferSelect)[]): Promise<void> {
    for (const window_type of ['hour', 'day'] as const) {
      const existing = previous.find(row => row.window_type === window_type);
      // A igualdade marca o fim da janela. Só o primeiro sucesso posterior inicia
      // nova janela; tentativas recusadas ou falhas de entrega não chegam a este método.
      const active = existing && existing.window_expires_at > now;
      const window_started_at = active ? existing.window_started_at : now;
      // Janelas fixas relativas: 1h e 24h desde o primeiro envio aceito,
      // sem arredondamento para viradas de hora, meia-noite ou fuso local.
      const window_expires_at = active ? existing.window_expires_at
        : new Date(now.getTime() + (window_type === 'hour' ? 1 : 24) * 60 * 60_000);
      // A decisão de permitir o envio já verificou blocked_until antes deste ponto.
      // A janela ativa preserva o bloqueio; uma expirada só é renovada após essa checagem.
      const values = { window_started_at, window_expires_at,
        request_count: active ? existing.request_count + 1 : 1,
        blocked_until: active ? existing.blocked_until : null };
      await this.db.insert(rateLimits).values({ user_id: this.user.id, channel, window_type, ...values })
        .onConflictDoUpdate({ target: [rateLimits.user_id, rateLimits.channel, rateLimits.window_type], set: values });
    }
  }

  /**
   * Substitui o desafio corrente sem criar dois registros ativos no mesmo canal.
   * @param {NewVerificationChallenge} challenge - Novo UUID, HMAC e validade após aceitação pelo mock.
   * @returns {Promise<void>} Resolve após inserir ou atualizar a chave única conta/canal.
   * @remarks Trocar o UUID invalida referências anteriores; só os erros do desafio são zerados, não as cotas.
   */
  async replace(challenge: NewVerificationChallenge): Promise<void> {
    await this.db.insert(challenges).values(challenge).onConflictDoUpdate({
      target: [challenges.user_id, challenges.channel],
      set: { id: challenge.id, code_hmac: challenge.code_hmac,
        issued_at: challenge.issued_at, expires_at: challenge.expires_at,
        failed_attempts: 0, consumed_at: null, revoked_at: null },
    });
  }

  /**
   * Registra erro de confirmação sem alterar o contador de envios.
   * @param {string} id - Desafio corrente validado sob o lock da conta.
   * @param {number} attempts - Nova contagem, limitada pelo serviço e pelo check do banco.
   * @param {Date | null} revokedAt - Instante da terceira falha ou null antes desse limite.
   * @returns {Promise<void>} Grava a tentativa; o chamador deve permitir o commit antes do erro HTTP.
   */
  async failedAttempt(id: string, attempts: number, revokedAt: Date | null): Promise<void> {
    await this.db.update(challenges).set({ failed_attempts: attempts, revoked_at: revokedAt })
      .where(eq(challenges.id, id));
  }

  /**
   * Aplica consumo e estado da conta como uma única unidade transacional.
   * @param {string} id - Desafio cujo código/estado já foram conferidos.
   * @param {VerificationChannel} channel - Canal confirmado.
   * @param {Date} now - Instante da confirmação e consumo.
   * @returns {Promise<UserDto>} Conta atualizada com projeção pública.
   * @throws {Error} Falha de banco.
   */
  async consumeAndVerify(id: string, channel: VerificationChannel, now: Date) {
    const email_verified_at = now;
    await this.db.update(challenges).set({ consumed_at: now }).where(eq(challenges.id, id));
    const [updated] = await this.db.update(users).set({
      email_verified_at,
      status: 'verified',
    }).where(eq(users.id, this.user.id)).returning(publicUserColumns);
    return toUserDto(updated);
  }
}

/**
 * Define os limites transacionais e a ordem de locks usados por emissão e confirmação.
 */
export class PostgresVerificationRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Serializa confirmações por conta sob lock exclusivo.
   * @template T - Resultado de negócio que será devolvido após o commit.
   * @param {string} userId - ID decimal da conta autenticada.
   * @param {VerificationChannel} channel - Canal da confirmação.
   * @param {(transaction: VerificationTransaction) => Promise<T>} operation - Operações sob os locks adquiridos.
   * @returns {Promise<T>} Resultado somente após concluir a transação.
   */
  async withConfirmationLock<T>(userId: string, _channel: VerificationChannel,
    operation: (transaction: VerificationTransaction) => Promise<T>): Promise<T> {
    return this.withUserLock(userId, operation);
  }

  /**
   * Executa emissão/reenvio e operações locais de conta sem disputa de contadores.
   * @template T - Resultado do callback, inclusive recusas que precisam ser persistidas.
   * @param {string} userId - ID decimal da conta que será bloqueada.
   * @param {(transaction: VerificationTransaction) => Promise<T>} operation - Decisão de negócio sob o lock.
   * @returns {Promise<T>} Resultado após commit; callbacks sem exceção mantêm suas escritas.
   * @throws {DomainError} UNAUTHENTICATED se a conta não existir.
   * @throws {Error} Exceções do callback ou banco provocam rollback.
   */
  async withUserLock<T>(userId: string, operation: (transaction: VerificationTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      const [user] = await tx.select(publicUserColumns).from(users)
        .where(eq(users.id, BigInt(userId))).for('update');
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
      return operation(new VerificationTransaction(tx, user));
    });
  }
}
