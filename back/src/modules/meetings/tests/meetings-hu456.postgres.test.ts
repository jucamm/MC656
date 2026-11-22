import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import {
  authenticationSessions, meetingAgendaItems, meetingConferencing, meetingParticipationBlocks, meetingParticipants,
  meetingPolls, meetings, users,
} from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { composeMeetingServices } from '../meetings.composition';

const connectionString = process.env.HU04_TEST_DATABASE_URL && process.env.HU05_TEST_DATABASE_URL
  ? process.env.HU06_TEST_DATABASE_URL : undefined;

describe.skipIf(!connectionString)('HU04, HU05 e HU06 na mesma aplicação', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const ids: string[] = [];
  let accountIds: bigint[] = [];
  let now = new Date('2029-05-10T16:00:00.000Z');
  const startsAt = '2029-05-10T16:10:00.000Z';
  const clock = () => now;
  const password = 'senha de teste integrada';
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock)));

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  afterAll(async () => {
    try {
      if (ids.length) {
        await db.delete(meetingPolls).where(inArray(meetingPolls.meeting_id, ids));
        await db.delete(meetingAgendaItems).where(inArray(meetingAgendaItems.meeting_id, ids));
        await db.delete(meetingConferencing).where(inArray(meetingConferencing.meeting_id, ids));
        await db.delete(meetingParticipationBlocks).where(inArray(meetingParticipationBlocks.meeting_id, ids));
        await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, ids));
        await db.delete(meetings).where(inArray(meetings.id, ids));
      }
      if (accountIds.length) {
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, accountIds));
        await db.delete(users).where(inArray(users.id, accountIds));
      }
    } finally {
      await pool.end();
    }
  });

  it('mantém presencial e registra pautas, controla ingresso, modera e preserva histórico', async () => {
    const hash = await passwords.hash(password);
    const actors = await db.insert(users).values(['Organizador', 'Moderadora', 'Participante', 'Visitante'].map(name => ({
      name, email: randomUUID() + '@example.com', password_hash: hash,
      status: 'verified' as const, email_verified_at: now,
    }))).returning();
    accountIds = actors.map(actor => actor.id);
    const tokens = await Promise.all(actors.map(async ({ email }) => (await sessions.login({ email, password })).token));
    function call(method: 'get' | 'post' | 'put', path: string, actor: number) {
      return http[method](path).set('Authorization', 'Bearer ' + tokens[actor]);
    }

    await http.get('/meetings/' + randomUUID() + '/moderation').expect(401).expect('Cache-Control', 'no-store');
    const create = () => call('post', '/meetings', 0).send({
      subject: 'Assembleia', starts_at: startsAt, access: { visibility: 'public' },
      participant_emails: [actors[1].email, actors[2].email],
    }).expect(201);
    const first = await create();
    ids.push(first.body.data.id);
    const second = await create();
    ids.push(second.body.data.id);
    const meeting = '/meetings/' + ids[0];
    const inPerson = '/meetings/' + ids[1];

    for (const actor of [1, 2]) await call('post', meeting + '/invitation/accept', actor).expect(204);
    await call('put', meeting + '/moderators', 0).send({ participant_ids: [actors[1].id.toString()] }).expect(200);

    const defaultMode = await call('get', inPerson + '/conferencing', 0).expect(200);
    expect(defaultMode.body.data.mode).toBe('in_person');
    await call('post', inPerson + '/agenda-items', 0).send({ subject: 'Pauta presencial', context: 'Discussão local' }).expect(201);
    const proposed = await call('post', meeting + '/agenda-items', 2).send({ subject: 'Orçamento', context: 'Debater custos' }).expect(201);
    const rejected = await call('post', meeting + '/agenda-items', 2).send({ subject: 'Outro assunto', context: 'Debate' }).expect(201);
    expect(proposed.body.data.review_status).toBe('pending');
    const review = (id: string, actor: number, status: string) =>
      call('post', meeting + '/agenda-items/' + id + '/review', actor).send({ review_status: status });
    await review(proposed.body.data.id, 3, 'approved').expect(403);
    await review(proposed.body.data.id, 1, 'approved').expect(200);
    await review(rejected.body.data.id, 1, 'rejected').expect(200);
    const visibleAgenda = await call('get', meeting + '/agenda-items', 3).expect(200);
    expect(visibleAgenda.body.data.items.map((item: { review_status: string }) => item.review_status).sort()).toEqual(['approved', 'rejected']);

    const joinUrl = 'https://meet.google.com/abc-defg-hij';
    await call('put', meeting + '/conferencing', 0).send({ mode: 'hybrid', google_meet_url: joinUrl }).expect(200);
    const settings = await call('get', meeting + '/conferencing', 3).expect(200);
    expect(JSON.stringify(settings.body)).not.toContain(joinUrl);
    const join = (actor: number, accepted = true) =>
      call('post', meeting + '/conferencing/join', actor).send({ accepted_audio_video: accepted });
    await join(2).expect(409);
    now = new Date(startsAt);
    await join(3).expect(403);
    await join(2, false).expect(400);
    expect((await join(2).expect(200)).body.data).toEqual({ join_url: joinUrl });
    await call('put', meeting + '/participants/' + actors[2].id.toString() + '/block', 1).expect(204);
    await join(2).expect(403);
    await call('post', meeting + '/agenda-items', 2).send({ subject: 'Atalho', context: 'Teste de bloqueio' }).expect(403);
    await call('get', meeting + '/agenda-items', 2).expect(200);

    await call('post', meeting + '/polls', 3).send({ question: 'Sem permissão?' }).expect(403);
    const poll = await call('post', meeting + '/polls', 1).send({ question: 'Aprovar orçamento?' }).expect(201);
    await call('post', meeting + '/polls/' + poll.body.data.id + '/close', 1).expect(204);
    const open = await call('post', meeting + '/polls', 1).send({ question: 'Nova proposta?' }).expect(201);
    await call('post', meeting + '/end', 1).expect(204);
    await join(0).expect(409);
    await call('post', meeting + '/agenda-items', 0).send({ subject: 'Tardia', context: 'Reunião encerrada' }).expect(409);
    const [closed] = await db.select().from(meetingPolls).where(and(
      eq(meetingPolls.meeting_id, ids[0]), eq(meetingPolls.id, open.body.data.id),
    ));
    expect(closed.closed_at).toEqual(now);
    expect((await call('get', meeting + '/moderation', 3).expect(200)).body.data.phase).toBe('ended');
    await call('get', meeting + '/agenda-items', 3).expect(200);
    await call('post', inPerson + '/polls', 0).send({ question: 'Votação presencial?' }).expect(201);
  });
});
