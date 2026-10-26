import { randomInt, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, rateLimits, users, verificationChallenges } from '../../../db/schema';
import { MockVerificationDelivery } from '../notifications/verification-delivery';
import { PasswordService } from '../password.service';
import { RegistrationService } from '../registration.service';
import { PostgresSessionRepository } from '../session.repository';
import { SessionService } from '../session.service';
import { PostgresUserRepository } from '../user.repository';
import { PostgresVerificationRepository } from '../verification.repository';
import { VerificationService } from '../verification.service';
import { migrateIdentityTestDatabase } from './postgres-test-utils';

interface Account { id: string; token: string; email: string; email_verified_at: string | null }
interface PhoneChallenge { challenge_id: string; code: string }

function newPhone() { return `119${randomInt(0, 100_000_000).toString().padStart(8, '0')}`; }
const connectionString = process.env.HU01_TEST_DATABASE_URL;

describe.skipIf(!connectionString)('reciclagem de telefone com PostgreSQL real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const repository = new PostgresVerificationRepository(db);
  const userRepository = new PostgresUserRepository(db);
  const passwords = new PasswordService({ cost: 4, min_length: 8 });

  let now: Date;
  let sharedPhone: string;
  let delivery: MockVerificationDelivery;
  let app: ReturnType<typeof createApp>;
  let ids: bigint[];

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(() => {
    now = new Date('2026-10-23T12:00:00.000Z');
    sharedPhone = newPhone();
    ids = [];
    delivery = new MockVerificationDelivery();
    const verification = new VerificationService(repository, delivery, 'fixture-key-only-for-phone-recycling-tests', () => new Date(now));
    const sessions = new SessionService(userRepository, new PostgresSessionRepository(db), passwords, () => new Date(now));
    app = createApp(undefined, sessions, { verification, registration: new RegistrationService(userRepository, verification, passwords) });
  });

  afterEach(async () => {
    if (!ids.length) return;
    await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, ids));
    await db.delete(verificationChallenges).where(inArray(verificationChallenges.user_id, ids));
    await db.delete(rateLimits).where(inArray(rateLimits.user_id, ids));
    await db.delete(users).where(inArray(users.id, ids));
  });
  afterAll(async () => { await pool.end(); });

  async function register(phone = sharedPhone, confirmEmail = true): Promise<Account> {
    const email = `phone-${randomUUID()}@example.com`;
    const response = await request(app).post('/auth/register').send({ name: 'Ana', email, phone, password: 'senha-segura' }).expect(201);
    const id = response.body.data.user.id as string;
    ids.push(BigInt(id));
    const emailCode = delivery.email.outbox.at(-1)!.code;
    const token = (await request(app).post('/auth/login').send({ email, password: 'senha-segura' }).expect(200)).body.data.token as string;
    
    if (confirmEmail) {
      await request(app).post('/auth/verifications/email/confirm').set('Authorization', `Bearer ${token}`)
        .send({ challenge_id: response.body.data.email_verification.challenge_id, code: emailCode }).expect(200);
    }
    return { id, email, token, email_verified_at: confirmEmail ? now.toISOString() : null };
  }

  async function prepare(account: Account): Promise<PhoneChallenge> {
    const result = await request(app).post('/auth/verifications/phone/send').set('Authorization', `Bearer ${account.token}`).expect(200);
    return { challenge_id: result.body.data.challenge_id, code: delivery.phone.outbox.at(-1)!.code };
  }

  function confirm(account: Account, challenge: PhoneChallenge) {
    return request(app).post('/auth/verifications/phone/confirm').set('Authorization', `Bearer ${account.token}`).send(challenge);
  }

  async function verify(account: Account) {
    const challenge = await prepare(account);
    await confirm(account, challenge).expect(200);
    return challenge;
  }

  async function me(account: Account) {
    return (await request(app).get('/auth/me').set('Authorization', `Bearer ${account.token}`).expect(200)).body.data.user;
  }

  // --- Helpers adicionados para resolver code smells de duplicação ---
  async function expectStatus(account: Account, status: 'pending' | 'verified') {
    expect((await me(account)).status).toBe(status);
  }

  async function registerVerified(phone = sharedPhone): Promise<Account> {
    const account = await register(phone);
    await verify(account);
    return account;
  }

  async function confirmConcurrently(first: Account, second: Account) {
    const firstCode = await prepare(first);
    const secondCode = await prepare(second);
    return Promise.all([confirm(first, firstCode), confirm(second, secondCode)]);
  }
  // ------------------------------------------------------------------

  it('transferência retira acesso protegido da conta anterior na próxima requisição', async () => {
    const previous = await register();
    const previousChallenge = await verify(previous);
    
    const created = await request(app).post('/groups/group-1/decision-processes')
      .set('Authorization', `Bearer ${previous.token}`).set('X-Mock-User-Id', 'admin-group-1').send({
        name: 'Maioria ordinária', configuration: {
          decisionType: 'SIMPLE_MAJORITY', qualifiedMajorityPercentage: null, votingMode: 'OPEN', quorumPercentage: 50,
          quorumFailureRule: { behavior: 'CONTINUE' }, tieRule: { result: 'REJECTED' },
          inconclusiveRule: { behavior: 'FINISH' }, invalidityRule: { behavior: 'FINISH' },
          maxRestarts: 0, requiredParticipantIds: ['member-group-1'],
        },
      }).expect(201);
    
    const path = `/groups/group-1/decision-processes/${created.body.process.id}`;
    const next = await register();
    
    expect((await userRepository.findById(previous.id))!.phone).toBe((await userRepository.findById(next.id))!.phone);
    await request(app).get(path).set('Authorization', `Bearer ${previous.token}`).set('X-Mock-User-Id', 'admin-group-1').expect(200);
    
    await verify(next);
    
    const denied = await request(app).get(path).set('Authorization', `Bearer ${previous.token}`)
      .set('X-Mock-User-Id', 'admin-group-1').expect(403);
    
    expect(denied.body.error).toMatchObject({ code: 'ACCOUNT_NOT_VERIFIED', details: {} });
    await request(app).get(path).set('Authorization', `Bearer ${next.token}`).set('X-Mock-User-Id', 'admin-group-1').expect(200);
    
    expect(await me(previous)).toMatchObject({ status: 'pending', email_verified_at: previous.email_verified_at, phone_verified_at: null });
    expect(await me(next)).toMatchObject({ status: 'verified', phone_verified_at: now.toISOString() });
    
    expect((await confirm(previous, previousChallenge).expect(400)).body.error.code).toBe('VERIFICATION_CODE_CONSUMED');
    
    const sessions = await db.select().from(authenticationSessions).where(inArray(authenticationSessions.user_id, ids));
    expect(sessions).toHaveLength(2);
    expect(sessions.every(row => row.revoked_at === null)).toBe(true);
    
    await request(app).post('/auth/logout').set('Authorization', `Bearer ${previous.token}`).expect(204);
  });

  it('cadastro e somente e-mail mantêm pending e não retiram confirmação alheia', async () => {
    const owner = await registerVerified();
    const pending = await register(sharedPhone, false);
    
    expect(await me(pending)).toMatchObject({ status: 'pending', email_verified_at: null, phone_verified_at: null });
    
    await request(app).get('/groups/group-1/decision-processes/unknown').set('X-Mock-User-Id', 'admin-group-1').expect(401);
    
    const denied = await request(app).get('/groups/group-1/decision-processes/unknown').set('Authorization', `Bearer ${pending.token}`)
      .set('X-Mock-User-Id', 'admin-group-1').expect(403);
    
    expect(denied.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
    
    const emailOnly = await register();
    await expectStatus(emailOnly, 'pending');
    await expectStatus(owner, 'verified');
  });

  it('limpa todas as confirmações anteriores preservando seus e-mails', async () => {
    const first = await register();
    const second = await register();
    const third = await register();
    
    await db.update(users).set({ status: 'verified', phone_verified_at: now }).where(inArray(users.id, [BigInt(first.id), BigInt(second.id)]));
    await verify(third);
    
    for (const account of [first, second]) {
      expect(await me(account)).toMatchObject({ status: 'pending', email_verified_at: account.email_verified_at, phone_verified_at: null });
    }
    await expectStatus(third, 'verified');
  });

  it('confirmações concorrentes do mesmo número deixam um único proprietário vigente', async () => {
    const first = await register();
    const second = await register();
    
    const responses = await confirmConcurrently(first, second);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    
    const rows = await db.select().from(users).where(inArray(users.id, ids));
    expect(rows.filter(row => row.phone_verified_at !== null)).toHaveLength(1);
    expect(rows.filter(row => row.status === 'verified')).toHaveLength(1);
    expect(rows.filter(row => row.status === 'pending')).toHaveLength(1);
    expect(rows.every(row => row.email_verified_at !== null)).toBe(true);
    
    for (const account of [first, second]) {
      const current = await me(account);
      expect(current.status).toBe(rows.find(row => row.id.toString() === account.id)!.status);
    }
    
    const consumed = await db.select().from(verificationChallenges).where(inArray(verificationChallenges.user_id, ids));
    expect(consumed.filter(row => row.channel === 'phone').every(row => row.consumed_at !== null)).toBe(true);
  });

  it('números diferentes permanecem confirmados sob concorrência', async () => {
    const first = await register();
    let otherPhone = newPhone();
    while (otherPhone === sharedPhone) otherPhone = newPhone();
    const second = await register(otherPhone);
    
    const responses = await confirmConcurrently(first, second);
    expect(responses.every(response => response.status === 200)).toBe(true);
    
    await expectStatus(first, 'verified');
    await expectStatus(second, 'verified');
  });

  it('código incorreto, revogado ou expirado não transfere a confirmação', async () => {
    const owner = await registerVerified();
    const next = await register();
    const challenge = await prepare(next);
    
    const wrong = { ...challenge, code: challenge.code === '000000' ? '000001' : '000000' };
    for (let i = 0; i < 3; i++) await confirm(next, wrong).expect(400);
    
    expect((await confirm(next, challenge).expect(400)).body.error.code).toBe('VERIFICATION_CODE_REVOKED');
    await expectStatus(owner, 'verified');
    
    const retry = await prepare(next);
    now = new Date(now.getTime() + 5 * 60_000);
    
    expect((await confirm(next, retry).expect(400)).body.error.code).toBe('VERIFICATION_CODE_EXPIRED');
    await expectStatus(owner, 'verified');
    await expectStatus(next, 'pending');
  });

  it('rollback preserva o proprietário anterior, o desafio e a conta nova', async () => {
    const owner = await registerVerified();
    const next = await register();
    const challenge = await prepare(next);
    
    await expect(repository.withConfirmationLock(next.id, 'phone', async transaction => {
      await transaction.consumeAndVerify(challenge.challenge_id, 'phone', now);
      throw new Error('falha antes do commit');
    })).rejects.toThrow('falha antes do commit');
    
    await expectStatus(owner, 'verified');
    expect(await me(next)).toMatchObject({ status: 'pending', phone_verified_at: null });
    
    const [stored] = await db.select().from(verificationChallenges).where(eq(verificationChallenges.id, challenge.challenge_id));
    expect(stored.consumed_at).toBeNull();
    
    await confirm(next, challenge).expect(200);
    await expectStatus(owner, 'pending');
  });

  it('conta anterior pode solicitar novo desafio e recuperar o telefone por nova confirmação', async () => {
    const first = await registerVerified();
    const second = await registerVerified();
    
    await expectStatus(first, 'pending');
    await verify(first);
    
    await expectStatus(first, 'verified');
    await expectStatus(second, 'pending');
  });
});