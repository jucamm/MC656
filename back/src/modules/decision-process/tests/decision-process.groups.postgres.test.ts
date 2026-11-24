import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, groupInvitations, groupMemberships, groups, users } from '../../../db/schema';
import { GroupInvitationsService } from '../../groups/group-invitations.service';
import { PostgresGroupsRepository } from '../../groups/groups.repository';
import { GroupsService } from '../../groups/groups.service';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { PersistedDecisionProcessGroupAccess } from '../decision-process.group-access';
import { InMemoryDecisionProcessRepository } from '../repositories/in-memory-decision-process.repository';

const connectionString = process.env.HU02_TEST_DATABASE_URL;
const password = 'senha-segura';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function configuration(requiredParticipantIds: string[] = []) {
  return {
    decisionType: 'SIMPLE_MAJORITY', qualifiedMajorityPercentage: null, votingMode: 'OPEN', quorumPercentage: 50,
    quorumFailureRule: { behavior: 'CONTINUE' }, tieRule: { result: 'REJECTED' },
    inconclusiveRule: { behavior: 'FINISH' }, invalidityRule: { behavior: 'FINISH' }, maxRestarts: 0, requiredParticipantIds,
  };
}

describe.skipIf(!connectionString)('processos decisórios com vínculos reais', () => {
  const applicationName = `hu02-decision-${randomUUID()}`;
  const pool = new Pool({ connectionString, application_name: applicationName });
  const db = drizzle({ client: pool });
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const groupsRepository = new PostgresGroupsRepository(db);
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords);
  let passwordHash: string;
  let client: ReturnType<typeof request>;
  let processes: InMemoryDecisionProcessRepository;
  let accounts: { id: bigint; email: string; token: string }[] = [];

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    passwordHash = await passwords.hash(password);
  });
  beforeEach(async () => {
    processes = new InMemoryDecisionProcessRepository();
    client = request(createApp(processes, sessions, undefined, {
      decisionProcessGroupAccess: new PersistedDecisionProcessGroupAccess(groupsRepository),
      groups: { groups: new GroupsService(groupsRepository), invitations: new GroupInvitationsService(groupsRepository) },
    }));
    accounts = [];
    const fixtures = await db.insert(users).values(['Ana', 'Bruno', 'Carla'].map(name => ({
      name, email: `${randomUUID()}@example.com`, password_hash: passwordHash,
      status: 'verified' as const, email_verified_at: new Date(),
    }))).returning({ id: users.id, email: users.email });
    accounts = fixtures.map(user => ({ ...user, token: '' }));
    for (const account of accounts) {
      const login = await client.post('/auth/login').send({ email: account.email, password }).expect(200);
      account.token = login.body.data.token;
    }
  });
  afterEach(async () => {
    if (!accounts.length) return;
    const userIds = accounts.map(account => account.id);
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

  async function createGroup(token: string) {
    const response = await client.post('/groups').set(auth(token)).send({ name: 'Grupo' }).expect(201);
    return `/groups/${response.body.data.id}`;
  }

  async function invite(groupPath: string, adminToken: string, email: string) {
    const response = await client.post(`${groupPath}/invitations`).set(auth(adminToken)).send({ email }).expect(201);
    return `/group-invitations/${response.body.data.id}/accept`;
  }

  function createProcess(groupPath: string, token: string, ids: string[] = []) {
    return client.post(`${groupPath}/decision-processes`).set(auth(token)).send({
      name: 'Decisão', configuration: configuration(ids),
    });
  }

  it('condiciona acesso e participantes obrigatórios aos vínculos atuais do próprio grupo', async () => {
    const [ana, bruno, carla] = accounts;
    const groupPath = await createGroup(ana.token);
    const otherGroup = await createGroup(carla.token);
    const acceptPath = await invite(groupPath, ana.token, bruno.email);
    const pending = await createProcess(groupPath, ana.token, [bruno.id.toString(), '9223372036854775808']).expect(422);
    expect(pending.body).toMatchObject({ error: 'VALIDATION_ERROR', details: [
      { path: 'configuration.requiredParticipantIds[0]', code: 'INVALID_VALUE' },
      { path: 'configuration.requiredParticipantIds[1]', code: 'INVALID_VALUE' },
    ] });
    const denied = await createProcess(groupPath, bruno.token).expect(403);
    expect(denied.body.error).toBe('FORBIDDEN');
    await client.post(acceptPath).set(auth(bruno.token)).expect(200);
    const created = await createProcess(groupPath, ana.token, [bruno.id.toString()]).expect(201);
    const processId = created.body.process.id;
    const path = `${groupPath}/decision-processes/${processId}`;
    expect(created.body.activeVersion.createdByUserId).toBe(ana.id.toString());
    await client.get(path).set(auth(bruno.token)).expect(200);
    await client.get(path).set(auth(carla.token)).set('X-Mock-User-Id', ana.id.toString()).expect(403);
    const wrongGroup = await client.get(`${otherGroup}/decision-processes/${processId}`).set(auth(carla.token)).expect(404);
    expect(wrongGroup.body.error).toBe('PROCESS_NOT_FOUND');
    await client.put(path).set(auth(bruno.token)).send({ configuration: configuration() }).expect(403);
    await client.delete(`${groupPath}/members/${bruno.id}`).set(auth(ana.token)).expect(204);
    await client.get(path).set(auth(bruno.token)).expect(403);
    await client.post(`${path}/versions`).set(auth(ana.token))
      .send({ configuration: configuration([bruno.id.toString()]) }).expect(422);
    const history = await client.get(`${path}/versions`).set(auth(ana.token)).expect(200);
    expect(history.body.versions).toEqual([created.body.activeVersion]);
  });

  it('bloqueia leitura e escrita após exclusão e reabre o histórico após recuperação', async () => {
    const [ana] = accounts;
    const groupPath = await createGroup(ana.token);
    const groupId = groupPath.slice('/groups/'.length);
    const created = await createProcess(`/groups/${groupId.toUpperCase()}`, ana.token).expect(201);
    expect(created.body.process.groupId).toBe(groupId);
    const path = `${groupPath}/decision-processes/${created.body.process.id}`;
    await client.delete(groupPath).set(auth(ana.token)).expect(204);
    const unavailable = await client.get(path).set(auth(ana.token)).expect(404);
    expect(unavailable.body.error).toBe('GROUP_NOT_FOUND');
    await client.post(`${path}/versions`).set(auth(ana.token)).send({ configuration: configuration() }).expect(404);
    await client.post(`${groupPath}/restore`).set(auth(ana.token)).expect(200);
    const history = await client.get(`${path}/versions`).set(auth(ana.token)).expect(200);
    expect(history.body.versions).toEqual([created.body.activeVersion]);
    await client.put(path).set(auth(ana.token)).send({ configuration: configuration() }).expect(200);
  });

  it('mantém o lock do grupo até a escrita terminar e aplica o rebaixamento à próxima escrita', async () => {
    const [ana, bruno] = accounts;
    const groupPath = await createGroup(ana.token);
    const acceptPath = await invite(groupPath, ana.token, bruno.email);
    await client.post(acceptPath).set(auth(bruno.token)).expect(200);
    const rolePath = `${groupPath}/members/${bruno.id}/role`;
    await client.put(rolePath).set(auth(ana.token)).send({ role: 'ADMIN' }).expect(200);
    const created = await createProcess(groupPath, ana.token).expect(201);
    const path = `${groupPath}/decision-processes/${created.body.process.id}/versions`;
    const writing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalActivate = processes.setActiveVersion.bind(processes);
    vi.spyOn(processes, 'setActiveVersion').mockImplementationOnce(async (...args) => {
      writing.resolve();
      await release.promise;
      return originalActivate(...args);
    });
    const version = client.post(path).set(auth(bruno.token)).send({ configuration: configuration() }).then(result => result);
    const demotion = Promise.race([writing.promise, version]).then(() =>
      client.put(rolePath).set(auth(ana.token)).send({ role: 'MEMBER' }));
    const settled = Promise.allSettled([version, demotion]);
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [applicationName],
        );
        expect(waiting.rowCount).toBe(1);
      });
      release.resolve();
      expect((await version).status).toBe(201);
      expect((await demotion).status).toBe(200);
      await client.post(path).set(auth(bruno.token)).send({ configuration: configuration() }).expect(403);
      const history = await client.get(path).set(auth(bruno.token)).expect(200);
      expect(history.body.versions).toHaveLength(2);
    } finally {
      release.resolve();
      await settled;
    }
  });
});
