import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import type { AuthIdentity, UserDto } from '../identity.types';
import { PasswordService } from '../password.service';
import type { NewSession, SessionRecord, SessionRepository } from '../session.repository';
import { addCalendarMonthUtc, hashSessionToken, SessionService } from '../session.service';
import { identityErrorHandler, requireAuthentication } from '../session.middleware';

class MemorySessions implements SessionRepository {
  rows = new Map<string, SessionRecord>();
  async create(row: NewSession) {
    this.rows.set(row.token_hash, { ...row, created_at: row.created_at ?? new Date(), revoked_at: null });
  }
  async renewIfValid(hash: string, now: Date, expires: Date) {
    const row = this.rows.get(hash);
    if (!row || row.revoked_at || row.expires_at <= now) return null;
    if (now > row.last_activity_at) row.last_activity_at = now;
    if (expires > row.expires_at) row.expires_at = expires;
    return { ...row };
  }
  async findByTokenHash(hash: string) { return this.rows.get(hash) ?? null; }
  async revoke(identity: AuthIdentity, now: Date) {
    const row = [...this.rows.values()].find(item => item.id === identity.session_id && item.user_id.toString() === identity.user_id);
    if (!row || row.revoked_at || row.expires_at <= now) return false;
    row.revoked_at = now;
    return true;
  }
  async currentChallenges() { return []; }
}

const passwords = new PasswordService({ cost: 4, min_length: 8 });
const hash = passwords.hash(' SenhaSegura ');
let now: Date;
let user: UserDto;
let repository: MemorySessions;
let service: SessionService;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  now = new Date('2026-01-31T23:45:12.345Z');
  user = { id: '9007199254740993', name: 'Ana', email: 'ana@example.com', phone: '+55 (11) 98765-4321',
    status: 'pending', email_verified_at: null, phone_verified_at: null, created_at: now.toISOString() };
  const password_hash = await hash;
  repository = new MemorySessions();
  service = new SessionService({
    findCredentialsByEmail: async email => email === user.email ? { user_id: user.id, password_hash } : null,
    findById: async id => id === user.id ? { ...user } : null,
  }, repository, passwords, () => new Date(now));
  app = createApp(undefined, service);
});
const credentials = { email: ' ANA@EXAMPLE.COM ', password: ' SenhaSegura ' };
async function login() {
  return request(app).post('/auth/login').send(credentials).expect(200);
}

describe('um mês de calendário UTC', () => {
  it.each([
    ['2026-01-31T23:45:12.345Z', '2026-02-28T23:45:12.345Z'],
    ['2028-01-31T23:45:12.345Z', '2028-02-29T23:45:12.345Z'],
    ['2026-12-31T00:00:00.000Z', '2027-01-31T00:00:00.000Z'],
    ['2026-03-31T00:00:00.000Z', '2026-04-30T00:00:00.000Z'],
    ['2026-02-28T00:00:00.000Z', '2026-03-28T00:00:00.000Z'],
  ])('%s → %s', (input, expected) => {
    const original = new Date(input);
    expect(addCalendarMonthUtc(original).toISOString()).toBe(expected);
    expect(original.toISOString()).toBe(input);
  });
});

