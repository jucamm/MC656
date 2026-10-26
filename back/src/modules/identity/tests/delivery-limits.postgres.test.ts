import { randomUUID } from 'node:crypto';
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

describe.skipIf(!connectionString)('limites persistidos de envio', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const userRepository = new PostgresUserRepository(db);
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const key = 'fixture-hmac-delivery-limit-only-in-tests';
  const start = new Date('2026-10-23T12:00:00.000Z');

  let now: Date;
  let ids: bigint[];
  let delivery: MockVerificationDelivery;
  let app: ReturnType<typeof createApp>;

  function createInstance(mock: MockVerificationDelivery) {
    const sessions = new SessionService(userRepository, new PostgresSessionRepository(db), passwords, () => new Date(now));
    const verification = new VerificationService(new PostgresVerificationRepository(db), mock, key, () => new Date(now));
    return createApp(undefined, sessions, { verification, registration: new RegistrationService(userRepository, verification, passwords) });
  }

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(() => {
    now = new Date(start);
    ids = [];
    delivery = new MockVerificationDelivery();
    app = createInstance(delivery);
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
    const email = `limits-${randomUUID()}@example.com`;
    const response = await request(app).post('/auth/register').send({ name: 'Ana', email, phone: '11987654321', password: 'senha-segura' }).expect(201);
    ids.push(BigInt(response.body.data.user.id));
    const token = (await request(app).post('/auth/login').send({ email, password: 'senha-segura' }).expect(200)).body.data.token as string;
    return { id: response.body.data.user.id as string, email, token, verification: response.body.data.email_verification };
  }

  function send(account: Awaited<ReturnType<typeof register>>, channel = 'email', instance = app) {
    return request(instance).post(`/auth/verifications/${channel}/send`).set('Authorization', `Bearer ${account.token}`);
  }

  async function limits(account: Awaited<ReturnType<typeof register>>, channel = 'email') {
    return (await db.select().from(rateLimits).where(eq(rateLimits.user_id, BigInt(account.id))))
      .filter(row => row.channel === channel).sort((a, b) => a.window_type.localeCompare(b.window_type));
  }

  async function current(account: Awaited<ReturnType<typeof register>>) {
    const [row] = await db.select().from(verificationChallenges).where(eq(verificationChallenges.user_id, BigInt(account.id)));
    return row;
  }

  // --- Helpers adicionados para resolver code smells de duplicação ---
  function addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60_000);
  }

  async function expectLimits(account: Awaited<ReturnType<typeof register>>, dayCount: number, hourCount: number, channel = 'email') {
    const rows = await limits(account, channel);
    expect(rows.find(row => row.window_type === 'day')?.request_count).toBe(dayCount);
    expect(rows.find(row => row.window_type === 'hour')?.request_count).toBe(hourCount);
  }

  async function getDailyLimit(account: Awaited<ReturnType<typeof register>>, channel = 'email') {
    return (await limits(account, channel)).find(row => row.window_type === 'day')!;
  }

  async function sendMultiple(account: Awaited<ReturnType<typeof register>>, count: number, channel = 'email') {
    for (let i = 0; i < count; i++) {
      await send(account, channel).expect(200);
    }
  }

  async function fillDaily(account: Awaited<ReturnType<typeof register>>) {
    await sendMultiple(account, 2);
    now = addHours(start, 1);
    await sendMultiple(account, 2);
    return send(account).expect(200); // sexto envio, contando o cadastro
  }
  // ------------------------------------------------------------------

  it('permite três envios/hora, conta o cadastro e devolve Retry-After arredondado', async () => {
    const account = await register();
    await sendMultiple(account, 2);
    
    now = new Date(start.getTime() + 1);
    const previous = await current(account);
    const denied = await send(account).expect(429);
    
    expect(denied.body.error.code).toBe('VERIFICATION_RATE_LIMITED');
    expect(denied.headers['retry-after']).toBe('3600');
    expect(denied.body.error.details).toEqual({ retry_after_seconds: 3600, retry_at: '2026-10-23T13:00:00.000Z' });
    expect(delivery.outbox).toHaveLength(3);
    expect(await current(account)).toEqual(previous);
    
    await expectLimits(account, 3, 3);
    
    now = addHours(start, 1);
    await send(account).expect(200);
    
    await expectLimits(account, 4, 1);
    expect((await getDailyLimit(account)).window_started_at).toEqual(start);
  });

  it('permite seis/dia e bloqueia o sétimo por 72h sem estender a cada tentativa', async () => {
    const account = await register();
    await fillDaily(account);
    const previous = await current(account);
    
    expect(delivery.outbox).toHaveLength(6);
    
    const denied = await send(account).expect(429); // excesso diário tem prioridade sobre horário
    expect(denied.body.error.code).toBe('VERIFICATION_DELIVERY_BLOCKED');
    expect(denied.headers['retry-after']).toBe('259200');
    
    const until = addHours(now, 72); // 3 dias (3 * 24 horas)
    const daily = await getDailyLimit(account);
    
    expect(daily.blocked_until).toEqual(until);
    expect(daily.request_count).toBe(6);
    expect(await current(account)).toEqual(previous);
    
    now = addHours(start, 25); // janela diária expirou, bloqueio não
    
    const restarted = createInstance(new MockVerificationDelivery());
    const blocked = await send(account, 'email', restarted).expect(429);
    
    expect(blocked.body.error.details.retry_at).toBe(until.toISOString());
    expect((await getDailyLimit(account)).blocked_until).toEqual(until);
    
    now = new Date(until.getTime() - 1);
    expect((await send(account).expect(429)).headers['retry-after']).toBe('1');
    
    now = until;
    await send(account).expect(200);
    
    await expectLimits(account, 1, 1);
    expect((await getDailyLimit(account)).blocked_until).toBeNull();
  });

  it('falha do mock não inicia janelas nem cria desafio; primeiro sucesso ancora os prazos', async () => {
    delivery.email.fail = true;
    const account = await register();
    
    expect(account.verification).toEqual({ delivery_status: 'failed', challenge_id: null, expires_at: null });
    expect(await limits(account)).toEqual([]);
    expect(await current(account)).toBeUndefined();
    
    now = addHours(start, 10);
    await send(account).expect(503);
    expect(await limits(account)).toEqual([]);
    
    delivery.email.fail = false;
    await send(account).expect(200);
    
    for (const row of await limits(account)) {
      expect(row.window_started_at).toEqual(now);
      expect(row.request_count).toBe(1);
      expect(row.window_expires_at.getTime() - now.getTime()).toBe((row.window_type === 'hour' ? 1 : 24) * 60 * 60_000);
    }
  });

  it('falha no reenvio preserva as duas cotas e o desafio até a tentativa bem-sucedida', async () => {
    const account = await register();
    await send(account).expect(200);
    
    const before = await limits(account);
    const challenge = await current(account);
    
    delivery.fail = true;
    await send(account).expect(503);
    
    expect(await limits(account)).toEqual(before);
    expect(await current(account)).toEqual(challenge);
    
    delivery.fail = false;
    await send(account).expect(200); // terceiro é permitido
    await send(account).expect(429);
    
    await expectLimits(account, 3, 3);
  });

  it('canais e contas mantêm cotas independentes, inclusive para o mesmo telefone', async () => {
    const first = await register();
    const sixth = await fillDaily(first);
    const emailCode = delivery.email.outbox.at(-1)!.code;
    
    await send(first).expect(429);
    
    // Bloqueio de envio não impede confirmar o último desafio ainda válido.
    await request(app).post('/auth/verifications/email/confirm').set('Authorization', `Bearer ${first.token}`)
      .send({ challenge_id: sixth.body.data.challenge_id, code: emailCode }).expect(200);
    
    await sendMultiple(first, 3, 'phone');
    
    expect((await send(first, 'phone').expect(429)).body.error.code).toBe('VERIFICATION_RATE_LIMITED');
    
    await expectLimits(first, 3, 3, 'phone');
    expect((await getDailyLimit(first, 'email')).blocked_until).not.toBeNull();
    
    const second = await register();
    await expectLimits(second, 1, 1);
    await send(second).expect(200);
  });

  it('limita rajada concorrente entre instâncias sem dimensão de IP', async () => {
    const account = await register();
    const otherDelivery = new MockVerificationDelivery();
    const secondInstance = createInstance(otherDelivery);
    
    const responses = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      send(account, 'email', index % 2 ? secondInstance : app).set('X-Forwarded-For', `192.0.2.${index + 1}`)));
    
    expect(responses.filter(response => response.status === 200)).toHaveLength(2);
    expect(responses.filter(response => response.status === 429)).toHaveLength(8);
    expect(delivery.outbox.length + otherDelivery.outbox.length).toBe(3);
    
    await expectLimits(account, 3, 3);
  });

  it('concorrência no teto diário permite apenas o sexto e persiste um único bloqueio', async () => {
    const account = await register();
    await sendMultiple(account, 2);
    
    now = addHours(start, 1);
    await sendMultiple(account, 2); // cinco aceitos contando com o register
    
    const responses = await Promise.all(Array.from({ length: 5 }, () => send(account)));
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    
    const refused = responses.filter(response => response.status === 429);
    expect(refused).toHaveLength(4);
    expect(refused.every(response => response.body.error.code === 'VERIFICATION_DELIVERY_BLOCKED')).toBe(true);
    expect(new Set(refused.map(response => response.body.error.details.retry_at)).size).toBe(1);
    
    expect((await getDailyLimit(account)).request_count).toBe(6);
    expect(delivery.outbox).toHaveLength(6);
  });

  it('novo desafio zera erros de confirmação, preservando cotas de envio', async () => {
    const account = await register();
    const code = delivery.outbox.at(-1)!.code === '000000' ? '000001' : '000000';
    
    await request(app).post('/auth/verifications/email/confirm').set('Authorization', `Bearer ${account.token}`)
      .send({ challenge_id: account.verification.challenge_id, code }).expect(400);
      
    expect((await current(account)).failed_attempts).toBe(1);
    
    await send(account).expect(200);
    
    expect((await current(account)).failed_attempts).toBe(0);
    await expectLimits(account, 2, 2);
  });

  it('falha após janela expirar não reinicia contadores nem remove bloqueio anterior', async () => {
    const account = await register();
    await fillDaily(account);
    const refused = await send(account).expect(429);
    
    const until = new Date(refused.body.error.details.retry_at);
    const before = await limits(account);
    
    now = until;
    delivery.fail = true;
    await send(account).expect(503);
    
    expect(await limits(account)).toEqual(before);
    
    delivery.fail = false;
    await send(account).expect(200);
    
    await expectLimits(account, 1, 1);
  });
});