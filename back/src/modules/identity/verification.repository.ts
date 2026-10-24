import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
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
   * @param {VerificationDatabase} db - Executor da transação atual, não o pool global.
   * @param {VerificationUser} user - Conta lida e bloqueada antes das decisões de negócio.
   */
  /**
   * @param {NodePgDatabase} db - Conexão Drizzle com suporte a transações PostgreSQL.
   */
  constructor(private readonly db: VerificationDatabase, readonly user: VerificationUser) {}

  /**
   * Obtém o desafio corrente do par conta/canal, inclusive se não for mais utilizável.
   * @param {VerificationChannel} channel - Canal previamente validado.
   * @returns {Promise<VerificationChallenge | null>} Registro para validar ID, estado e HMAC.
   */
  async current(channel: VerificationChannel): Promise<VerificationChallenge | null> {
    const [row] = await this.db.select().from(challenges).where(and(
      eq(challenges.user_id, this.user.id), eq(challenges.channel, channel),
    ));
    return row ?? null;
  }

  /**
   * Carrega as duas janelas sem criar cotas para uma tentativa ainda não aceita.
   * @param {VerificationChannel} channel - Canal cujo contador é independente do outro.
   * @returns {Promise<Array<typeof rateLimits.$inferSelect>>} Linhas existentes de hora/dia.
   * @remarks O lock da conta já serializa os escritores; não há dimensão de IP ou sessão.
   */
  async deliveryLimits(channel: VerificationChannel) {
    return this.db.select().from(rateLimits).where(and(
      eq(rateLimits.user_id, this.user.id), eq(rateLimits.channel, channel),
    ));
  }

  /**
   * Grava o bloqueio na linha diária existente, preservando janela e contagem.
   * @param {VerificationChannel} channel - Par conta/canal que excedeu o teto diário.
   * @param {Date} until - Fim do bloqueio calculado pelo serviço.
   * @returns {Promise<void>} Resolve após o UPDATE dentro da transação.
   * @remarks O callback deve retornar o erro como resultado para que o bloqueio seja commitado.
   */
  async blockDelivery(channel: VerificationChannel, until: Date): Promise<void> {
    await this.db.update(rateLimits).set({ blocked_until: until }).where(and(
      eq(rateLimits.user_id, this.user.id), eq(rateLimits.channel, channel), eq(rateLimits.window_type, 'day'),
    ));
  }

  /** Chamado após aceitação pelo mock, na mesma transação do desafio. */
  /**
   * Contabiliza as duas cotas após sucesso do adaptador, junto do novo desafio.
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
   * @throws {Error} Falha de banco; todas as alterações da transferência sofrem rollback.
   * @remarks Para phone, exige o contexto obtido por withConfirmationLock, com lock por número.
   */
  async consumeAndVerify(id: string, channel: VerificationChannel, now: Date) {
    const email_verified_at = channel === 'email' ? now : this.user.email_verified_at;
    const phone_verified_at = channel === 'phone' ? now : this.user.phone_verified_at;
    if (channel === 'phone') {
      // A confirmação telefônica usa withConfirmationLock: mesmo número
      // serializado e contas bloqueadas em ordem antes de alterar o proprietário.
      // Apenas a confirmação telefônica e o status anteriores são limpos.
      // E-mail e sessões sobrevivem para manter disponível o onboarding.
      await this.db.update(users).set({ phone_verified_at: null, status: 'pending' }).where(and(
        eq(users.phone, this.user.phone), ne(users.id, this.user.id), isNotNull(users.phone_verified_at),
      ));
    }
    await this.db.update(challenges).set({ consumed_at: now }).where(eq(challenges.id, id));
    // Os timestamps e status são escritos juntos para satisfazer o check
    // "verified se e somente se ambos os canais estiverem confirmados".
    const [updated] = await this.db.update(users).set({ email_verified_at, phone_verified_at,
      status: email_verified_at && phone_verified_at ? 'verified' : 'pending',
    }).where(eq(users.id, this.user.id)).returning(publicUserColumns);
    return toUserDto(updated);
  }
}

/**
 * Define os limites transacionais e a ordem de locks usados por emissão e confirmação.
 */
export class PostgresVerificationRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /** Telefones são imutáveis neste MVP. O lock por número vem antes de
   * qualquer lock de conta; obter o lock da conta primeiro causaria deadlocks
   * entre duas confirmações do mesmo número em contas diferentes.
   */
  /**
   * Serializa confirmações por conta ou por telefone, conforme o canal.
   * @template T - Resultado de negócio que será devolvido após o commit.
   * @param {string} userId - ID decimal da conta autenticada.
   * @param {VerificationChannel} channel - E-mail usa lock local; telefone coordena todas as contas do número.
   * @param {(transaction: VerificationTransaction) => Promise<T>} operation - Operações sob os locks adquiridos.
   * @returns {Promise<T>} Resultado somente após concluir a transação.
   * @throws {DomainError} UNAUTHENTICATED se a conta não existir.
   * @throws {Error} Falha do callback/banco, provocando rollback.
   * @remarks Edição de contatos não existe no MVP; adicioná-la exige revisar esta ordem de locks.
   */
  async withConfirmationLock<T>(userId: string, channel: VerificationChannel,
    operation: (transaction: VerificationTransaction) => Promise<T>): Promise<T> {
    if (channel === 'email') return this.withUserLock(userId, operation);
    return this.db.transaction(async tx => {
      const [contact] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, BigInt(userId)));
      if (!contact) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
      // WARNING: Este lock deve vir antes de qualquer FOR UPDATE desta operação.
      // O hash de 64 bits fornece a chave compartilhada entre instâncias. Colisões
      // podem serializar números distintos, mas não criam duas confirmações vigentes.
      // O lock é liberado automaticamente no commit/rollback, sem estado em memória.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contact.phone}, 0))`);
      // ORDER BY antecede FOR UPDATE para obter locks de contas em ordem estável.
      // Bloquear a conta atual primeiro permitiria uma espera circular na transferência.
      const accounts = await tx.select(publicUserColumns).from(users).where(eq(users.phone, contact.phone))
        .orderBy(users.id).for('update');
      const user = accounts.find(account => account.id === BigInt(userId));
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
      return operation(new VerificationTransaction(tx, user));
    });
  }

  /** Lock por conta serializa emissão/reenvio/confirmação dos dois canais.
   * Os callbacks não devem lançar erros depois de gravar tentativas inválidas:
   * retorne o resultado e converta em erro após o commit, no service.
   */
  /**
   * Executa emissão/reenvio e operações locais de conta sem disputa de contadores.
   * @template T - Resultado do callback, inclusive recusas que precisam ser persistidas.
   * @param {string} userId - ID decimal da conta que será bloqueada.
   * @param {(transaction: VerificationTransaction) => Promise<T>} operation - Decisão de negócio sob o lock.
   * @returns {Promise<T>} Resultado após commit; callbacks sem exceção mantêm suas escritas.
   * @throws {DomainError} UNAUTHENTICATED se a conta não existir.
   * @throws {Error} Exceções do callback ou banco provocam rollback.
   * @remarks Confirmação telefônica deve usar withConfirmationLock para incluir as outras contas.
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
