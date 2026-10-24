import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import { mockUsers, type MockUser } from '../../../mocks/mock-users';
import type { UserDto } from '../identity.types';
import { PasswordService } from '../password.service';
import { readTrustedOrigin } from '../cors.middleware';
import type { SessionRepository } from '../session.repository';
import { SessionService } from '../session.service';

const origin = 'http://localhost:5173';
const pendingToken = 'p'.repeat(43);
const verifiedToken = 'v'.repeat(43);
let app: ReturnType<typeof createApp>;
let sessions: SessionService;
let pending: UserDto;
let verified: UserDto;
let groupUsers: MockUser[];
beforeEach(() => {
  const date = '2026-10-23T12:00:00.000Z';
  pending = { id: '1', name: 'Ana', email: 'ana@example.com', phone: '+55 (11) 98765-4321', status: 'pending',
    email_verified_at: null, phone_verified_at: null, created_at: date };
  verified = { ...pending, id: '2', status: 'verified', email_verified_at: date, phone_verified_at: date };
  const repository: SessionRepository = { create: vi.fn(), renewIfValid: vi.fn(), findByTokenHash: vi.fn(), revoke: vi.fn(), currentChallenges: vi.fn() };
  sessions = new SessionService({ findById: vi.fn(), findCredentialsByEmail: vi.fn() }, repository,
    new PasswordService({ cost: 4, min_length: 8 }));
  vi.spyOn(sessions, 'authenticate').mockImplementation(async token => {
    const user = token === pendingToken ? pending : verified;
    return { identity: { user_id: user.id, session_id: '11111111-1111-4111-8111-111111111111' }, user: { ...user } };
  });
  vi.spyOn(sessions, 'me').mockImplementation(async identity => ({ user: identity.user_id === pending.id ? pending : verified, verification_challenges: [] }));
  groupUsers = [...mockUsers, { id: '2', name: 'Ana', memberships: mockUsers[0].memberships }];
  app = createApp(undefined, sessions, undefined, { trustedOrigin: origin, groupUsers });
});

