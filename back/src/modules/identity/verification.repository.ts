import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users, rateLimits, verificationChallenges as challenges } from '../../db/schema';
import { DomainError } from '../../errors/domain.error';
import type { VerificationChannel } from './identity.types';
import { publicUserColumns, toUserDto } from './user.repository';

type VerificationDatabase = Pick<NodePgDatabase, 'select' | 'insert' | 'update'>;
export type VerificationUser = Pick<typeof users.$inferSelect, keyof typeof publicUserColumns>;
export type VerificationChallenge = typeof challenges.$inferSelect;
export type NewVerificationChallenge = typeof challenges.$inferInsert;

/** Operações usadas exclusivamente dentro da transação com a conta bloqueada. */
export class VerificationTransaction {
  constructor(private readonly db: VerificationDatabase, readonly user: VerificationUser) {}

  async current(channel: VerificationChannel): Promise<VerificationChallenge | null> {
    const [row] = await this.db.select().from(challenges).where(and(
      eq(challenges.user_id, this.user.id), eq(challenges.channel, channel),
    ));
    return row ?? null;
  }

  async deliveryLimits(channel: VerificationChannel) {
    return this.db.select().from(rateLimits).where(and(
      eq(rateLimits.user_id, this.user.id), eq(rateLimits.channel, channel),
    ));
  }

  async blockDelivery(channel: VerificationChannel, until: Date): Promise<void> {
    await this.db.update(rateLimits).set({ blocked_until: until }).where(and(
      eq(rateLimits.user_id, this.user.id), eq(rateLimits.channel, channel), eq(rateLimits.window_type, 'day'),
    ));
  }

  /** Chamado após aceitação pelo mock, na mesma transação do desafio. */
  async recordDelivery(channel: VerificationChannel, now: Date,
    previous: (typeof rateLimits.$inferSelect)[]): Promise<void> {
    for (const window_type of ['hour', 'day'] as const) {
      const existing = previous.find(row => row.window_type === window_type);
      const active = existing && existing.window_expires_at > now;
      const window_started_at = active ? existing.window_started_at : now;
      const window_expires_at = active ? existing.window_expires_at
        : new Date(now.getTime() + (window_type === 'hour' ? 1 : 24) * 60 * 60_000);
      const values = { window_started_at, window_expires_at,
        request_count: active ? existing.request_count + 1 : 1,
        blocked_until: active ? existing.blocked_until : null };
      await this.db.insert(rateLimits).values({ user_id: this.user.id, channel, window_type, ...values })
        .onConflictDoUpdate({ target: [rateLimits.user_id, rateLimits.channel, rateLimits.window_type], set: values });
    }
  }

  async replace(challenge: NewVerificationChallenge): Promise<void> {
    await this.db.insert(challenges).values(challenge).onConflictDoUpdate({
      target: [challenges.user_id, challenges.channel],
      set: { id: challenge.id, code_hmac: challenge.code_hmac,
        issued_at: challenge.issued_at, expires_at: challenge.expires_at,
        failed_attempts: 0, consumed_at: null, revoked_at: null },
    });
  }

  async failedAttempt(id: string, attempts: number, revokedAt: Date | null): Promise<void> {
    await this.db.update(challenges).set({ failed_attempts: attempts, revoked_at: revokedAt })
      .where(eq(challenges.id, id));
  }

  async consumeAndVerify(id: string, channel: VerificationChannel, now: Date) {
    const email_verified_at = channel === 'email' ? now : this.user.email_verified_at;
    const phone_verified_at = channel === 'phone' ? now : this.user.phone_verified_at;
    if (channel === 'phone') {
      // A confirmação telefônica usa withConfirmationLock: mesmo número
      // serializado e contas bloqueadas em ordem antes de alterar o proprietário.
      await this.db.update(users).set({ phone_verified_at: null, status: 'pending' }).where(and(
        eq(users.phone, this.user.phone), ne(users.id, this.user.id), isNotNull(users.phone_verified_at),
      ));
    }
    await this.db.update(challenges).set({ consumed_at: now }).where(eq(challenges.id, id));
    const [updated] = await this.db.update(users).set({ email_verified_at, phone_verified_at,
      status: email_verified_at && phone_verified_at ? 'verified' : 'pending',
    }).where(eq(users.id, this.user.id)).returning(publicUserColumns);
    return toUserDto(updated);
  }
}

export class PostgresVerificationRepository {
  constructor(private readonly db: NodePgDatabase) {}

  /** Telefones são imutáveis neste MVP. O lock por número vem antes de
   * qualquer lock de conta; obter o lock da conta primeiro causaria deadlocks
   * entre duas confirmações do mesmo número em contas diferentes.
   */
  async withConfirmationLock<T>(userId: string, channel: VerificationChannel,
    operation: (transaction: VerificationTransaction) => Promise<T>): Promise<T> {
    if (channel === 'email') return this.withUserLock(userId, operation);
    return this.db.transaction(async tx => {
      const [contact] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, BigInt(userId)));
      if (!contact) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contact.phone}, 0))`);
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
  async withUserLock<T>(userId: string, operation: (transaction: VerificationTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      const [user] = await tx.select(publicUserColumns).from(users)
        .where(eq(users.id, BigInt(userId))).for('update');
      if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
      return operation(new VerificationTransaction(tx, user));
    });
  }
}
