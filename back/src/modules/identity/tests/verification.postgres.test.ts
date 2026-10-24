import { createHmac, randomUUID } from 'node:crypto';
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

const connectionString = process.env.HU01_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('verificação com PostgreSQL real e mock local', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const userRepository = new PostgresUserRepository(db);
  const repository = new PostgresVerificationRepository(db);
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const key = 'fixture-key-for-hmac-only-in-tests-32-bytes';
  let now: Date;
  let delivery: MockVerificationDelivery;
  let verification: VerificationService;
  let app: ReturnType<typeof createApp>;
  let ids: bigint[];
  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(() => {
    now = new Date('2026-10-23T12:00:00.000Z');
    ids = [];
    delivery = new MockVerificationDelivery();
    verification = new VerificationService(repository, delivery, key, () => new Date(now));
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

  async function register() {
    const email = `verification-${randomUUID()}@example.com`;
    const response = await request(app).post('/auth/register').send({ name: 'Ana', email, phone: '11987654321', password: 'senha-segura' }).expect(201);
    ids.push(BigInt(response.body.data.user.id));
    const login = await request(app).post('/auth/login').send({ email, password: 'senha-segura' }).expect(200);
    return { ...response.body.data, token: login.body.data.token as string };
  }
  async function challenge(userId: string) {
    const [row] = await db.select().from(verificationChallenges).where(eq(verificationChallenges.user_id, BigInt(userId)));
    return row;
  }
  function confirm(token: string, channel: string, id: string, code: string) {
    return request(app).post(`/auth/verifications/${channel}/confirm`).set('Authorization', `Bearer ${token}`)
      .send({ challenge_id: id, code });
  }
  function send(token: string, channel: string) {
    return request(app).post(`/auth/verifications/${channel}/send`).set('Authorization', `Bearer ${token}`);
  }
  async function verifyEmail(account: Awaited<ReturnType<typeof register>>) {
    const code = delivery.outbox.at(-1)!.code;
    await confirm(account.token, 'email', account.email_verification.challenge_id, code).expect(200);
  }

  it('cadastro → login → e-mail → telefone → me → logout sem expor códigos', async () => {
    const account = await register();
    expect(account.user.status).toBe('pending');
    expect(account.email_verification).toMatchObject({ delivery_status: 'sent', expires_at: '2026-10-23T12:30:00.000Z' });
    const emailCode = delivery.outbox.at(-1)!.code;
    expect(emailCode).toMatch(/^\d{6}$/);
    expect(delivery.outbox.at(-1)).toMatchObject({ channel: 'email', destination: account.user.email });
    const stored = await challenge(account.user.id);
    expect(stored.code_hmac).toBe(createHmac('sha256', key).update(`${account.user.id}:email:${stored.id}:${emailCode}`).digest('hex'));
    expect(stored).not.toHaveProperty('code');
    expect(account.email_verification).not.toHaveProperty('code');
    const email = await confirm(account.token, 'email', stored.id, emailCode).expect(200);
    expect(email.body.data.user).toMatchObject({ status: 'pending', email_verified_at: now.toISOString(), phone_verified_at: null });
    const phone = await send(account.token, 'phone').expect(200);
    expect(phone.body.data).toMatchObject({ channel: 'phone', expires_at: '2026-10-23T12:05:00.000Z' });
    const phoneCode = delivery.outbox.at(-1)!.code;
    expect(delivery.outbox.at(-1)).toMatchObject({ channel: 'phone', destination: '+55 (11) 98765-4321' });
    const verified = await confirm(account.token, 'phone', phone.body.data.challenge_id, phoneCode).expect(200);
    expect(verified.body.data.user).toMatchObject({ status: 'verified', email_verified_at: now.toISOString(), phone_verified_at: now.toISOString() });
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${account.token}`).expect(200);
    expect(me.body.data.verification_challenges).toHaveLength(2);
    expect(JSON.stringify(me.body)).not.toContain('code_hmac');
    expect(JSON.stringify(verified.body)).not.toContain('password_hash');
    await request(app).post('/auth/logout').set('Authorization', `Bearer ${account.token}`).expect(204);
  });

  it('telefone exige e-mail confirmado tanto para enviar quanto para confirmar', async () => {
    const account = await register();
    expect((await send(account.token, 'phone').expect(403)).body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect((await confirm(account.token, 'phone', randomUUID(), '123456').expect(403)).body.error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(delivery.outbox).toHaveLength(1);
  });

  it('reenvio substitui identificador e invalida o desafio anterior', async () => {
    const account = await register();
    const oldCode = delivery.outbox.at(-1)!.code;
    const resent = await send(account.token, 'email').expect(200);
    expect(resent.body.data.challenge_id).not.toBe(account.email_verification.challenge_id);
    expect((await confirm(account.token, 'email', account.email_verification.challenge_id, oldCode).expect(400)).body.error.code).toBe('INVALID_VERIFICATION_CODE');
    const row = await challenge(account.user.id);
    expect(row.failed_attempts).toBe(0);
    expect(row.id).toBe(resent.body.data.challenge_id);
    await confirm(account.token, 'email', row.id, delivery.outbox.at(-1)!.code).expect(200);
  });

  it('três erros revogam, persistem apesar do HTTP 400 e permitem novo desafio', async () => {
    const account = await register();
    const correct = delivery.outbox.at(-1)!.code;
    const wrong = correct === '000000' ? '000001' : '000000';
    const outcomes = await Promise.all([1, 2, 3].map(() => confirm(account.token, 'email', account.email_verification.challenge_id, wrong)));
    expect(outcomes.every(response => response.status === 400)).toBe(true);
    expect(outcomes.map(response => response.body.error.code).sort()).toEqual(['INVALID_VERIFICATION_CODE', 'INVALID_VERIFICATION_CODE', 'VERIFICATION_ATTEMPTS_EXCEEDED'].sort());
    const row = await challenge(account.user.id);
    expect(row.failed_attempts).toBe(3);
    expect(row.revoked_at).toEqual(now);
    expect((await confirm(account.token, 'email', row.id, correct).expect(400)).body.error.code).toBe('VERIFICATION_CODE_REVOKED');
    const resent = await send(account.token, 'email').expect(200);
    expect((await challenge(account.user.id)).failed_attempts).toBe(0);
    await confirm(account.token, 'email', resent.body.data.challenge_id, delivery.outbox.at(-1)!.code).expect(200);
  });

  it('não permite consumo concorrente duplicado', async () => {
    const account = await register();
    const id = account.email_verification.challenge_id;
    const code = delivery.outbox.at(-1)!.code;
    const responses = await Promise.all([confirm(account.token, 'email', id, code), confirm(account.token, 'email', id, code)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    expect(responses.find(response => response.status === 400)!.body.error.code).toBe('VERIFICATION_CODE_CONSUMED');
    const stored = await challenge(account.user.id);
    expect(stored.consumed_at).toEqual(now);
    expect(stored.failed_attempts).toBe(0);
  });

  it('reenvios concorrentes deixam somente um desafio corrente', async () => {
    const account = await register();
    const responses = await Promise.all([send(account.token, 'email'), send(account.token, 'email')]);
    expect(responses.every(response => response.status === 200)).toBe(true);
    const current = await challenge(account.user.id);
    const previous = responses.find(response => response.body.data.challenge_id !== current.id)!;
    expect((await confirm(account.token, 'email', previous.body.data.challenge_id, delivery.outbox.at(-1)!.code).expect(400)).body.error.code).toBe('INVALID_VERIFICATION_CODE');
    await confirm(account.token, 'email', current.id, delivery.outbox.at(-1)!.code).expect(200);
    expect((await db.select().from(verificationChallenges).where(eq(verificationChallenges.user_id, BigInt(account.user.id))))).toHaveLength(1);
  });

  it('código expirado no instante limite é recusado sem confirmar a conta', async () => {
    const account = await register();
    const code = delivery.outbox.at(-1)!.code;
    now = new Date(account.email_verification.expires_at);
    expect((await confirm(account.token, 'email', account.email_verification.challenge_id, code).expect(400)).body.error.code).toBe('VERIFICATION_CODE_EXPIRED');
    expect((await challenge(account.user.id)).consumed_at).toBeNull();
    expect((await userRepository.findById(account.user.id))!.email_verified_at).toBeNull();
  });

  it('telefone expira em cinco minutos', async () => {
    const account = await register();
    await verifyEmail(account);
    const phone = await send(account.token, 'phone').expect(200);
    const code = delivery.outbox.at(-1)!.code;
    now = new Date(phone.body.data.expires_at);
    expect((await confirm(account.token, 'phone', phone.body.data.challenge_id, code).expect(400)).body.error.code).toBe('VERIFICATION_CODE_EXPIRED');
  });

  it('não confirma desafio de outra conta nem do outro canal', async () => {
    const first = await register();
    const code = delivery.outbox.at(-1)!.code;
    const second = await register();
    expect((await confirm(second.token, 'email', first.email_verification.challenge_id, code).expect(400)).body.error.code).toBe('INVALID_VERIFICATION_CODE');
    expect((await challenge(first.user.id)).failed_attempts).toBe(0);
    await confirm(first.token, 'email', first.email_verification.challenge_id, code).expect(200);
    await send(first.token, 'phone').expect(200);
    expect((await confirm(first.token, 'phone', first.email_verification.challenge_id, code).expect(400)).body.error.code).toBe('INVALID_VERIFICATION_CODE');
  });

  it('falha de envio explícito preserva o desafio anterior e retorna 503 seguro', async () => {
    const account = await register();
    const code = delivery.outbox.at(-1)!.code;
    const previous = await challenge(account.user.id);
    delivery.fail = true;
    expect((await send(account.token, 'email').expect(503)).body.error).toEqual({ code: 'VERIFICATION_DELIVERY_FAILED', message: 'Não foi possível enviar o código. Tente novamente.', details: {} });
    expect(await challenge(account.user.id)).toEqual(previous);
    expect(delivery.outbox).toHaveLength(1);
    await confirm(account.token, 'email', previous.id, code).expect(200);
  });

  it('falha inicial mantém 201, conta persistida e login/reenvio disponíveis', async () => {
    delivery.fail = true;
    const account = await register();
    expect(account.email_verification).toEqual({ delivery_status: 'failed', challenge_id: null, expires_at: null });
    expect((await userRepository.findById(account.user.id))!.status).toBe('pending');
    expect(await challenge(account.user.id)).toBeUndefined();
    delivery.fail = false;
    await send(account.token, 'email').expect(200);
  });

  it('canal confirmado não recebe reenvio e desafio consumido não é reutilizado', async () => {
    const account = await register();
    const code = delivery.outbox.at(-1)!.code;
    await verifyEmail(account);
    expect((await send(account.token, 'email').expect(409)).body.error.code).toBe('CHANNEL_ALREADY_VERIFIED');
    expect((await confirm(account.token, 'email', account.email_verification.challenge_id, code).expect(400)).body.error.code).toBe('VERIFICATION_CODE_CONSUMED');
  });

  it('rollback não deixa consumo ou confirmação parcial', async () => {
    const account = await register();
    await expect(repository.withUserLock(account.user.id, async transaction => {
      await transaction.consumeAndVerify(account.email_verification.challenge_id, 'email', now);
      throw new Error('falha antes do commit');
    })).rejects.toThrow('falha antes do commit');
    expect((await challenge(account.user.id)).consumed_at).toBeNull();
    expect((await userRepository.findById(account.user.id))!.email_verified_at).toBeNull();
  });

  it('código com zeros iniciais é comparado como string', async () => {
    const account = await register();
    const id = account.email_verification.challenge_id;
    const code_hmac = createHmac('sha256', key).update(`${account.user.id}:email:${id}:001234`).digest('hex');
    await db.update(verificationChallenges).set({ code_hmac }).where(eq(verificationChallenges.id, id));
    await confirm(account.token, 'email', id, '001234').expect(200);
  });

  it('valida destino, canal, body e sessão usando o envelope de identity', async () => {
    const account = await register();
    for (const route of ['send', 'confirm']) {
      expect((await request(app).post(`/auth/verifications/email/${route}`).expect(401)).body.error.code).toBe('UNAUTHENTICATED');
    }
    const invalidChannel = await send(account.token, 'sms').expect(400);
    expect(invalidChannel.body.error.code).toBe('VALIDATION_ERROR');
    const invalidDestination = await send(account.token, 'email').send({ email: 'other@example.com' }).expect(400);
    expect(invalidDestination.body.error.code).toBe('VALIDATION_ERROR');
    for (const input of [{ challenge_id: account.email_verification.challenge_id, code: 123456 },
      { challenge_id: account.email_verification.challenge_id, code: '123456', user_id: '2' }]) {
      const response = await request(app).post('/auth/verifications/email/confirm').set('Authorization', `Bearer ${account.token}`).send(input).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await challenge(account.user.id)).failed_attempts).toBe(0);
  });
});
