import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, groupInvitations, groupMemberships, groups, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { GroupInvitationsService } from '../group-invitations.service';
import { PostgresGroupsRepository } from '../groups.repository';
import { GroupsService } from '../groups.service';

const origin = 'http://localhost:5173';
const today = '2028-02-29T23:30:00.000Z';
const deadline = '2029-02-28T23:30:00.000Z';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('borda HTTP dos grupos', () => {
  function setup() {
    const db = drizzle.mock();
    const repository = new PostgresGroupsRepository(db);
    const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db));
    const user = { id: '1', name: 'Ana', email: 'ana@example.com', status: 'verified' as const,
      email_verified_at: today, created_at: today };
    const authenticate = vi.spyOn(sessions, 'authenticate').mockResolvedValue({
      identity: { user_id: user.id, session_id: randomUUID() }, user,
    });
    const groupsService = new GroupsService(repository);
    const app = createApp(undefined, sessions, undefined, {
      trustedOrigin: origin, groups: { groups: groupsService, invitations: new GroupInvitationsService(repository) },
    });
    return { client: request(app), authenticate, groupsService };
  }

  it('responde ao preflight DELETE sem sessão e conserva os headers permitidos', async () => {
    const { client, authenticate } = setup();
    const response = await client.options(`/groups/${randomUUID()}`).set('Origin', origin)
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'Authorization, Content-Type').expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-methods'].split(', ')).toContain('DELETE');
    expect(response.text).toBe('');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('valida IDs, campos e paginação com o envelope do módulo', async () => {
    const { client } = setup();
    const headers = auth('v'.repeat(43));
    const group = `/groups/${randomUUID()}`;
    for (const [path, field] of [
      ['/groups/inválido', 'groupId'], ['/groups?state=removed', 'state'], ['/groups?limit=101', 'limit'],
      ['/groups?limit=1&limit=2', 'limit'], ['/groups?cursor=invalid', 'cursor'], ['/groups?owner=1', 'query'],
      [`${group}/members?cursor=0`, 'cursor'], [`${group}/members/9223372036854775808`, 'userId'],
    ]) {
      const response = await client.get(path).set(headers).expect(400).expect('Cache-Control', 'no-store');
      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR', details: { fields: { [field]: expect.any(String) } } } });
    }
    const extra = await client.post('/groups').set(headers).send({ name: 'Grupo', actor_id: '99' }).expect(400);
    expect(extra.body.error.details.fields).toHaveProperty('body');
    await client.post('/groups').set(headers).send({ name: 5 }).expect(400);
    await client.put(`${group}/members/1/role`).set(headers).send({ role: 'OWNER' }).expect(400);
    await client.post(`${group}/invitations`).set(headers).send({ email: [] }).expect(400);
    await client.post(`${group}/restore`).set(headers).send({ actor_id: '99' }).expect(400);
  });

  it('separa o parsing e os erros de grupos dos processos decisórios', async () => {
    const { client, groupsService } = setup();
    const headers = auth('v'.repeat(43));
    const invalid = await client.post('/groups').set(headers).type('json').send('{').expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    const legacy = await client.post('/groups/group-1/decision-processes').set(headers).type('json').send('{').expect(400);
    expect(legacy.body.error).toBe('INVALID_JSON');
    expect(legacy.headers['cache-control']).toBeUndefined();
    vi.spyOn(groupsService, 'getGroup').mockRejectedValueOnce(new Error('detalhes internos do banco'));
    const internal = await client.get(`/groups/${randomUUID()}`).set(headers).expect(500);
    expect(internal.body.error.code).toBe('INTERNAL_ERROR');
    expect(internal.text).not.toContain('detalhes internos do banco');
  });
});

const connectionString = process.env.HU02_TEST_DATABASE_URL;

