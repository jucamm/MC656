import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users, verificationChallenges as challenges } from '../../db/schema';
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
    await this.db.update(challenges).set({ consumed_at: now }).where(eq(challenges.id, id));
    const [updated] = await this.db.update(users).set({ email_verified_at, phone_verified_at,
      status: email_verified_at && phone_verified_at ? 'verified' : 'pending',
    }).where(eq(users.id, this.user.id)).returning(publicUserColumns);
    return toUserDto(updated);
  }
}

export class PostgresVerificationRepository {
  constructor(private readonly db: NodePgDatabase) {}

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
