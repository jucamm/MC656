import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, groups, groupMemberships, meetingActionAssignments, meetingActionItems,
  meetingAgendaItems, meetings, meetingParticipants, meetingParticipationBlocks, meetingPolls, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { composeMeetingServices } from '../meetings.composition';

const connectionString = process.env.HU09_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('HU09 com PostgreSQL e autenticação real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const groupId = randomUUID();
  const meetingIds: string[] = [];
  const itemIds: string[] = [];
  let accounts: (typeof users.$inferSelect)[] = [];
  let tokens: string[] = [];
  let now = new Date('2036-06-10T12:00:00Z');
  const clock = () => now;
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    const password = 'senha de teste';
    const hash = await passwords.hash(password);
    accounts = await db.insert(users).values(['Admin', 'Moderadora', 'Responsável', 'Externo', 'Pendente'].map((name, index) => ({
      name, email: randomUUID() + '@example.test', password_hash: hash,
      status: index === 4 ? 'pending' as const : 'verified' as const, email_verified_at: index === 4 ? null : now,
    }))).returning();
    tokens = await Promise.all(accounts.map(async user => 'Bearer ' + (await sessions.login({ email: user.email, password })).token));
    await db.insert(groups).values({ id: groupId, name: 'Grupo HU09', created_by_user_id: accounts[0].id });
    await db.insert(groupMemberships).values([0, 1, 2, 4].map(index => ({
      group_id: groupId, user_id: accounts[index].id, role: index === 0 ? 'ADMIN' as const : 'MEMBER' as const,
    })));
  });

  afterAll(async () => {
    try {
      if (itemIds.length) {
        await db.delete(meetingActionAssignments).where(inArray(meetingActionAssignments.action_item_id, itemIds));
        await db.delete(meetingActionItems).where(inArray(meetingActionItems.id, itemIds));
      }
      if (meetingIds.length) {
        await db.delete(meetingParticipationBlocks).where(inArray(meetingParticipationBlocks.meeting_id, meetingIds));
        await db.delete(meetingPolls).where(inArray(meetingPolls.meeting_id, meetingIds));
        await db.delete(meetingAgendaItems).where(inArray(meetingAgendaItems.meeting_id, meetingIds));
        await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, meetingIds));
        await db.delete(meetings).where(inArray(meetings.id, meetingIds));
      }
      await db.delete(groupMemberships).where(eq(groupMemberships.group_id, groupId));
      await db.delete(groups).where(eq(groups.id, groupId));
      if (accounts.length) {
        const ids = accounts.map(user => user.id);
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, ids));
        await db.delete(users).where(inArray(users.id, ids));
      }
    } finally { await pool.end(); }
  });

  const call = (method: 'get' | 'post' | 'put', path: string, actor = 0) => http[method](path).set('Authorization', tokens[actor]);

  async function meeting(mode: 'public' | 'selected' | 'standalone' = 'public', organizer = 0) {
    const starts = new Date(now.getTime() + 60_000);
    const result = await call('post', '/meetings').send({
      subject: 'Reunião de teste', starts_at: starts.toISOString(),
      access: mode === 'selected' ? { visibility: 'private', audience: 'selected' } : { visibility: 'public' },
      ...(mode === 'standalone' ? {} : { group_id: groupId, participant_ids: [accounts[1].id.toString()],
        participant_emails: [accounts[3].email] }),
    }).expect(201);
    const id: string = result.body.data.id;
    meetingIds.push(id);
    const route = '/meetings/' + id;
    const agenda = await call('post', route + '/agenda-items').send({ subject: 'Organização', context: 'Discussão' }).expect(201);
    if (organizer !== 0) {
      await db.update(meetings).set({ organizer_user_id: accounts[organizer].id }).where(eq(meetings.id, id));
    }
    return { id, starts, route, collection: route + '/action-items', agendaId: agenda.body.data.id as string };
  }

  function input(agendaId: string, assignees = [1, 2]) {
    const id = randomUUID();
    itemIds.push(id);
    return { id, description: 'Registrar o encaminhamento', due_on: '2036-06-10',
      source: { kind: 'agenda_item', id: agendaId }, assignee_user_ids: assignees.map(i => accounts[i].id.toString()) };
  }

  it('distribui no grupo, exige consentimento e preserva recusa e saída após reatribuição e conclusão', async () => {
    const { collection, agendaId, route } = await meeting();
    await call('post', route + '/invitation/accept', 3).expect(204);
    await http.get(collection).expect(401).expect('Cache-Control', 'no-store');
    await call('get', collection, 4).expect(403);
    await call('get', collection, 3).expect(404);
    await call('get', collection + '/eligible-assignees', 1).expect(403);
    const candidates = await call('get', collection + '/eligible-assignees?limit=1').expect(200);
    expect(candidates.body.data.items).toEqual([{ user_id: accounts[0].id.toString(), name: 'Admin' }]);
    const tail = await call('get', collection + '/eligible-assignees?cursor=' + candidates.body.data.next_cursor).expect(200);
    expect(tail.body.data.items.map((row: { name: string }) => row.name)).toEqual(['Moderadora', 'Responsável']);
    const data = input(agendaId);
    await call('post', collection, 1).send(data).expect(403);
    await call('post', collection).send({ ...data, assignee_user_ids: [accounts[3].id.toString()] }).expect(422);
    const first = await call('post', collection).send(data).expect(201);
    const item = collection + '/' + data.id;
    expect(first.body.data).toMatchObject({ version: 1, pending_count: 2, accepted_count: 0 });
    await call('post', collection).send(data).expect(409);
    const list = await call('get', collection, 2).expect(200);
    expect(list.body.data.items).toEqual([expect.objectContaining({ id: data.id, awaiting_my_response: true })]);
    await expect(db.insert(meetingActionAssignments).values({ id: randomUUID(), action_item_id: data.id,
      user_id: accounts[1].id, proposed_by_user_id: accounts[0].id, proposed_at: now })).rejects.toThrow();
    const history = () => call('get', item + '/assignments').expect(200);
    const assignments = (await history()).body.data.items;
    const [one, two] = [1, 2].map(index => assignments.find((row: { user_id: string }) => row.user_id === accounts[index].id.toString()).id as string);
    const respond = (id: string, actor: number, version: number, decision: string) =>
      call('post', item + '/assignments/' + id + '/respond', actor).send({ expected_version: version, decision });
    await respond(one, 2, 1, 'accept').expect(404);
    await call('post', item + '/complete', 1).send({ expected_version: 1 }).expect(403);
    await respond(one, 1, 1, 'accept').expect(200);
    await respond(two, 2, 1, 'decline').expect(409);
    await respond(two, 2, 2, 'decline').expect(200);
    await call('post', item + '/assignments/' + one + '/withdraw', 1).send({ expected_version: 3 }).expect(200);
    const added = await call('post', item + '/assignments').send({ expected_version: 4, assignee_user_ids: data.assignee_user_ids }).expect(200);
    expect(added.body.data.pending_count).toBe(2);
    const current = await call('get', item, 1).expect(200);
    expect(current.body.data.my_assignment.id).not.toBe(one);
    await respond(current.body.data.my_assignment.id, 1, 5, 'accept').expect(200);

    await call('put', item + '/deadline').send({ expected_version: 6, due_on: '2036-06-10' }).expect(200);
    await call('put', item + '/deadline').send({ expected_version: 6, due_on: '2036-06-11' }).expect(200);
    const [stored] = await db.select().from(meetingActionItems).where(eq(meetingActionItems.id, data.id));
    expect(stored.due_revision).toBe(2);
    const done = await call('post', item + '/complete', 1).send({ expected_version: 7 }).expect(200);
    expect(done.body.data).toMatchObject({ status: 'completed', closed_by_user_id: accounts[1].id.toString() });
    expect((await history()).body.data.items.map((row: { state: string }) => row.state).sort())
      .toEqual(['accepted', 'declined', 'pending', 'withdrawn']);
  });

  it('isola audiências, origens e reuniões avulsas; só moderador integrante cancela', async () => {
    const restricted = await meeting('selected', 1);
    const outside = await meeting('standalone');
    await call('get', outside.collection).expect(404);
    await call('get', restricted.collection, 2).expect(404);
    const data = input(restricted.agendaId, [1]);
    await call('post', restricted.collection, 1).send(data).expect(403);
    await call('post', restricted.collection).send({ ...data, source: { kind: 'agenda_item', id: outside.agendaId } }).expect(422);
    await call('post', restricted.collection).send({ ...data, assignee_user_ids: [accounts[2].id.toString()] }).expect(422);
    await call('post', restricted.collection).send(data).expect(201);
    const item = restricted.collection + '/' + data.id;
    await call('get', outside.collection + '/' + data.id).expect(404);
    await call('post', item + '/cancel').send({ expected_version: 1 }).expect(403);
    const assignment = (await call('get', item, 1).expect(200)).body.data.my_assignment.id;
    const results = await Promise.all([
      call('post', item + '/cancel', 1).send({ expected_version: 1 }),
      call('post', item + '/assignments/' + assignment + '/respond', 1).send({ expected_version: 1, decision: 'accept' }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    await expect(db.update(meetingActionItems).set({ agenda_item_id: outside.agendaId }).where(eq(meetingActionItems.id, data.id)))
      .rejects.toThrow();
  });

  it('serializa conclusão e alteração de prazo da mesma versão', async () => {
    const fixture = await meeting();
    const data = input(fixture.agendaId, [1]);
    const results = await Promise.all([
      call('post', fixture.collection).send(data), call('post', fixture.collection).send(data),
    ]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const item = fixture.collection + '/' + data.id;
    const detail = await call('get', item, 1).expect(200);
    await call('post', item + '/assignments/' + detail.body.data.my_assignment.id + '/respond', 1)
      .send({ expected_version: 1, decision: 'accept' }).expect(200);
    const [completion, deadline] = await Promise.all([
      call('post', item + '/complete', 1).send({ expected_version: 2 }),
      call('put', item + '/deadline').send({ expected_version: 2, due_on: '2036-06-12' }),
    ]);
    expect([completion.status, deadline.status].sort()).toEqual([200, 409]);
    const saved = await call('get', item).expect(200);
    expect(saved.body.data).toMatchObject({
      version: 3, status: completion.status === 200 ? 'completed' : 'open',
      due_on: deadline.status === 200 ? '2036-06-12' : '2036-06-10',
    });
  });

  it('exige votação encerrada e revalida bloqueio, vínculo e exclusão lógica', async () => {
    const fixture = await meeting();
    await call('put', fixture.route + '/moderators').send({ participant_ids: [accounts[1].id.toString()] }).expect(200);
    now = fixture.starts;
    const poll = await call('post', fixture.route + '/polls').send({ question: 'Organizar atividade?' }).expect(201);
    const data = { ...input(fixture.agendaId), source: { kind: 'poll', id: poll.body.data.id } };
    await call('post', fixture.collection).send(data).expect(422);
    await call('post', fixture.route + '/polls/' + poll.body.data.id + '/close').expect(204);
    await call('post', fixture.collection).send(data).expect(201);
    const item = fixture.collection + '/' + data.id;
    await call('put', fixture.route + '/participants/' + accounts[1].id + '/block').expect(204);
    await call('post', item + '/cancel', 1).send({ expected_version: 1 }).expect(403);
    expect((await call('get', item, 1).expect(200)).body.data.actions.can_respond).toBe(false);
    const participant = await call('get', item, 2).expect(200);
    const assignmentId = participant.body.data.my_assignment.id;
    // A remoção de integrante detém o mesmo lock de grupo que a resposta à proposta.
    let response: Promise<request.Response> | undefined;
    await db.transaction(async tx => {
      await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for('update');
      response = call('post', item + '/assignments/' + assignmentId + '/respond', 2)
        .send({ expected_version: 1, decision: 'accept' }).then(result => result);
      await tx.delete(groupMemberships).where(and(eq(groupMemberships.group_id, groupId), eq(groupMemberships.user_id, accounts[2].id)));
    });
    expect((await response)?.status).toBe(404);
    await call('get', item, 2).expect(404);
    expect((await call('get', item).expect(200)).body.data.pending_count).toBe(0);
    await db.update(groups).set({ deleted_at: now, deletion_reason: 'ADMIN_DELETION' }).where(eq(groups.id, groupId));
    await call('get', item).expect(404);
    await db.update(groups).set({ deleted_at: null, deletion_reason: null }).where(eq(groups.id, groupId));
    await call('post', item + '/cancel').send({ expected_version: 1 }).expect(200);
    expect((await call('get', item + '/assignments').expect(200)).body.data.items).toHaveLength(2);
  });
});