describe('controle global de acesso', () => {
  it.each(['/api/pautas', '/groups/group-1/decision-processes/unknown', '/outro-recurso', '/auth/inexistente'])('visitante e pending não acessam %s', async path => {
    const visitor = await request(app).get(path).set('X-Mock-User-Id', 'admin-group-1').expect(401);
    expect(visitor.body.error.code).toBe('UNAUTHENTICATED');
    const denied = await request(app).get(path).set('Authorization', `Bearer ${pendingToken}`).expect(403);
    expect(denied.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
  });
  it('sem serviços configurados não volta à autenticação por mock', async () => {
    const closed = createApp();
    const response = await request(closed).get('/api/pautas').set('X-Mock-User-Id', 'admin-group-1').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('conta verified acessa leitura antes pública sem cookie ou header mockado', async () => {
    const response = await request(app).get('/api/pautas').set('Authorization', `Bearer ${verifiedToken}`).expect(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('conta pending mantém me e logout disponíveis', async () => {
    vi.spyOn(sessions, 'logout').mockResolvedValueOnce(undefined);
    expect((await request(app).get('/auth/me').set('Authorization', `Bearer ${pendingToken}`).expect(200)).body.data.user.status).toBe('pending');
    await request(app).post('/auth/logout').set('Authorization', `Bearer ${pendingToken}`).expect(204);
  });
  it('login permanece público e não resolve uma sessão', async () => {
    vi.spyOn(sessions, 'login').mockResolvedValueOnce({ token: pendingToken, token_type: 'Bearer', expires_at: '2026-11-23T12:00:00.000Z', user: pending });
    await request(app).post('/auth/login').send({ email: pending.email, password: 'senha-segura' }).expect(200);
    expect(sessions.authenticate).not.toHaveBeenCalled();
  });
  it('desverificação perde acesso com o mesmo token na requisição seguinte', async () => {
    await request(app).get('/api/pautas').set('Authorization', `Bearer ${verifiedToken}`).expect(200);
    verified = { ...verified, status: 'pending', phone_verified_at: null };
    expect((await request(app).get('/api/pautas').set('Authorization', `Bearer ${verifiedToken}`).expect(403)).body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
    expect(sessions.authenticate).toHaveBeenCalledTimes(2);
  });
  it('ID de grupo e papel vêm dos vínculos do servidor, ignorando header forjado', async () => {
    const created = await request(app).post('/groups/group-1/decision-processes')
      .set('Authorization', `Bearer ${verifiedToken}`).set('X-Mock-User-Id', 'admin-group-2').send({
        name: 'Processo autenticado', configuration: {
          decisionType: 'SIMPLE_MAJORITY', qualifiedMajorityPercentage: null, votingMode: 'OPEN', quorumPercentage: 50,
          quorumFailureRule: { behavior: 'CONTINUE' }, tieRule: { result: 'REJECTED' },
          inconclusiveRule: { behavior: 'FINISH' }, invalidityRule: { behavior: 'FINISH' },
          maxRestarts: 0, requiredParticipantIds: ['member-group-1'],
        },
      }).expect(201);
    expect(created.body.activeVersion.createdByUserId).toBe(verified.id);
    await request(app).get(`/groups/group-1/decision-processes/${created.body.process.id}`)
      .set('Authorization', `Bearer ${verifiedToken}`).expect(200);
    groupUsers.splice(groupUsers.findIndex(user => user.id === verified.id), 1);
    await request(app).get(`/groups/group-1/decision-processes/${created.body.process.id}`)
      .set('Authorization', `Bearer ${verifiedToken}`).set('X-Mock-User-Id', 'admin-group-1').expect(403);
  });
});

describe('origem confiável e preflight CORS', () => {
  it('preflight autorizado funciona sem Bearer, sem tocar a sessão', async () => {
    const response = await request(app).options('/auth/me').set('Origin', origin)
      .set('Access-Control-Request-Method', 'GET').set('Access-Control-Request-Headers', 'authorization, Content-Type').expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-headers']).toBe('Authorization, Content-Type');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers.vary).toContain('Origin');
    expect(response.text).toBe('');
    expect(sessions.authenticate).not.toHaveBeenCalled();
  });
  it('origem permitida não substitui autenticação', async () => {
    const response = await request(app).get('/api/pautas').set('Origin', origin).expect(401);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
  it.each(['http://evil.example', 'null', 'http://localhost:5174'])('recusa origem %s sem refletir wildcard', async incoming => {
    const response = await request(app).get('/api/pautas').set('Origin', incoming)
      .set('Authorization', `Bearer ${verifiedToken}`).expect(403);
    expect(response.body.error.code).toBe('CORS_NOT_ALLOWED');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(sessions.authenticate).not.toHaveBeenCalled();
  });
  it('preflight recusa método ou header não permitido', async () => {
    for (const [method, headers] of [['TRACE', 'authorization'], ['GET', 'x-mock-user-id']]) {
      const response = await request(app).options('/api/pautas').set('Origin', origin)
        .set('Access-Control-Request-Method', method).set('Access-Control-Request-Headers', headers).expect(403);
      expect(response.body.error.code).toBe('CORS_NOT_ALLOWED');
    }
  });
  it('preflight sem Origin é recusado', async () => {
    await request(app).options('/api/pautas').set('Access-Control-Request-Method', 'GET').expect(403);
  });
  it('resposta autenticada expõe Retry-After e permite chamadas sem Origin', async () => {
    const response = await request(app).get('/api/pautas').set('Origin', origin).set('Authorization', `Bearer ${verifiedToken}`).expect(200);
    expect(response.headers['access-control-expose-headers']).toBe('Retry-After');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    await request(app).get('/api/pautas').set('Authorization', `Bearer ${verifiedToken}`).expect(200);
  });
  it.each(['*', 'http://*', 'https://*.example.com', 'null', 'file:///tmp', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?q=1'])('recusa configuração inválida %s', value => {
    expect(() => readTrustedOrigin(value)).toThrow('TRUSTED_ORIGIN');
  });
  it('normaliza apenas a origem HTTP(S) configurada', () => {
    expect(readTrustedOrigin('https://example.com/')).toBe('https://example.com');
  });
});
