import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import express from 'express';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticationSessions, groupMemberships, groups, meetingAgendaItems, meetingParticipants,
  meetingParticipationBlocks, meetings, users } from '../../../db/schema';
import { PostgresGroupsRepository } from '../../groups/groups.repository';
import { GroupsService } from '../../groups/groups.service';
import { PasswordService } from '../../identity/password.service';
import { identityErrorHandler, requireAuthentication, requireVerifiedAccount } from '../../identity/session.middleware';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { PostgresMeetingsRepository } from '../../meetings/meetings.repository';
import { meetingsNoStore } from '../../meetings/meetings.routes';
import { PostgresMeetingAgendaRepository } from '../meeting-agenda.repository';
import { createMeetingAgendaRouter } from '../meeting-agenda.routes';
import { MeetingAgendaService } from '../meeting-agenda.service';

const connectionString = process.env.HU04_TEST_DATABASE_URL;
const clock = new Date('2028-07-22T12:00:00Z');
const start = new Date('2028-07-22T12:30:00Z');
const password = 'Senha de teste da agenda';
const agenda = { subject: 'Orçamento', context: 'Discutir os valores previstos.' };

describe.skipIf(!connectionString)('pautas de reunião com PostgreSQL real', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, () => clock);
  const groupService = new GroupsService(new PostgresGroupsRepository(db), () => clock);
  const app = express().use('/meetings', meetingsNoStore).use(requireAuthentication(sessions), requireVerifiedAccount)
    .use(identityErrorHandler).use(createMeetingAgendaRouter(new MeetingAgendaService(new PostgresMeetingsRepository(db), () => clock)));

  let groupId: string;
  let owner: bigint;
  let member: bigint;
  let outsider: bigint;
  let reader: bigint;
  let pending: bigint;
  const tokens = new Map<bigint, string>();
  let meetingIds: string[] = [];

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });

  beforeEach(async () => {
    const hash = await passwords.hash(password);
    const accounts = await db.insert(users).values(['Organizadora', 'Moderadora', 'Externo', 'Leitora', 'Pendente'].map((name, i) => ({
      name, email: `${randomUUID()}@example.com`, password_hash: hash,
      status: i === 4 ? 'pending' as const : 'verified' as const, email_verified_at: i === 4 ? null : clock,
    }))).returning({ id: users.id, email: users.email });
    [owner, member, outsider, reader, pending] = accounts.map(account => account.id);
    for (const { id, email } of accounts) tokens.set(id, (await sessions.login({ email, password })).token);
    groupId = (await groupService.createGroup(owner, 'Grupo da agenda')).id;
    await db.insert(groupMemberships).values([
      { group_id: groupId, user_id: member, role: 'MEMBER' }, { group_id: groupId, user_id: reader, role: 'MEMBER' },
    ]);
  });

  afterEach(async () => {
    if (meetingIds.length) {
      await db.delete(meetingAgendaItems).where(inArray(meetingAgendaItems.meeting_id, meetingIds));
      await db.delete(meetingParticipationBlocks).where(inArray(meetingParticipationBlocks.meeting_id, meetingIds));
      await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, meetingIds));
      await db.delete(meetings).where(inArray(meetings.id, meetingIds));
    }
    const userIds = [...tokens.keys()];
    if (groupId) {
      await db.delete(groupMemberships).where(eq(groupMemberships.group_id, groupId));
      await db.delete(groups).where(eq(groups.id, groupId));
    }
    if (userIds.length) {
      await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    tokens.clear();
    meetingIds = [];
  });

  afterAll(async () => { await pool.end(); });

  async function meeting(access_mode: typeof meetings.$inferInsert.access_mode, linked = true) {
    const id = randomUUID();
    meetingIds.push(id);
    await db.insert(meetings).values({
      id, subject: 'Reunião para teste', starts_at: start, created_at: clock,
      created_by_user_id: owner, organizer_user_id: owner, group_id: linked ? groupId : null, access_mode,
    });
    await db.insert(meetingParticipants).values({
      meeting_id: id, user_id: owner, origin: 'creator', status: 'confirmed',
    });
    if (linked) {
      await db.insert(meetingParticipants).values({
        meeting_id: id, user_id: member, origin: 'group', status: 'confirmed', is_moderator: true,
      });
    }
    await db.insert(meetingParticipants).values({
      meeting_id: id, user_id: outsider, origin: 'invitation', status: 'pending',
    });
    return id;
  }

  function route(meetingId: string) {
    return `/meetings/${meetingId}/agenda-items`;
  }

  function read(meetingId: string, actor = owner) {
    return request(app).get(route(meetingId)).auth(tokens.get(actor)!, { type: 'bearer' });
  }

  function submit(meetingId: string, actor = owner, input: object = agenda) {
    return request(app).post(route(meetingId)).auth(tokens.get(actor)!, { type: 'bearer' }).send(input);
  }

  it('persiste uma pauta pendente com autoria da sessão e permite reler por outra conexão', async () => {
    const id = await meeting('selected');
    const { body: { data: item } } = await submit(id, member, { subject: '  Orçamento ', context: '  Explicação ' })
      .expect(201).expect('Cache-Control', 'no-store');
    expect(item).toEqual({
      id: expect.any(String), meeting_id: id, subject: 'Orçamento', context: 'Explicação', proposed_by_user_id: String(member),
      proposer_name: 'Moderadora', review_status: 'pending', created_at: clock.toISOString(), reviewed_at: null, reviewed_by_user_id: null,
    });

    const readerPool = new Pool({ connectionString });
    try {
      const rows = await new PostgresMeetingAgendaRepository(drizzle({ client: readerPool })).list(id, { limit: 20 });
      expect(rows).toMatchObject([{ id: item.id, proposed_by_user_id: member }]);
    } finally {
      await readerPool.end();
    }
  });

  it.each([
    ['public', true, [200, 200, 200], [201, 403, 403]],
    ['group', true, [200, 200, 404], [201, 403, 404]],
    ['selected', true, [200, 404, 404], [201, 404, 404]],
    ['selected', false, [404, 404, 404], [404, 404, 404]],
  ] as const)('preserva a audiência %s deste encontro (grupo=%s)', async (mode, linked, reads, writes) => {
    const id = await meeting(mode, linked);
    for (const [index, actor] of [member, reader, outsider].entries()) {
      await read(id, actor).expect(reads[index]);
      await submit(id, actor).expect(writes[index]);
    }
    await db.update(meetingParticipants).set({ status: 'confirmed', resolved_at: new Date() })
      .where(and(eq(meetingParticipants.meeting_id, id), eq(meetingParticipants.user_id, outsider)));
    await read(id, outsider).expect(200);
    await submit(id, outsider).expect(201);
  });

  it('reaplica bloqueio, audiência de grupo e estado terminal sem apagar o histórico', async () => {
    const id = await meeting('group');
    await submit(id, member).expect(201);
    const { body } = await read(id, member).expect(200);
    expect(body.data.actions).toEqual({ can_submit: true, can_review: true });

    await db.insert(meetingParticipationBlocks).values({ meeting_id: id, user_id: member, blocked_by_user_id: owner, blocked_at: clock });
    await submit(id, member).expect(403);
    const blocked = await read(id, member).expect(200);
    expect(blocked.body.data.actions).toEqual({ can_submit: false, can_review: false });
    await groupService.deleteGroup(groupId, owner);
    await read(id).expect(404);
    await submit(id).expect(404);
    await groupService.restoreGroup(groupId, owner);
    await db.update(meetings).set({ ended_at: start, ended_by_user_id: owner }).where(eq(meetings.id, id));
    const closed = await read(id).expect(200);
    expect(closed.body.data.items).toHaveLength(1);
    expect(closed.body.data.actions).toEqual({ can_submit: false, can_review: false });
    const refused = await submit(id).expect(409);
    expect(refused.body.error.code).toBe('MEETING_ENDED');
  });

  it('valida sessão, IDs e campos sem aceitar autor enviado pelo cliente', async () => {
    const id = await meeting('public');
    await request(app).get(route(id)).expect(401).expect('Cache-Control', 'no-store');
    await read(id, pending).expect(403);
    await read('inválido').expect(400);
    await read(id).query({ review_status: 'unknown' }).expect(400);
    await submit(id, owner, { ...agenda, proposed_by_user_id: String(member) }).expect(400);
    await request(app).post(route(id)).auth(tokens.get(owner)!, { type: 'bearer' })
      .type('application/json').send('{').expect(400);
  });

  it('pagina por UUID e aplica filtro antes do limite, isolado por reunião', async () => {
    const id = await meeting('public');
    const other = await meeting('public');
    const [firstId, secondId, thirdId] = [randomUUID(), randomUUID(), randomUUID()].sort();
    await db.insert(meetingAgendaItems).values([
      { ...agenda, id: firstId, meeting_id: id, proposed_by_user_id: member, created_at: clock },
      { ...agenda, id: secondId, meeting_id: id, proposed_by_user_id: member, created_at: clock,
        review_status: 'approved', reviewed_at: clock, reviewed_by_user_id: owner },
      { ...agenda, id: thirdId, meeting_id: id, proposed_by_user_id: owner, created_at: clock },
      { ...agenda, id: randomUUID(), meeting_id: other, proposed_by_user_id: owner, created_at: clock },
    ]);
    const first = await read(id, outsider).query({ limit: 1, review_status: 'pending' }).expect(200);
    expect(first.body.data).toMatchObject({ items: [{ id: firstId }], next_cursor: firstId });
    const next = await read(id, outsider).query({ limit: 1, cursor: firstId, review_status: 'pending' }).expect(200);
    expect(next.body.data).toMatchObject({ items: [{ id: thirdId }], next_cursor: null });
    const approved = await read(id, outsider).query({ review_status: 'approved' }).expect(200);
    expect(approved.body.data.items).toMatchObject([{ id: secondId, reviewed_by_user_id: String(owner), reviewed_at: clock.toISOString() }]);
  });

  it('reverte a inserção quando a projeção falha antes do commit', async () => {
    const id = await meeting('selected');
    const projection = vi.spyOn(PostgresMeetingAgendaRepository.prototype, 'get').mockRejectedValueOnce(new Error('falha simulada'));
    try { await submit(id).expect(500); } finally { projection.mockRestore(); }
    expect((await read(id).expect(200)).body.data.items).toEqual([]);
  });

  it('impõe referências e coerência da revisão no banco', async () => {
    const id = await meeting('public');
    const entry = { ...agenda, meeting_id: id, proposed_by_user_id: owner, created_at: clock };
    await expect(db.insert(meetingAgendaItems).values({ ...entry, id: randomUUID(), meeting_id: randomUUID() })).rejects.toThrow();
    await expect(db.insert(meetingAgendaItems).values({ ...entry, id: randomUUID(), proposed_by_user_id: -1n })).rejects.toThrow();
    await expect(db.insert(meetingAgendaItems).values({ ...entry, id: randomUUID(), reviewed_by_user_id: owner })).rejects.toThrow();
    await expect(db.insert(meetingAgendaItems).values({ ...entry, id: randomUUID(), review_status: 'rejected', reviewed_at: clock })).rejects.toThrow();
    await expect(db.insert(meetingAgendaItems).values({
      ...entry, id: randomUUID(), review_status: 'approved', reviewed_at: new Date(clock.valueOf() - 1), reviewed_by_user_id: owner,
    })).rejects.toThrow();
  });
});
