import { fixtureAi } from '../../ai/tests/ai.fixture';
import type { TranscriptSourceReader, TranscriptRef } from '../../meeting-transcripts/transcript.contract';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app';
import { authenticationSessions, meetingConferencing, meetingMinuteRevisions, meetingMinutes,
  meetingParticipants, meetings, meetingTranscriptionConsents, meetingTranscriptSnapshots, users } from '../../../db/schema';
import { PasswordService } from '../../identity/password.service';
import { PostgresSessionRepository } from '../../identity/session.repository';
import { SessionService } from '../../identity/session.service';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresUserRepository } from '../../identity/user.repository';
import { composeMeetingServices } from '../../meetings/meetings.composition';
import { MinutesService } from '../minutes.service';
import { PostgresMeetingsRepository } from '../../meetings/meetings.repository';
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
        await db.delete(meetingTranscriptSnapshots).where(inArray(meetingTranscriptSnapshots.meeting_id, ids));
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
    const worker = new MinutesWorker(db, { ai: fixtureAi }, clock);
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

  async function sourceReader(id: string, hook: () => Promise<void> = async () => {}) {
    const entry = { id: 'segment-1', text: 'Houve discordância sobre o prazo. Não houve decisão.',
      start_at: now.toISOString(), end_at: now.toISOString() };
    const snapshotId = randomUUID();
    const ref: TranscriptRef = { meetingId: id, transcriptId: snapshotId, version: 1, contentHash: 'fixture-hash',
      conferenceName: 'conferenceRecords/' + id, providerTranscriptNames: ['fixture'],
      conferenceEndedAt: now.toISOString(), policyVersion: 'v1' };
    await db.insert(meetingTranscriptSnapshots).values({ id: snapshotId, meeting_id: id, version: 1,
      content_hash: ref.contentHash, normalization_version: 'fixture-v1', conference_name: ref.conferenceName,
      provider_transcript_names: ['fixture'], conference_ended_at: now, policy_version: 'v1', entries: [entry],
      docx_storage_key: snapshotId, docx_hash: 'fixture-hash', docx_bytes: 1 });
    const reader: TranscriptSourceReader = { async describe() { return { state: 'available', ref, failureCode: null }; },
      async loadForGeneration() { await hook(); return { ref, entries: [entry] }; }, async isCurrent() { return true; } };
    return reader;
  }
  async function captured() {
    const fixture = await create();
    await db.insert(meetingConferencing).values({ meeting_id: fixture.id, mode: 'virtual',
      google_meet_url: 'https://meet.google.com/abc-defg-hij', transcription_space_name: 'spaces/' + randomUUID(), transcription_policy_version: 'v1' });
    now = fixture.starts;
    await call('post', fixture.url + '/conferencing/join').send({ accepted_audio_video: true,
      accepted_transcription: true, transcription_policy_version: 'v1' }).expect(200);
    await call('post', fixture.url + '/end').expect(204);
    return fixture;
  }
  it('registra consentimento e mantém prazo durante retry de transcrição versionada', async () => {
    const { id, starts, url } = await captured();
    expect(await db.select().from(meetingTranscriptionConsents).where(eq(meetingTranscriptionConsents.meeting_id, id))).toHaveLength(1);
    const deadline = new Date(starts.getTime() + transcriptDeadlineMs);
    now = new Date(deadline.getTime() - 1);
    const reader = await sourceReader(id, async () => { now = deadline; });
    const worker = new MinutesWorker(db, { ai: fixtureAi, transcripts: reader }, clock);
    await worker.runOnce();
    expect((await call('get', url + '/minutes/review').expect(200)).body.data)
      .toMatchObject({ failure_code: 'SLA_EXCEEDED', draft: null, sla_missed_at: deadline.toISOString() });
    await call('post', url + '/minutes/retry').expect(202);
    await worker.runOnce();
    expect((await call('get', url + '/minutes/review').expect(200)).body.data).toMatchObject({
      generation_status: 'ready', deadline_at: deadline.toISOString(), sla_missed_at: deadline.toISOString(),
      draft: { body: expect.stringContaining('Resumo') },
    });
    const [revision] = await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id));
    expect(revision.generation_provenance).toMatchObject({ sourceKind: 'meet_transcript', sourceHash: 'fixture-hash', transcriptVersion: 1 });
  });
  it('recupera lease expirado e espera fonte disponível sem produzir sucesso vazio', async () => {
    const { id, url } = await captured();
    await db.update(meetingMinutes).set({ generation_status: 'running', lease_token: randomUUID(), lease_until: new Date(now.getTime() - 1) })
      .where(eq(meetingMinutes.meeting_id, id));
    const reader = await sourceReader(id);
    const waiting: TranscriptSourceReader = { ...reader, async describe() { return { state: 'processing', ref: null, failureCode: null }; } };
    const first = new MinutesWorker(db, { ai: fixtureAi, transcripts: waiting }, clock);
    expect(await first.runOnce()).toBe(true);
    expect(await first.runOnce()).toBe(false);
    const [pending] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
    expect(pending).toMatchObject({ generation_status: 'queued', failure_code: 'TRANSCRIPT_PENDING', attempt_count: 0 });
    now = pending.next_attempt_at!;
    const restarted = new MinutesWorker(db, { ai: fixtureAi, transcripts: reader }, clock);
    expect(await restarted.runOnce()).toBe(true);
    expect((await call('get', url + '/minutes/review').expect(200)).body.data).toMatchObject({ generation_status: 'ready' });
    expect(await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id))).toHaveLength(1);
  });
  it('descarta fonte alterada durante IA e limita retry a quatro tentativas', async () => {
    const { id } = await captured();
    const reader = await sourceReader(id);
    let current = true;
    reader.isCurrent = async () => current;
    const ai = { ...fixtureAi, async generateMinutes(input: Parameters<typeof fixtureAi.generateMinutes>[0]) {
      current = false; return fixtureAi.generateMinutes(input, AbortSignal.timeout(1000));
    } };
    const worker = new MinutesWorker(db, { ai, transcripts: reader }, clock);
    await worker.runOnce();
    let [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
    expect(row).toMatchObject({ generation_status: 'queued', failure_code: 'SOURCE_CHANGED', draft_revision_id: null });
    for (let attempt = 1; attempt < 4; attempt++) {
      now = row.next_attempt_at!; await worker.runOnce();
      [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
    }
    expect(row).toMatchObject({ generation_status: 'failed', attempt_count: 4, draft_revision_id: null });
  });
  it('mantém notas em fila quando configuração está pendente', async () => {
    const { id, starts, url } = await create(); now = starts;
    await call('post', url + '/end').expect(204);
    await call('post', url + '/minutes/notes').send({ notes: 'Notas preservadas.' }).expect(202);
    expect(await new MinutesWorker(db, {}, clock).runOnce()).toBe(false);
    const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
    expect(row).toMatchObject({ source_notes: 'Notas preservadas.', generation_status: 'queued', attempt_count: 0 });
    // Retire this intentionally queued fixture before later queue consumers run.
    await db.update(meetingMinutes).set({ generation_status: 'failed', next_attempt_at: null })
      .where(eq(meetingMinutes.meeting_id, id));
  });
  it('descarta resposta após vencimento do lease e recupera sem duplicar revisão', async () => {
    const { id, starts, url } = await create(); now = starts;
    await call('post', url + '/end').expect(204);
    await call('post', url + '/minutes/notes').send({ notes: 'Discussão sem decisão explícita.' }).expect(202);
    let expire = true;
    const ai = { ...fixtureAi, async generateMinutes(input: Parameters<typeof fixtureAi.generateMinutes>[0]) {
      if (expire) { now = new Date(now.getTime() + 11 * 60_000); expire = false; }
      return fixtureAi.generateMinutes(input, AbortSignal.timeout(1000));
    } };
    const worker = new MinutesWorker(db, { ai }, clock);
    await worker.runOnce();
    expect(await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id))).toHaveLength(0);
    await worker.runOnce();
    expect(await db.select().from(meetingMinuteRevisions).where(eq(meetingMinuteRevisions.meeting_id, id))).toHaveLength(1);
    expect(await worker.runOnce()).toBe(false);
  });
  it('descarta resultado quando a política de transcrição é revogada durante geração', async () => {
    const { id } = await captured();
    const reader = await sourceReader(id);
    const ai = { ...fixtureAi, async generateMinutes(input: Parameters<typeof fixtureAi.generateMinutes>[0]) {
      await db.update(meetingConferencing).set({ transcription_space_name: null, transcription_policy_version: null })
        .where(eq(meetingConferencing.meeting_id, id));
      return fixtureAi.generateMinutes(input, AbortSignal.timeout(1000));
    } };
    await new MinutesWorker(db, { ai, transcripts: reader }, clock).runOnce();
    const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
    expect(row.draft_revision_id).toBeNull();
    expect(row.failure_code).toBe('SOURCE_CHANGED');
  });

  it('lê snapshot privado com IA desligada, sinaliza fonte desatualizada e revalida gestor após I/O', async () => {
    const { id } = await captured();
    const reader = await sourceReader(id);
    const service = new MinutesService(new PostgresMeetingsRepository(db), undefined, clock, reader);
    expect((await service.review(id, userIds[0])).actions.can_read_transcript).toBe(true);
    expect((await service.transcript(id, userIds[0], 1, 0)).items[0].text).toContain('discordância');
    await new MinutesWorker(db, { ai: fixtureAi, transcripts: reader }, clock).runOnce();
    const described = await reader.describe(id);
    reader.describe = async () => ({ ...described, ref: { ...described.ref!, version: 2, contentHash: 'newer-source' } });
    expect((await service.review(id, userIds[0])).ai).toMatchObject({ source_outdated: true });
    reader.describe = async () => described;
    const originalLoad = reader.loadForGeneration;
    reader.loadForGeneration = async (...args) => {
      await db.update(meetings).set({ organizer_user_id: userIds[1] }).where(eq(meetings.id, id));
      return originalLoad(...args);
    };
    await expect(service.transcript(id, userIds[0], 1, 0)).rejects.toMatchObject({ code: 'MINUTES_FORBIDDEN' });
  });

});
