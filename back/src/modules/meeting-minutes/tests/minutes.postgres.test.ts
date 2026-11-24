import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, meetingConferencing, meetingMinuteRevisions, meetingMinutes,
  meetingParticipants, meetings, meetingTranscriptionConsents, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { composeMeetingServices } from '../../meetings/meetings.composition';
import { TranscriptError } from '../meet-transcript.client';
import { MinutesWorker, transcriptDeadlineMs } from '../minutes.worker';

const connectionString = process.env.HU07_TEST_DATABASE_URL;

describe.skipIf(!connectionString)('atas persistidas e HTTP com PostgreSQL', () => {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });
  const ids: string[] = [];
  let userIds: bigint[] = [];
  let now = new Date('2032-02-03T11:00:00Z');
  const clock = () => now;
  const passwords = new PasswordService({ cost: 4, min_length: 8 });
  const sessions = new SessionService(new PostgresUserRepository(db), new PostgresSessionRepository(db), passwords, clock);
  const config = { clientId: 'fixture-id', clientSecret: 'fixture-secret', refreshToken: 'fixture-token',
    policyVersion: 'v1', notice: 'Aviso de teste', operators: new Set<string>() };
  const http = request(createApp(undefined, sessions, undefined, composeMeetingServices(db, clock, config)));
  let headers: string[];

  beforeAll(async () => {
    await migrateIdentityTestDatabase(pool);
    const password = 'senha para teste';
    const password_hash = await passwords.hash(password);
    const accounts = await db.insert(users).values(['Organizador', 'Visitante'].map(name => ({
      name, email: randomUUID() + '@example.com', password_hash, status: 'verified' as const, email_verified_at: now,
    }))).returning();
    userIds = accounts.map(user => user.id);
    headers = await Promise.all(accounts.map(async user => 'Bearer ' + (await sessions.login({ email: user.email, password })).token));
  });
  afterAll(async () => {
    try {
      if (ids.length) {
        await db.update(meetingMinutes).set({
          draft_revision_id: null, draft_status: null, published_revision_id: null, published_at: null, visibility: 'unpublished',
        }).where(inArray(meetingMinutes.meeting_id, ids));
        await db.delete(meetingMinuteRevisions).where(inArray(meetingMinuteRevisions.meeting_id, ids));
        await db.delete(meetingMinutes).where(inArray(meetingMinutes.meeting_id, ids));
        await db.delete(meetingTranscriptionConsents).where(inArray(meetingTranscriptionConsents.meeting_id, ids));
        await db.delete(meetingConferencing).where(inArray(meetingConferencing.meeting_id, ids));
        await db.delete(meetingParticipants).where(inArray(meetingParticipants.meeting_id, ids));
        await db.delete(meetings).where(inArray(meetings.id, ids));
      }
      if (userIds.length) {
        await db.delete(authenticationSessions).where(inArray(authenticationSessions.user_id, userIds));
        await db.delete(users).where(inArray(users.id, userIds));
      }
    } finally { await pool.end(); }
  });

  function call(method: 'get' | 'post', path: string, index = 0) {
    return http[method](path).set('Authorization', headers[index]);
  }

  async function create() {
    const starts = new Date(now.getTime() + 60_000);
    const result = await call('post', '/meetings').send({ subject: 'Assembleia',
      starts_at: starts.toISOString(), access: { visibility: 'private' } }).expect(201);
    const id = result.body.data.id as string;
    ids.push(id);
    return { id, starts, url: '/meetings/' + id };
  }

  it('gera um único rascunho por notas, restringe revisão e lista apenas atas publicadas', async () => {
    const { id, starts, url } = await create();
    await call('get', url + '/minutes/review').expect(409);
    now = starts;
    await call('post', url + '/end').expect(204);
    await call('get', url + '/minutes/review', 1).expect(404);
    await call('post', url + '/minutes/notes').send({ notes: '  ' }).expect(400);
    await call('post', url + '/minutes/notes').send({ notes: 'Notas de teste' }).expect(202);
    await call('post', url + '/minutes/notes').send({ notes: 'Outra nota' }).expect(409);
    const worker = new MinutesWorker(db, async () => { throw new Error('Presencial não importa transcrição.'); }, clock);
    const attempts = await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const review = await call('get', url + '/minutes/review').expect(200);
    expect(review.body.data).toMatchObject({ version: 2, generation_status: 'ready', draft_status: 'pending',
      draft: { source_kind: 'notes', body: expect.stringContaining('Notas de teste') } });
    await call('get', url + '/minutes').expect(404);
    // Fixture de publicação para exercitar a consulta. Publicação pertence à HU08.
    await db.update(meetingMinutes).set({ visibility: 'published', published_revision_id: review.body.data.draft.id,
      published_at: now }).where(eq(meetingMinutes.meeting_id, id));
    await call('get', url + '/minutes').expect(200);
    await call('get', url + '/minutes', 1).expect(404);
    const history = await call('get', '/meeting-minutes').expect(200);
    expect(history.body.data.items).toContainEqual(expect.objectContaining({ meeting_id: id }));
    expect((await call('get', '/meeting-minutes', 1).expect(200)).body.data.items)
      .not.toContainEqual(expect.objectContaining({ meeting_id: id }));
    await db.update(meetingMinutes).set({ visibility: 'hidden' }).where(eq(meetingMinutes.meeting_id, id));
    await call('get', url + '/minutes').expect(404);
  });

  it('registra consentimento uma vez e grava atraso no limite de 24 horas sem reiniciar o prazo', async () => {
    const { id, starts, url } = await create();
    await db.insert(meetingConferencing).values({
      meeting_id: id, mode: 'virtual', google_meet_url: 'https://meet.google.com/abc-defg-hij',
      transcription_space_name: 'spaces/' + randomUUID(), transcription_policy_version: 'v1',
    });
    now = starts;
    await call('post', url + '/conferencing/join').send({ accepted_audio_video: true }).expect(403);
    for (const version of ['v0', 'v1', 'v1']) {
      await call('post', url + '/conferencing/join').send({
        accepted_audio_video: true, accepted_transcription: true, transcription_policy_version: version,
      }).expect(version === 'v0' ? 409 : 200);
    }
    expect(await db.select().from(meetingTranscriptionConsents).where(eq(meetingTranscriptionConsents.meeting_id, id))).toHaveLength(1);
    await call('post', url + '/end').expect(204);
    await call('post', url + '/end').expect(204);
    const deadline = new Date(starts.getTime() + transcriptDeadlineMs);
    now = new Date(deadline.getTime() - 1);
    const worker = new MinutesWorker(db, async () => {
      now = deadline;
      return { conference: 'conferenceRecords/' + id, transcripts: ['fixture'], excerpt: 'Trechos' };
    }, clock);
    await worker.runOnce();
    expect((await call('get', url + '/minutes/review').expect(200)).body.data)
      .toMatchObject({ failure_code: 'SLA_EXCEEDED', draft: null, sla_missed_at: deadline.toISOString() });
    await call('post', url + '/minutes/retry').expect(202);
    await worker.runOnce();
    expect((await call('get', url + '/minutes/review').expect(200)).body.data).toMatchObject({
      generation_status: 'ready', deadline_at: deadline.toISOString(), sla_missed_at: deadline.toISOString(),
    });
  });

  it('recupera lease expirado e reage a artefato temporariamente indisponível', async () => {
    const { id, starts, url } = await create();
    await db.insert(meetingConferencing).values({
      meeting_id: id, mode: 'virtual', google_meet_url: 'https://meet.google.com/abc-defg-hij',
      transcription_space_name: 'spaces/' + randomUUID(), transcription_policy_version: 'v1',
    });
    now = starts;
    await call('post', url + '/end').expect(204);
    await db.update(meetingMinutes).set({
      generation_status: 'running', lease_token: randomUUID(), lease_until: new Date(now.getTime() - 1),
    }).where(eq(meetingMinutes.meeting_id, id));
    const first = new MinutesWorker(db, async () => { throw new TranscriptError('MEET_WAITING_ARTIFACT', true); }, clock);
    expect(await first.runOnce()).toBe(true);
    expect(await first.runOnce()).toBe(false);
    const [pending] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
    expect(pending).toMatchObject({ generation_status: 'queued', failure_code: 'MEET_WAITING_ARTIFACT', attempt_count: 1 });
    expect(pending.next_attempt_at!.getTime()).toBeGreaterThan(now.getTime());
    now = pending.next_attempt_at!;
    const restarted = new MinutesWorker(db, async () => ({
      conference: 'conferenceRecords/' + id, transcripts: ['fixture'], excerpt: 'Transcrição completa para revisão',
    }), clock);
    expect(await restarted.runOnce()).toBe(true);
    expect(await restarted.runOnce()).toBe(false);
    expect((await call('get', url + '/minutes/review').expect(200)).body.data).toMatchObject({
      generation_status: 'ready', transcript_ready_at: now.toISOString(), sla_missed_at: null,
    });
    expect(await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id))).toHaveLength(1);
  });
});
