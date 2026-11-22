import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app';
import {
  authenticationSessions, groups, meetingConferencing, meetingParticipants, meetingParticipationBlocks, meetings, users,
} from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { PostgresMeetingsRepository } from '../../meetings/meetings.repository';
import { MeetingsService } from '../../meetings/meetings.service';
import { createMeetingConferencingRouter } from '../meeting-conferencing.routes';
import { MeetingConferencingService } from '../meeting-conferencing.service';

const connectionString = process.env.HU05_TEST_DATABASE_URL;
const startsAt = new Date('2028-04-12T10:00:00Z');
const createdAt = new Date('2028-04-12T09:30:00Z');
const url = 'https://meet.google.com/abc-defg-hij';
const update = { mode: 'virtual', google_meet_url: url };
const consent = { accepted_audio_video: true };

describe.skipIf(!connectionString)('videoconferência com PostgreSQL e sessão persistida', () => {
  const applicationName = `hu05-${randomUUID()}`;
  const pool = new Pool({ connectionString, application_name: applicationName });
  const db = drizzle({ client: pool });
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, () => createdAt);
  const meetingRepository = new PostgresMeetingsRepository(db);
  let clock = createdAt;
  const app = createApp(undefined, sessions, undefined, {
    meetings: new MeetingsService(meetingRepository, () => clock),
  });
  app.use(createMeetingConferencingRouter(new MeetingConferencingService(meetingRepository, () => clock)));
  const api = request(app);
  let meetingId: string;
  let groupId: string | undefined;
  let people: { id: bigint; bearer: string }[] = [];

  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });

  beforeEach(async () => {
    clock = createdAt;
    meetingId = randomUUID();
    groupId = undefined;
    const password = 'Senha de teste HU05';
    const passwordHash = await passwords.hash(password);
    const accounts = await db.insert(users).values(['Organizadora', 'Convidado', 'Leitora', 'Pendente']
      .map((name, index) => ({
        name, email: `${randomUUID()}@example.com`, password_hash: passwordHash,
        status: index === 3 ? 'pending' as const : 'verified' as const,
        email_verified_at: index === 3 ? null : createdAt,
      }))).returning({ id: users.id, email: users.email });
    people = accounts.map(({ id }) => ({ id, bearer: '' }));
    for (const [index, account] of accounts.entries()) {
      const response = await api.post('/auth/login').send({ email: account.email, password }).expect(200);
      people[index].bearer = `Bearer ${response.body.data.token}`;
    }
    await db.insert(meetings).values({
      id: meetingId, subject: 'Encontro', starts_at: startsAt, created_at: createdAt,
      created_by_user_id: people[0].id, organizer_user_id: people[0].id, access_mode: 'public',
    });
    await db.insert(meetingParticipants).values([
      { meeting_id: meetingId, user_id: people[0].id, origin: 'creator', status: 'confirmed', created_at: createdAt },
      { meeting_id: meetingId, user_id: people[1].id, origin: 'invitation', status: 'pending', created_at: createdAt },
    ]);
  });

  afterEach(async () => {
    await db.delete(meetingConferencing).where(eq(meetingConferencing.meeting_id, meetingId));
    await db.delete(meetingParticipationBlocks).where(eq(meetingParticipationBlocks.meeting_id, meetingId));
    await db.delete(meetingParticipants).where(eq(meetingParticipants.meeting_id, meetingId));
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    if (groupId) await db.delete(groups).where(eq(groups.id, groupId));
    if (!people.length) return;
    const userIds = people.map(({ id }) => id);
    await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    people = [];
  });

  afterAll(async () => { await pool.end(); });

  const route = () => `/meetings/${meetingId}/conferencing`;
  const get = (actor = 0) => api.get(route()).set('Authorization', people[actor].bearer);
  const configure = (actor = 0, body: object = update) => api.put(route()).set('Authorization', people[actor].bearer).send(body);
  const join = (actor = 0, body: object = consent) => api.post(`${route()}/join`).set('Authorization', people[actor].bearer).send(body);

  async function acceptInvitation() {
    await api.post(`/meetings/${meetingId}/invitation/accept`).set('Authorization', people[1].bearer).expect(204);
  }

  it('mapeia reuniões anteriores para presencial e remove a configuração ao voltar para presencial', async () => {
    expect((await get().expect(200)).body.data).toEqual({
      mode: 'in_person', actions: { can_configure: true, can_join: false },
    });
    expect((await configure().expect(200)).body.data).toEqual({
      mode: 'virtual', actions: { can_configure: true, can_join: false },
    });
    const hybrid = await configure(0, { ...update, mode: 'hybrid' }).expect(200);
    expect(hybrid.body.data.mode).toBe('hybrid');
    expect((await db.select().from(meetingConferencing).where(eq(meetingConferencing.meeting_id, meetingId)))[0])
      .toMatchObject({ mode: 'hybrid', google_meet_url: url });
    expect((await configure(0, { mode: 'in_person' }).expect(200)).body.data.mode).toBe('in_person');
    expect(await db.select().from(meetingConferencing).where(eq(meetingConferencing.meeting_id, meetingId))).toEqual([]);
    clock = startsAt;
    expect((await join().expect(409)).body.error.code).toBe('CONFERENCING_NOT_CONFIGURED');
  });

  it('protege a rota, revalida consentimento e papéis, e só devolve o link no horário', async () => {
    await api.get(route()).expect(401).expect('Cache-Control', 'no-store');
    await get(3).expect(403);
    expect((await configure(2).expect(403)).body.error.code).toBe('MEETING_ORGANIZER_REQUIRED');
    await configure().expect(200).expect('Cache-Control', 'no-store');
    await configure(0, { mode: 'virtual', google_meet_url: 'https://external.example' }).expect(400);
    await join(0, { accepted_audio_video: false }).expect(400);
    expect((await join().expect(409)).body.error.code).toBe('MEETING_NOT_STARTED');

    clock = startsAt;
    for (const actor of [1, 2]) {
      const denied = await join(actor).expect(403).expect('Cache-Control', 'no-store');
      expect(denied.body.error.code).toBe('PARTICIPATION_FORBIDDEN');
      expect(denied.text).not.toContain(url);
    }
    const reader = await get(2).expect(200);
    expect(reader.body.data).toEqual({ mode: 'virtual', actions: { can_configure: false, can_join: false } });
    expect(reader.text).not.toContain(url);
    await acceptInvitation();
    expect((await get(1).expect(200)).body.data.actions.can_join).toBe(true);
    expect((await join(1).expect(200).expect('Cache-Control', 'no-store')).body).toEqual({ data: { join_url: url } });
  });

  it('mantém escopo de leitura da HU03 em reunião privada e grupo excluído', async () => {
    groupId = randomUUID();
    await db.insert(groups).values({ id: groupId, name: 'Grupo', created_by_user_id: people[0].id });
    await db.update(meetings).set({ group_id: groupId, access_mode: 'selected' }).where(eq(meetings.id, meetingId));
    await configure().expect(200);
    await get(2).expect(404);
    await join(2).expect(404);
    await db.update(groups).set({ deleted_at: createdAt, deletion_reason: 'ADMIN_DELETION' }).where(eq(groups.id, groupId));
    await get().expect(404);
    await configure().expect(404);
    await join().expect(404);
  });

  it.each(['bloqueio', 'encerramento'])('revalida %s depois de aguardar o lock da reunião', async action => {
    clock = startsAt;
    await configure().expect(200);
    await acceptInvitation();
    const release = Promise.withResolvers<void>();
    const acquired = Promise.withResolvers<void>();
    const mutation = db.transaction(async tx => {
      await tx.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, meetingId)).for('update');
      if (action === 'bloqueio') {
        await tx.insert(meetingParticipationBlocks).values({
          meeting_id: meetingId, user_id: people[1].id, blocked_by_user_id: people[0].id, blocked_at: clock,
        });
      } else {
        await tx.update(meetings).set({ ended_at: clock, ended_by_user_id: people[0].id }).where(eq(meetings.id, meetingId));
      }
      acquired.resolve();
      await release.promise;
    });
    await Promise.race([mutation, acquired.promise]);
    const result = join(1).then(response => response);
    try {
      await vi.waitFor(async () => {
        const waiting = await pool.query(
          "SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'", [applicationName],
        );
        expect(waiting.rowCount).toBe(1);
      });
    } finally {
      release.resolve();
      await mutation;
    }
    const response = await result;
    expect(response.status).toBe(action === 'bloqueio' ? 403 : 409);
    expect(response.body.error.code).toBe(action === 'bloqueio' ? 'PARTICIPATION_FORBIDDEN' : 'MEETING_ENDED');
    expect(response.text).not.toContain(url);
    expect((await get(1).expect(200)).body.data.actions.can_join).toBe(false);
    if (action === 'encerramento') expect((await configure().expect(409)).body.error.code).toBe('MEETING_ENDED');
  });
});
