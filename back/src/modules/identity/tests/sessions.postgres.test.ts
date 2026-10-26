import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, users, verificationChallenges } from '../../../db/schema';
import { PasswordService } from '../password.service';
import { PostgresSessionRepository } from '../session.repository';
import { addCalendarMonthUtc, hashSessionToken, SessionService } from '../session.service';
import { PostgresUserRepository } from '../user.repository';
import { migrateIdentityTestDatabase } from './postgres-test-utils';

const connectionString = process.env.HU01_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('sessões com PostgreSQL real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const userRepository = new PostgresUserRepository(db);
  const repository = new PostgresSessionRepository(db);
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  let now: Date;
  let userId: bigint;
  let email: string;
  let service: SessionService;
  let app: ReturnType<typeof createApp>;
  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    now = new Date('2026-01-31T10:00:00.000Z');
    email = `sessions-${randomUUID()}@example.com`;
    const user = await userRepository.create({ name: 'Ana', email, phone: '+55 (11) 98765-4321', password_hash: await passwords.hash(' SenhaSegura ') });
    userId = BigInt(user.id);
    service = new SessionService(userRepository, repository, passwords, () => new Date(now));
    app = createApp(undefined, service);
  });
  afterEach(async () => {
    if (!userId) return;
    await db.delete(authenticationSessions).where(eq(authenticationSessions.user_id, userId));
    await db.delete(verificationChallenges).where(eq(verificationChallenges.user_id, userId));
    await db.delete(users).where(eq(users.id, userId));
  });
  afterAll(async () => { await pool.end(); });
  async function login() {
    const response = await request(app).post('/auth/login').send({ email: ` ${email.toUpperCase()} `, password: ' SenhaSegura ' }).expect(200);
    return response.body.data.token as string;
  }
  async function session(token: string) {
    const [row] = await db.select().from(authenticationSessions).where(eq(authenticationSessions.token_hash, hashSessionToken(token)));
    return row;
  }

  it('login → renovação → logout persiste somente hash e preserva outra sessão', async () => {
    const first = await login();
    const second = await login();
    expect(first).not.toBe(second);
    const initial = await session(first);
    expect(initial.expires_at.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(initial.token_hash).toBe(hashSessionToken(first));
    expect(initial).not.toHaveProperty('token');
    now = new Date('2026-02-25T14:30:00.000Z');
    await request(app).get('/auth/me').set('Authorization', `Bearer ${first}`).expect(200);
    const renewed = await session(first);
    expect(renewed.last_activity_at).toEqual(now);
    expect(renewed.expires_at.toISOString()).toBe('2026-03-25T14:30:00.000Z');
    await request(app).post('/auth/logout').set('Authorization', `Bearer ${first}`).expect(204);
    expect((await session(first)).revoked_at).toEqual(now);
    expect((await session(second)).revoked_at).toBeNull();
    expect((await db.select().from(authenticationSessions).where(eq(authenticationSessions.user_id, userId)))).toHaveLength(2);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${first}`).expect(401)).body.error.code).toBe('SESSION_REVOKED');
    await request(app).get('/auth/me').set('Authorization', `Bearer ${second}`).expect(200);
  });

  it('sessão expirada não muda atividade nem expiração', async () => {
    const token = await login();
    const previous = await session(token);
    now = new Date(previous.expires_at);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401)).body.error.code).toBe('SESSION_EXPIRED');
    expect(await session(token)).toEqual(previous);
  });

  it('renovações concorrentes não retrocedem datas e não desfazem revogação', async () => {
    const token = await login();
    const earlier = new Date('2026-02-01T12:00:00.000Z');
    const later = new Date('2026-02-02T12:00:00.000Z');
    const hash = hashSessionToken(token);
    await Promise.all([
      repository.renewIfValid(hash, later, addCalendarMonthUtc(later)),
      repository.renewIfValid(hash, earlier, addCalendarMonthUtc(earlier)),
    ]);
    expect((await session(token)).last_activity_at).toEqual(later);
    const identity = { user_id: userId.toString(), session_id: (await session(token)).id };
    await Promise.all([
      repository.revoke(identity, later),
      repository.renewIfValid(hash, later, addCalendarMonthUtc(later)),
    ]);
    expect((await session(token)).revoked_at).toEqual(later);
    expect(await repository.renewIfValid(hash, later, addCalendarMonthUtc(later))).toBeNull();
  });

  it('me consulta estado atual e metadados dos desafios sem código/HMAC', async () => {
    const token = await login();
    const challengeId = randomUUID();
    await db.insert(verificationChallenges).values({ id: challengeId, user_id: userId, channel: 'email', code_hmac: 'a'.repeat(64),
      issued_at: now, expires_at: new Date('2026-01-31T10:30:00.000Z') });
    await db.update(users).set({ status: 'verified', email_verified_at: now, phone_verified_at: now }).where(eq(users.id, userId));
    const current = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(current.body.data.user.status).toBe('verified');
    expect(current.body.data.verification_challenges).toEqual([{ challenge_id: challengeId, channel: 'email',
      expires_at: '2026-01-31T10:30:00.000Z', failed_attempts: 0, consumed_at: null, revoked_at: null }]);
    expect(JSON.stringify(current.body)).not.toContain('password_hash');
    expect(JSON.stringify(current.body)).not.toContain('code_hmac');
    expect(JSON.stringify(current.body)).not.toContain(token);
    await db.update(users).set({ status: 'pending', phone_verified_at: null }).where(eq(users.id, userId));
    const changed = await service.authenticate(token);
    expect(changed.user.status).toBe('pending');
  });
});