describe('login e ciclo HTTP da sessão', () => {
  it('emite token opaco, persiste somente SHA-256 e admite conta pendente', async () => {
    const response = await login();
    expect(response.headers['cache-control']).toBe('no-store');
    const data = response.body.data;
    expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.token_type).toBe('Bearer');
    expect(data.expires_at).toBe('2026-02-28T23:45:12.345Z');
    expect(data.user).toEqual(user);
    const stored = repository.rows.get(hashSessionToken(data.token));
    expect(stored?.user_id).toBe(BigInt(user.id));
    expect(stored?.last_activity_at.toISOString()).toBe(now.toISOString());
    expect(stored?.token_hash).toHaveLength(64);
    expect(JSON.stringify(stored, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain(data.token);
    expect(data).not.toHaveProperty('password_hash');
  });

  it('usuário inexistente e senha errada retornam o mesmo erro', async () => {
    const wrong = await request(app).post('/auth/login').send({ ...credentials, password: 'senha-errada' }).expect(401);
    const absent = await request(app).post('/auth/login').send({ ...credentials, email: 'absent@example.com' }).expect(401);
    expect(wrong.body).toEqual(absent.body);
    expect(wrong.body.error).toEqual({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.', details: {} });
    expect(repository.rows.size).toBe(0);
  });

  it('não altera senha nem aceita truncamento acima de 72 bytes', async () => {
    for (const password of ['SenhaSegura', ' senhasegura ', 'a'.repeat(73)]) {
      await request(app).post('/auth/login').send({ ...credentials, password }).expect(401);
    }
  });

  it.each([{}, [], null, { ...credentials, email: 'invalido' }, { ...credentials, password: 123 }, { ...credentials, user_id: '1' }])('valida entrada %j', async input => {
    const response = await request(app).post('/auth/login').send(input).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toBeTypeOf('object');
  });

  it('JSON inválido utiliza envelope de identity', async () => {
    const response = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('mantém sessões independentes e logout só revoga a atual sem excluir', async () => {
    const first = (await login()).body.data.token;
    const second = (await login()).body.data.token;
    expect(first).not.toBe(second);
    const logout = await request(app).post('/auth/logout').set('Authorization', `Bearer ${first}`).expect(204);
    expect(logout.text).toBe('');
    expect(repository.rows.size).toBe(2);
    expect(repository.rows.get(hashSessionToken(first))?.revoked_at).toEqual(now);
    const denied = await request(app).get('/auth/me').set('Authorization', `Bearer ${first}`).expect(401);
    expect(denied.body.error.code).toBe('SESSION_REVOKED');
    await request(app).get('/auth/me').set('Authorization', `Bearer ${second}`).expect(200);
  });

  it('atividade renova validade, devolve usuário atual e nenhum segredo', async () => {
    const token = (await login()).body.data.token;
    now = new Date('2026-02-20T10:00:00.000Z');
    user = { ...user, status: 'verified', email_verified_at: now.toISOString(), phone_verified_at: now.toISOString() };
    const response = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body.data).toEqual({ user, verification_challenges: [] });
    const stored = repository.rows.get(hashSessionToken(token));
    expect(stored?.last_activity_at).toEqual(now);
    expect(stored?.expires_at.toISOString()).toBe('2026-03-20T10:00:00.000Z');
    expect(JSON.stringify(response.body)).not.toContain(token);
    user = { ...user, status: 'pending', phone_verified_at: null };
    const current = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(current.body.data.user.status).toBe('pending');
  });

  it('sessão expirada, inclusive no limite exato, não é reativada', async () => {
    const token = (await login()).body.data.token;
    const row = repository.rows.get(hashSessionToken(token))!;
    const previous = new Date(row.last_activity_at);
    now = new Date(row.expires_at);
    for (let i = 0; i < 2; i++) {
      const response = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    }
    expect(row.last_activity_at).toEqual(previous);
  });

  it('não aceita cookie, query, header mockado ou Bearer malformado', async () => {
    const token = (await login()).body.data.token;
    for (const path of ['/auth/me', '/auth/logout']) {
      const method = path.endsWith('logout') ? 'post' : 'get';
      await request(app)[method](path).set('Cookie', `token=${token}`).expect(401);
      await request(app)[method](`${path}?token=${token}`).set('X-Mock-User-Id', 'admin-group-1').expect(401);
      for (const header of ['Basic abc', 'Bearer abc', `Bearer ${token} extra`, `Bearer ${'x'.repeat(43)}`]) {
        const response = await request(app)[method](path).set('Authorization', header).expect(401);
        expect(response.body.error.code).toBe('UNAUTHENTICATED');
      }
    }
  });

  it('middleware disponibiliza somente identidade e conta pública', async () => {
    const token = (await login()).body.data.token;
    const probe = express();
    probe.get('/', requireAuthentication(service), (req, res) => res.json({ auth: req.auth, account: req.account }));
    probe.use(identityErrorHandler);
    const response = await request(probe).get('/').set('Authorization', `Bearer ${token}`).expect(200);
    expect(response.body.auth).toEqual({ user_id: user.id, session_id: repository.rows.get(hashSessionToken(token))!.id });
    expect(response.body.account).toEqual(user);
  });

  it('erros inesperados não expõem SQL, stack ou credenciais', async () => {
    repository.create = async () => { throw new Error('SQL segredo'); };
    const response = await request(app).post('/auth/login').send(credentials).expect(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno no servidor.', details: {} } });
  });
});