describe.skipIf(!connectionString)('API de grupos com sessão e persistência reais', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const repository = new PostgresGroupsRepository(db);
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords);
  const client = request(createApp(undefined, sessions, undefined, {
    trustedOrigin: origin,
    groups: { groups: new GroupsService(repository, () => now), invitations: new GroupInvitationsService(repository, () => now) },
  }));
  const password = 'senha-segura';
  let passwordHash: string;
  let now: Date;
  let accounts: { id: bigint; email: string; token: string }[] = [];

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    passwordHash = await passwords.hash(password);
  });
  beforeEach(async () => {
    now = new Date(today);
    accounts = [];
    const fixtures = await db.insert(users).values(['Ana', 'Bruno', 'Carla'].map((name, index) => ({
      name, email: `${randomUUID()}@example.com`, password_hash: passwordHash,
      status: index === 2 ? 'pending' as const : 'verified' as const,
      email_verified_at: index === 2 ? null : now,
    }))).returning({ id: users.id, email: users.email });
    accounts = fixtures.map(user => ({ ...user, token: '' }));
    for (const account of accounts) {
      const login = await client.post('/auth/login').send({ email: account.email, password }).expect(200);
      account.token = login.body.data.token;
    }
  });
  afterEach(async () => {
    if (!accounts.length) return;
    const userIds = accounts.map(user => user.id);
    const fixtures = await db.select({ id: groups.id }).from(groups).where(inArray(groups.created_by_user_id, userIds));
    const groupIds = fixtures.map(group => group.id);
    if (groupIds.length) {
      await db.delete(groupInvitations).where(inArray(groupInvitations.group_id, groupIds));
      await db.delete(groupMemberships).where(inArray(groupMemberships.group_id, groupIds));
      await db.delete(groups).where(inArray(groups.id, groupIds));
    }
    await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  });
  afterAll(async () => { await pool.end(); });

  async function createGroup(token: string, name = 'Grupo A') {
    const response = await client.post('/groups').set(auth(token)).set('Origin', origin).send({ name }).expect(201);
    const groupId = response.body.data.id as string;
    expect(response.headers.location).toBe(`/groups/${groupId}`);
    expect(response.headers['access-control-expose-headers']).toContain('Location');
    expect(response.headers['cache-control']).toBe('no-store');
    return groupId;
  }

  async function invite(groupId: string, token: string, email: string) {
    const response = await client.post(`/groups/${groupId}/invitations`).set(auth(token)).send({ email }).expect(201);
    return response.body.data.id as string;
  }

  it('recusa anônimos, contas pendentes e sessões revogadas', async () => {
    const [ana, , carla] = accounts;
    const anonymous = await client.get('/groups').set('X-Mock-User-Id', 'admin-group-1').expect(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
    const pending = await client.get('/group-invitations').set(auth(carla.token)).expect(403);
    expect(pending.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
    await client.post('/auth/logout').set(auth(ana.token)).expect(204);
    const revoked = await client.get('/groups').set(auth(ana.token)).expect(401);
    expect(revoked.body.error.code).toBe('SESSION_REVOKED');
  });

  it('cria, pagina, edita, exclui e recupera grupos no escopo do administrador', async () => {
    const [ana, bruno] = accounts;
    const a = await createGroup(ana.token);
    await createGroup(ana.token, 'Outro');
    const first = await client.get('/groups?limit=1').set(auth(ana.token)).expect(200);
    expect(first.body.data.items).toHaveLength(1);
    const cursor = first.body.data.next_cursor as string;
    const second = await client.get(`/groups?limit=1&cursor=${cursor}`).set(auth(ana.token)).expect(200);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].id).not.toBe(cursor);
    expect(second.body.data.next_cursor).toBeNull();
    await client.get(`/groups/${a}`).set(auth(bruno.token)).expect(404);
    const updated = await client.put(`/groups/${a}`).set(auth(ana.token)).send({ name: 'Editado' }).expect(200);
    expect(updated.body.data).toMatchObject({ id: a, name: 'Editado', my_role: 'ADMIN' });
    const deleted = await client.delete(`/groups/${a}`).set(auth(ana.token)).expect(204);
    expect(deleted.text).toBe('');
    await client.get(`/groups/${a}`).set(auth(ana.token)).expect(404);
    const archived = await client.get('/groups?state=deleted').set(auth(ana.token)).expect(200);
    expect(archived.body.data.items).toMatchObject([{ id: a, recoverable_until: deadline }]);
    await client.post(`/groups/${a}/restore`).set(auth(bruno.token)).expect(404);
    const restored = await client.post(`/groups/${a}/restore`).set(auth(ana.token)).expect(200);
    expect(restored.body.data).toMatchObject({ id: a, deleted_at: null, recoverable_until: null });
    await client.get(`/groups/${a}`).set(auth(ana.token)).expect(200);
    await client.delete(`/groups/${a}`).set(auth(ana.token)).expect(204);
    now = new Date(new Date(deadline).getTime() + 1);
    const expired = await client.post(`/groups/${a}/restore`).set(auth(ana.token)).expect(410);
    expect(expired.body.error.code).toBe('RECOVERY_WINDOW_EXPIRED');
  });

  it('expõe convite ao destinatário, aplica o aceite e protege a gestão de integrantes', async () => {
    const [ana, bruno] = accounts;
    const groupId = await createGroup(ana.token);
    const path = `/groups/${groupId}`;
    const id = await invite(groupId, ana.token, bruno.email);
    const invitationPath = `/group-invitations/${id}`;
    const duplicate = await client.post(`${path}/invitations`).set(auth(ana.token)).send({ email: bruno.email }).expect(409);
    expect(duplicate.body.error.code).toBe('INVITATION_ALREADY_PENDING');
    const sent = await client.get(`${path}/invitations`).set(auth(ana.token)).expect(200);
    expect(sent.body.data.items).toMatchObject([{ id, invited_user_id: bruno.id.toString() }]);
    const inbox = await client.get('/group-invitations').set(auth(bruno.token)).expect(200);
    expect(inbox.body.data.items).toMatchObject([{ id, invited_by_user_name: 'Ana' }]);
    await client.get(path).set(auth(bruno.token)).expect(404);
    await client.post(`${invitationPath}/accept`).set(auth(ana.token)).expect(404);
    const accepted = await client.post(`${invitationPath}/accept`).set(auth(bruno.token)).expect(200);
    expect(accepted.body.data).toMatchObject({ group: { id: groupId, my_role: 'MEMBER' }, invitation: { status: 'ACCEPTED' } });
    const members = await client.get(`${path}/members`).set(auth(bruno.token)).expect(200);
    expect(members.body.data.items).toEqual([
      { user_id: ana.id.toString(), name: 'Ana', role: 'ADMIN', joined_at: today },
      { user_id: bruno.id.toString(), name: 'Bruno', role: 'MEMBER', joined_at: today },
    ]);
    const ownMembership = await client.get(`${path}/members/${bruno.id}`).set(auth(bruno.token)).expect(200);
    expect(ownMembership.body.data.role).toBe('MEMBER');
    await client.put(`${path}/members/${bruno.id}/role`).set(auth(bruno.token))
      .set('X-Mock-User-Id', 'admin-group-1').send({ role: 'ADMIN' }).expect(403);
    const last = await client.delete(`${path}/members/${ana.id}`).set(auth(ana.token)).expect(409);
    expect(last.body.error.code).toBe('LAST_GROUP_ADMIN');
    await client.put(`${path}/members/${bruno.id}/role`).set(auth(ana.token)).send({ role: 'ADMIN' }).expect(200);
    await client.delete(`${path}/members/${ana.id}`).set(auth(ana.token)).expect(204);
    await client.get(path).set(auth(ana.token)).expect(404);
  });

  it('permite recusa e cancelamento com 204 e recusa novo aceite', async () => {
    const [ana, bruno] = accounts;
    const groupId = await createGroup(ana.token);
    const declined = await invite(groupId, ana.token, bruno.email);
    const response = await client.post(`/group-invitations/${declined}/decline`).set(auth(bruno.token)).expect(204);
    expect(response.text).toBe('');
    const cancelled = await invite(groupId, ana.token, bruno.email);
    await client.delete(`/groups/${groupId}/invitations/${cancelled}`).set(auth(ana.token)).expect(204);
    const retry = await client.post(`/group-invitations/${cancelled}/accept`).set(auth(bruno.token)).expect(409);
    expect(retry.body.error.code).toBe('INVITATION_RESOLVED');
  });
});
