import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, groupMemberships, groups, meetingParticipants, meetings, users } from '../../../db/schema';
import { GroupsService } from '../../groups/groups.service';
import { PostgresGroupsRepository } from '../../groups/groups.repository';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { PostgresMeetingsRepository } from '../meetings.repository';
import { MeetingsService } from '../meetings.service';
import { validateCreateMeeting } from '../meetings.validator';

const connectionString = process.env.HU03_TEST_DATABASE_URL;
const clock = new Date('2028-02-29T10:00:00Z');
const body = { subject: ' Assembleia ', starts_at: '2028-02-29T08:00:00-03:00', access: { visibility: 'private' } };

describe.skipIf(!connectionString)('rotas de reuniões com PostgreSQL', () => {
  const applicationName = `hu03-meetings-${randomUUID()}`;
  const pool = new Pool({ connectionString, application_name: applicationName });
  const db = drizzle({ client: pool });
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, () => clock);
  const repository = new PostgresMeetingsRepository(db);
  const groupsRepository = new PostgresGroupsRepository(db);
  const groupService = new GroupsService(groupsRepository, () => clock);
  const app = request(createApp(undefined, sessions, undefined, { meetings: new MeetingsService(repository, () => clock) }));
  let fixture: { id: bigint; email: string; token: string }[] = [];
  let groupId: string;

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    const hash = await passwords.hash('Senha de teste');
    const accounts = await db.insert(users).values(['Organizador', 'Integrante', 'Convidado', 'Pendente', 'Outro integrante'].map((name, index) => ({
      name, email: `${randomUUID()}@example.com`, password_hash: hash,
      status: index === 3 ? 'pending' as const : 'verified' as const,
      email_verified_at: index === 3 ? null : clock,
    }))).returning({ id: users.id, email: users.email });

    fixture = accounts.map(account => ({ ...account, token: '' }));
    for (const account of fixture) {
      const response = await app.post('/auth/login').send({ email: account.email, password: 'Senha de teste' }).expect(200);
      account.token = response.body.data.token;
    }

    groupId = (await groupService.createGroup(fixture[0].id, 'Centro acadêmico')).id;
    await db.insert(groupMemberships).values({ group_id: groupId, user_id: fixture[1].id, role: 'MEMBER' });
  });

  afterEach(async () => {
    if (!fixture.length) return;
    const userIds = fixture.map(user => user.id);
    const owned = await db.select({ id: meetings.id }).from(meetings).where(inArray(meetings.created_by_user_id, userIds));
    if (owned.length) {
      const ids = owned.map(row => row.id);
      await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, ids));
      await db.delete(meetings).where(inArray(meetings.id, ids));
    }
    const ownedGroups = await db.select({ id: groups.id }).from(groups).where(inArray(groups.created_by_user_id, userIds));
    if (ownedGroups.length) {
      const ids = ownedGroups.map(row => row.id);
      await db.delete(groupMemberships).where(inArray(groupMemberships.group_id, ids));
      await db.delete(groups).where(inArray(groups.id, ids));
    }
    await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    fixture = [];
  });

  afterAll(async () => { await pool.end(); });

  function bearer(index: number) {
    return `Bearer ${fixture[index].token}`;
  }

  function create(index = 0) {
    return app.post('/meetings').set('Authorization', bearer(index));
  }

  function list(index: number) {
    return app.get('/meeting-invitations').set('Authorization', bearer(index));
  }

  function respond(id: string, index: number, action: 'accept' | 'decline' = 'accept') {
    return app.post(`/meetings/${id}/invitation/${action}`).set('Authorization', bearer(index));
  }

  function meetingList(index: number) {
    return app.get('/meetings').set('Authorization', bearer(index));
  }

  function detail(id: string, index: number) {
    return app.get(`/meetings/${id}`).set('Authorization', bearer(index));
  }

  function participantList(id: string, index: number) {
    return app.get(`/meetings/${id}/participants`).set('Authorization', bearer(index));
  }

  function grouped() {
    return { ...body, group_id: groupId, access: { visibility: 'private', audience: 'selected' } };
  }

  it('exige sessão válida e conta verificada para criação e caixa de convites', async () => {
    await app.post('/meetings').send(body).expect(401).expect('Cache-Control', 'no-store');
    await app.get('/meeting-invitations').expect(401);
    await create(3).send(body).expect(403);
    await list(3).expect(403);
  });

  it('cria reunião avulsa, confirma o criador e devolve somente os campos do DTO da reunião', async () => {
    const result = await create(2).set('Origin', 'http://localhost:5173').send(body).expect(201).expect('Cache-Control', 'no-store');
    const id = result.body.data.id;
    expect(result.headers.location).toBe(`/meetings/${id}`);
    expect(result.headers['access-control-expose-headers']).toContain('Location');
    expect(result.body).toEqual({
      data: { id, subject: 'Assembleia', starts_at: '2028-02-29T11:00:00.000Z', visibility: 'private',
        organizer_name: 'Convidado', actions: { can_manage: true } },
    });
    const [stored] = await db.select().from(meetings).where(eq(meetings.id, id));
    expect(stored).toMatchObject({ group_id: null, created_by_user_id: fixture[2].id, organizer_user_id: fixture[2].id });
    const participants = await db.select().from(meetingParticipants).where(eq(meetingParticipants.meeting_id, id));
    expect(participants).toMatchObject([{ user_id: fixture[2].id, origin: 'creator', status: 'confirmed' }]);
  });

  it('recusa início no passado ou no instante atual e JSON inválido', async () => {
    for (const startsAt of [clock.toISOString(), '2028-02-29T09:59:59.999Z']) {
      const result = await create().send({ ...body, starts_at: startsAt }).expect(400);
      expect(result.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: { starts_at: expect.any(String) } } });
    }
    await create().type('json').send('{inválido').expect(400);
    await create().send({ ...body, starts_at: '2028-02-29T10:00:00.001Z' }).expect(201);
  });

  it('exige administração vigente do grupo e recusa indicação por ID de pessoa externa', async () => {
    await create(1).send(grouped()).expect(403);
    await create(2).send(grouped()).expect(404);
    await create().send({ ...grouped(), participant_ids: [fixture[2].id.toString()] }).expect(422);
    await create().send({ ...grouped(), participant_emails: [`${randomUUID()}@example.com`] }).expect(422);
    expect(await db.select().from(meetings).where(eq(meetings.created_by_user_id, fixture[0].id))).toEqual([]);
  });

  it('confirma integrantes, deduplica seleções e permite somente ao destinatário aceitar', async () => {
    const result = await create().send({
      ...grouped(), participant_ids: [fixture[0].id.toString(), fixture[1].id.toString(), fixture[1].id.toString()],
      participant_emails: [fixture[1].email, fixture[2].email, fixture[2].email.toUpperCase()],
    }).expect(201);
    const id = result.body.data.id;
    const participants = () => db.select().from(meetingParticipants).where(eq(meetingParticipants.meeting_id, id));
    expect(await participants()).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: fixture[0].id, status: 'confirmed', origin: 'creator' }),
      expect.objectContaining({ user_id: fixture[1].id, status: 'confirmed', origin: 'group' }),
      expect.objectContaining({ user_id: fixture[2].id, status: 'pending', origin: 'invitation' }),
    ]));
    expect(await participants()).toHaveLength(3);
    expect((await list(1).expect(200)).body.data.items).toEqual([]);
    expect((await list(2).expect(200)).body.data.items).toEqual([
      { meeting_id: id, subject: 'Assembleia', starts_at: '2028-02-29T11:00:00.000Z', invited_by_user_name: 'Organizador' },
    ]);
    await respond(id, 1).expect(404);
    await respond(id, 2).send({ user_id: fixture[1].id.toString() }).expect(400);
    await respond(id, 2).expect(204);
    await respond(id, 2).expect(409);
    expect((await list(2).expect(200)).body.data.items).toEqual([]);
    expect((await participants()).find(row => row.user_id === fixture[2].id))
      .toMatchObject({ origin: 'invitation', status: 'confirmed', resolved_at: clock });
  });

  it('oculta convites de grupos excluídos e volta a exibi-los após a recuperação', async () => {
    const result = await create().send({
      ...grouped(), access: { visibility: 'public' }, participant_emails: [fixture[2].email],
    }).expect(201);
    const id = result.body.data.id;
    await groupService.deleteGroup(groupId, fixture[0].id);
    await create().send(grouped()).expect(404);
    expect((await list(2).expect(200)).body.data.items).toEqual([]);
    await respond(id, 2).expect(404);
    await groupService.restoreGroup(groupId, fixture[0].id);
    expect((await list(2).expect(200)).body.data.items).toMatchObject([{ meeting_id: id }]);
    await respond(id, 2, 'decline').expect(204);
    const [invitation] = await db.select().from(meetingParticipants).where(eq(meetingParticipants.user_id, fixture[2].id));
    expect(invitation).toMatchObject({ status: 'declined', resolved_at: clock });
  });

  it('pagina a caixa de convites sem repetir itens e aceita só uma resposta concorrente', async () => {
    for (const subject of ['Primeira reunião', 'Segunda reunião']) {
      await create().send({ ...body, subject, participant_emails: [fixture[2].email] }).expect(201);
    }
    const { items: [first], next_cursor: cursor } = (await list(2).query({ limit: 1 }).expect(200)).body.data;
    expect(cursor).toBe(first.meeting_id);
    const second = (await list(2).query({ limit: 1, cursor }).expect(200)).body.data;
    expect(second.items).toHaveLength(1);
    expect(second.items[0].meeting_id).not.toBe(first.meeting_id);
    expect(second.next_cursor).toBeNull();
    const responses = await Promise.all([respond(first.meeting_id, 2), respond(first.meeting_id, 2, 'decline')]);
    expect(responses.map(response => response.status).sort()).toEqual([204, 409]);
  });

  it('reavalia o horário após aguardar o lock mantido pela HU02', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blocker = groupsRepository.withGroupLock(groupId, async () => {
      entered.resolve();
      await release.promise;
    });

    let now = clock;
    const service = new MeetingsService(repository, () => now);
    const input = validateCreateMeeting(grouped());
    const pending = Promise.race([entered.promise, blocker]).then(() =>
      service.create({ id: fixture[0].id, name: 'Organizador' }, input));
    const outcomes = Promise.allSettled([blocker, pending]);

    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [applicationName],
        );
        expect(waiting.rowCount).toBe(1);
      });
      now = input.startsAt;
      release.resolve();
      const [held, creation] = await outcomes;
      expect(held.status).toBe('fulfilled');
      expect(creation).toMatchObject({ status: 'rejected', reason: { code: 'VALIDATION_ERROR' } });
      expect(await db.select().from(meetings).where(eq(meetings.created_by_user_id, fixture[0].id))).toEqual([]);
    } finally {
      release.resolve();
      await outcomes;
    }
  });

  it('aplica as quatro audiências tanto na listagem quanto na URL direta', async () => {
    await db.insert(groupMemberships).values({ group_id: groupId, user_id: fixture[4].id, role: 'ADMIN' });
    const cases = [
      [{ ...grouped(), access: { visibility: 'public' } }, [0, 1, 2, 4]],
      [{ ...grouped(), access: { visibility: 'private', audience: 'group' } }, [0, 1, 4]],
      [{ ...grouped(), participant_ids: [fixture[1].id.toString()] }, [0, 1]],
      [body, [0]],
    ] as const;
    const records = [];
    for (const [input, audience] of cases) {
      const { body: response } = await create().send(input).expect(201);
      records.push({ id: response.data.id as string, audience: new Set<number>(audience) });
    }

    for (const actor of [0, 1, 2, 4]) {
      const { body: response } = await meetingList(actor).expect(200).expect('Cache-Control', 'no-store');
      const listed = new Set(response.data.items.map((item: { id: string }) => item.id));
      for (const { id, audience } of records) {
        expect(listed.has(id)).toBe(audience.has(actor));
        const meeting = await detail(id, actor).expect(audience.has(actor) ? 200 : 404);
        if (audience.has(actor)) {
          expect(meeting.body.data.actions).toEqual({ can_manage: actor === 0 });
          expect(meeting.body.data).not.toHaveProperty('participants');
        } else {
          expect(meeting.body.error.code).toBe('MEETING_NOT_FOUND');
        }
      }
    }

    const [{ id }] = records;
    await app.get('/meetings').expect(401);
    await app.get(`/meetings/${id}`).expect(401);
    await meetingList(3).expect(403);
    await detail(id, 3).expect(403);
    await detail(randomUUID(), 2).expect(404);
    await detail('invalido', 2).expect(400);
  });

  it('usa o aceite externo e o vínculo atual para recalcular o acesso a cada consulta', async () => {
    const result = await create().send({
      ...grouped(), participant_ids: [fixture[1].id.toString()], participant_emails: [fixture[2].email, fixture[4].email],
    }).expect(201);
    const id = result.body.data.id;
    await detail(id, 2).expect(404);
    await respond(id, 4, 'decline').expect(204);
    await detail(id, 4).expect(404);
    await respond(id, 2).expect(204);
    await detail(id, 2).expect(200);
    await detail(id, 1).expect(200);
    await groupService.removeMember(groupId, fixture[0].id, fixture[1].id);
    await detail(id, 1).expect(404);
    await detail(id, 2).expect(200);
    const removed = await meetingList(1).expect(200);
    expect(removed.body.data.items).not.toContainEqual(expect.objectContaining({ id }));
    const accepted = await meetingList(2).expect(200);
    expect(accepted.body.data.items).toContainEqual(expect.objectContaining({ id }));
  });

  it('oculta reuniões de grupos excluídos mesmo do organizador e reaplica o acesso na recuperação', async () => {
    const { body: response } = await create().send({ ...grouped(), access: { visibility: 'public' } }).expect(201);
    const id = response.data.id;
    await groupService.deleteGroup(groupId, fixture[0].id);
    await detail(id, 2).expect(404);
    await detail(id, 0).expect(404);
    await participantList(id, 0).expect(404);
    const hidden = await meetingList(2).expect(200);
    expect(hidden.body.data.items).not.toContainEqual(expect.objectContaining({ id }));
    await groupService.restoreGroup(groupId, fixture[0].id);
    await detail(id, 2).expect(200);
    await participantList(id, 0).expect(200);
    const restored = await meetingList(2).expect(200);
    expect(restored.body.data.items).toContainEqual(expect.objectContaining({ id }));
  });

  it('pagina reuniões visíveis por início e UUID e valida o cursor', async () => {
    const startsAt = '2090-02-10T11:00:00.000Z';
    const { body: hidden } = await create(1).send({ ...body, starts_at: startsAt }).expect(201);
    const meetingIds: string[] = [];
    const startsAtPrecise = '2090-02-10T11:00:00.000123Z';
    for (const start of ['2090-02-11T11:00:00.000Z', startsAt, startsAt, startsAt]) {
      const { body: response } = await create().send({ ...body, starts_at: start }).expect(201);
      meetingIds.push(response.data.id);
    }

    await db.update(meetings).set({ starts_at: sql`${startsAtPrecise}::timestamptz` }).where(eq(meetings.id, meetingIds[3]));
    const tied = meetingIds.slice(1, 3).sort();
    let cursor = '2090-02-10T00:00:00.000000Z|00000000-0000-0000-0000-000000000000';
    for (const [offset, id] of [...tied, meetingIds[3], meetingIds[0]].entries()) {
      const { body: response } = await meetingList(0).query({ limit: 1, cursor }).expect(200);
      expect(response.data.items.map((item: { id: string }) => item.id)).toEqual([id]);
      expect(response.data.items).not.toContainEqual(expect.objectContaining({ id: hidden.data.id }));
      cursor = response.data.next_cursor;
      if (offset < 2) expect(cursor).toBe(`2090-02-10T11:00:00.000000Z|${id}`);
      else if (offset === 2) expect(cursor).toBe(`${startsAtPrecise}|${id}`);
      else expect(cursor).toBeNull();
    }
    await meetingList(0).query({ cursor: 'invalido' }).expect(400);
    await meetingList(0).query({ cursor: `2090-02-30T11:00:00.000000Z|${meetingIds[0]}` }).expect(400);
    await meetingList(0).query({ limit: 101 }).expect(400);
  });

  it('reserva a lista paginada de participantes ao organizador vigente', async () => {
    const { body: response } = await create().send({
      ...grouped(), participant_ids: [fixture[1].id.toString()], participant_emails: [fixture[2].email],
    }).expect(201);
    const id = response.data.id;
    await participantList(id, 1).expect(403);
    await participantList(id, 2).expect(404);
    await participantList(id, 3).expect(403);
    await participantList(id, 0).query({ cursor: '1e3' }).expect(400);
    await db.update(meetingParticipants).set({ is_moderator: true }).where(and(
      eq(meetingParticipants.meeting_id, id), eq(meetingParticipants.user_id, fixture[1].id),
    ));

    const { body: first } = await participantList(id, 0).query({ limit: 2 }).expect(200);
    expect(first.data).toEqual({ items: [
      { user_id: fixture[0].id.toString(), name: 'Organizador', origin: 'creator', status: 'confirmed', is_eligible: true, is_moderator: false },
      { user_id: fixture[1].id.toString(), name: 'Integrante', origin: 'group', status: 'confirmed', is_eligible: true, is_moderator: true },
    ], next_cursor: fixture[1].id.toString() });
    const { body: second } = await participantList(id, 0).query({ cursor: first.data.next_cursor }).expect(200);
    expect(second.data).toEqual({ items: [
      { user_id: fixture[2].id.toString(), name: 'Convidado', origin: 'invitation', status: 'pending', is_eligible: false, is_moderator: false },
    ], next_cursor: null });
    const { body: empty } = await participantList(id, 0).query({ cursor: fixture[2].id.toString() }).expect(200);
    expect(empty.data).toEqual({ items: [], next_cursor: null });

    await groupService.removeMember(groupId, fixture[0].id, fixture[1].id);
    const { body: revoked } = await participantList(id, 0).expect(200);
    expect(revoked.data.items[1]).toMatchObject({ status: 'confirmed', is_eligible: false, is_moderator: false });

    await respond(id, 2).expect(204);
    await db.update(meetings).set({ organizer_user_id: fixture[2].id }).where(eq(meetings.id, id));
    await participantList(id, 0).expect(403);
    await participantList(id, 2).expect(200);
    const { body: updated } = await detail(id, 2).expect(200);
    expect(updated.data).toMatchObject({ organizer_name: 'Convidado', actions: { can_manage: true } });
  });

  it('reverte a inserção da reunião se a persistência de participantes falhar', async () => {
    const id = randomUUID();
    const creator = {
      meeting_id: id, user_id: fixture[0].id, origin: 'creator' as const, status: 'confirmed' as const, created_at: clock,
    };
    await expect(repository.transaction(tx => tx.insertMeeting({
      id, subject: 'Falha de participantes', access_mode: 'selected', starts_at: new Date(body.starts_at),
      created_at: clock, created_by_user_id: fixture[0].id, organizer_user_id: fixture[0].id,
    }, [creator, creator]))).rejects.toMatchObject({ cause: { code: '23505' } });
    expect(await db.select().from(meetings).where(eq(meetings.id, id))).toEqual([]);
    expect(await db.select().from(meetingParticipants).where(eq(meetingParticipants.meeting_id, id))).toEqual([]);
  });
});
