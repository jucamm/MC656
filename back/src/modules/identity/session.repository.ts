import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { authenticationSessions as sessions, verificationChallenges } from '../../db/schema';
import type { AuthIdentity, CurrentChallengeDto } from './identity.types';

export type SessionRecord = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export interface SessionRepository {
  create(session: NewSession): Promise<void>;
  renewIfValid(hash: string, now: Date, expires: Date): Promise<SessionRecord | null>;
  findByTokenHash(hash: string): Promise<SessionRecord | null>;
  revoke(identity: AuthIdentity, now: Date): Promise<boolean>;
  currentChallenges(userId: string): Promise<CurrentChallengeDto[]>;
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async create(session: NewSession): Promise<void> {
    await this.db.insert(sessions).values(session);
  }

  async renewIfValid(hash: string, now: Date, expires: Date): Promise<SessionRecord | null> {
    // UPDATE condicional é atômico: nunca renova após expiração/revogação.
    // GREATEST impede que requisições fora de ordem retrocedam a atividade.
    const [session] = await this.db.update(sessions).set({
      last_activity_at: sql`greatest(${sessions.last_activity_at}, ${now.toISOString()}::timestamptz)`,
      expires_at: sql`greatest(${sessions.expires_at}, ${expires.toISOString()}::timestamptz)`,
    }).where(and(eq(sessions.token_hash, hash), isNull(sessions.revoked_at), gt(sessions.expires_at, now)))
      .returning();
    return session ?? null;
  }

  async findByTokenHash(hash: string): Promise<SessionRecord | null> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.token_hash, hash));
    return session ?? null;
  }

  async revoke(identity: AuthIdentity, now: Date): Promise<boolean> {
    const rows = await this.db.update(sessions).set({ revoked_at: now }).where(and(
      eq(sessions.id, identity.session_id), eq(sessions.user_id, BigInt(identity.user_id)),
      isNull(sessions.revoked_at), gt(sessions.expires_at, now),
    )).returning({ id: sessions.id });
    return rows.length === 1;
  }

  async currentChallenges(userId: string): Promise<CurrentChallengeDto[]> {
    const rows = await this.db.select({
      challenge_id: verificationChallenges.id, channel: verificationChallenges.channel,
      expires_at: verificationChallenges.expires_at, failed_attempts: verificationChallenges.failed_attempts,
      consumed_at: verificationChallenges.consumed_at, revoked_at: verificationChallenges.revoked_at,
    }).from(verificationChallenges).where(eq(verificationChallenges.user_id, BigInt(userId)))
      .orderBy(verificationChallenges.channel);
    return rows.map(row => ({ ...row, expires_at: row.expires_at.toISOString(),
      consumed_at: row.consumed_at?.toISOString() ?? null, revoked_at: row.revoked_at?.toISOString() ?? null }));
  }
}
