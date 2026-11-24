import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { meetingConferencing, meetingGoogleIntegrations, meetingParticipants, meetings, meetingTranscriptImports, meetingTranscriptSnapshots, users } from '../../../db/schema';
import { migrateIdentityTestDatabase } from '../../identity/tests/postgres-test-utils';
import { PostgresMeetingsRepository } from '../../meetings/meetings.repository';
import { MeetingsService } from '../../meetings/meetings.service';
import { MeetingConferencingService } from '../../meeting-conferencing/meeting-conferencing.service';
import { MeetTranscriptClient } from '../../meeting-minutes/meet-transcript.client';
import { PostgresTranscriptSourceReader } from '../../meeting-transcripts/transcript.reader';
import { TranscriptStorage } from '../../meeting-transcripts/transcript.storage';
import { MeetingTranscriptWorker } from '../../meeting-transcripts/transcript.worker';
import { createMeetingTranscriptRouter } from '../../meeting-transcripts/transcript.routes';
import { GoogleIntegrationWorker } from '../google.worker';
import { GoogleCalendarClient, type CalendarEvent } from '../google-calendar.client';
import type { GoogleConfig } from '../google.config';
const connectionString = process.env.MEET_TEST_DATABASE_URL;
describe.skipIf(!connectionString)('pipeline Google/agenda/transcrição com PostgreSQL e provedores simulados', () => {
  const pool = new Pool({ connectionString }); const db = drizzle({ client: pool }); const repository = new PostgresMeetingsRepository(db);
  const start = new Date('2028-04-12T10:00:00Z'); const end = new Date('2028-04-12T11:00:00Z');
  let now = new Date('2028-04-12T09:30:00Z'); let id = ''; let accounts: bigint[] = []; let directory = '';
  const service = new MeetingsService(repository, () => now); const conference = new MeetingConferencingService(repository, () => now);
  const config = { calendarId: 'primary', domains: new Set(['example.edu']) } as GoogleConfig;
  let event: CalendarEvent | null; let inserts: number; let patches: number; let removes: number; let ready: boolean;
  let calendar: GoogleCalendarClient; let meet: MeetTranscriptClient;
  beforeAll(async () => { await migrateIdentityTestDatabase(pool); });
  beforeEach(async () => {
    now = new Date('2028-04-12T09:30:00Z'); id = randomUUID(); directory = await mkdtemp('/tmp/unidebates-meet-pipeline-');
    accounts = (await db.insert(users).values(['Organização', 'Público'].map(name => ({ name, email: randomUUID() + '@example.edu', password_hash: 'fake', status: 'verified' as const, email_verified_at: now }))).returning({ id: users.id })).map(row => row.id);
    await db.insert(meetings).values({ id, subject: 'Deliberação sintética', starts_at: start, scheduled_ends_at: end, created_at: now,
      created_by_user_id: accounts[0], organizer_user_id: accounts[0], access_mode: 'public' });
    await db.insert(meetingParticipants).values({ meeting_id: id, user_id: accounts[0], origin: 'creator', status: 'confirmed', created_at: now });
    event = null; inserts = 0; patches = 0; removes = 0; ready = false;
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === 'GET') {
        if (!event) return new Response('', { status: 404 });
        if (ready && event.conferenceData) event = { ...event, etag: 'provider-ready', conferenceData: { createRequest: { status: { statusCode: 'success' } }, entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } };
        return Response.json(event);
      }
      if (init?.method === 'DELETE') { removes++; event = { ...event!, status: 'cancelled' }; return new Response(null, { status: 204 }); }
      const body = JSON.parse(String(init?.body));
      if (init?.method === 'POST') { inserts++; event = { ...body, etag: 'inserted' }; }
      else { patches++; event = { ...event!, ...body, etag: 'patch-' + patches }; if (body.conferenceData) event!.conferenceData!.createRequest!.status = { statusCode: 'pending' }; }
      return Response.json(event);
    });
    calendar = new GoogleCalendarClient({ accessToken: async () => 'mock-access' }, 'primary', transport);
    meet = new MeetTranscriptClient({ clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh', policyVersion: 'policy-1', notice: 'Aviso', operators: new Set([accounts[0].toString()]) });
    vi.spyOn(meet, 'resolveSpace').mockResolvedValue('spaces/room'); vi.spyOn(meet, 'enableAutoTranscription').mockResolvedValue();
  });
  afterEach(async () => {
    await db.delete(meetingTranscriptSnapshots).where(eq(meetingTranscriptSnapshots.meeting_id, id));
    await db.delete(meetingTranscriptImports).where(eq(meetingTranscriptImports.meeting_id, id));
    await db.delete(meetingGoogleIntegrations).where(eq(meetingGoogleIntegrations.meeting_id, id));
    await db.delete(meetingConferencing).where(eq(meetingConferencing.meeting_id, id));
    await db.delete(meetingParticipants).where(eq(meetingParticipants.meeting_id, id)); await db.delete(meetings).where(eq(meetings.id, id));
    await db.delete(users).where(inArray(users.id, accounts)); await rm(directory, { recursive: true, force: true }); vi.restoreAllMocks();
  });
  afterAll(async () => { await pool.end(); }); const worker = () => new GoogleIntegrationWorker(db, config, calendar, meet, () => now);
  it('cria agenda cedo, respeita T−15min, recupera pending/ETag e dois workers sem duplicar evento', async () => {
    await conference.configure(id, accounts[0], { mode: 'virtual', provisioning: 'automatic', google_meet_url: null });
    await Promise.all([worker().runOnce(), worker().runOnce()]); expect(inserts).toBe(1); expect(patches).toBe(0);
    now = new Date(+start - 900001); expect(await worker().runOnce()).toBe(false);
    now = new Date(+start - 900000); await worker().runOnce(); expect(patches).toBe(1);
    expect((await conference.get(id, accounts[0])).integration?.state).toBe('provisioning');
    ready = true; now = new Date(+now + 30000); await worker().runOnce();
    const [row] = await db.select().from(meetingConferencing).where(eq(meetingConferencing.meeting_id, id)); expect(row.google_meet_url).toBe('https://meet.google.com/abc-defg-hij');
    expect((await conference.get(id, accounts[0])).actions.can_join).toBe(false);
    expect((await conference.get(id, accounts[0])).integration?.state).toBe('ready'); expect(inserts).toBe(1);
  });
  it('reagenda o mesmo evento por versão, recusa conflito e cancela idempotente bloqueando ingresso', async () => {
    await conference.configure(id, accounts[0], { mode: 'hybrid', provisioning: 'automatic', google_meet_url: null }); await worker().runOnce(); const externalId = event!.id;
    const version = (await service.getSchedule(id, accounts[0])).version;
    await expect(service.updateSchedule(id, accounts[1], { startsAt: new Date(+start + 3600000), endsAt: new Date(+end + 3600000), version })).rejects.toMatchObject({ code: 'MEETING_ORGANIZER_REQUIRED' });
    await service.updateSchedule(id, accounts[0], { startsAt: new Date(+start + 3600000), endsAt: new Date(+end + 3600000), version });
    await expect(service.cancel(id, accounts[0], version)).rejects.toMatchObject({ code: 'MEETING_VERSION_CONFLICT' });
    await worker().runOnce(); expect(inserts).toBe(1); expect(event!.id).toBe(externalId);
    const cancelled = await service.cancel(id, accounts[0], version + 1); expect(await service.cancel(id, accounts[0], version + 1)).toEqual(cancelled);
    await worker().runOnce(); expect(removes).toBe(1); await expect(conference.join(id, accounts[0])).rejects.toThrow();
  });
  it('não publica resposta em voo de versão cancelada e compensa o evento externo', async () => {
    await conference.configure(id, accounts[0], { mode: 'virtual', provisioning: 'automatic', google_meet_url: null }); const original = calendar.insert.bind(calendar);
    vi.spyOn(calendar, 'insert').mockImplementationOnce(async input => { const result = await original(input); await service.cancel(id, accounts[0], 2); return result; });
    await worker().runOnce(); await worker().runOnce(); expect(removes).toBe(1);
    const [row] = await db.select().from(meetingConferencing).where(eq(meetingConferencing.meeting_id, id)); expect(row.google_meet_url).toBeNull();
  });
  it('importa independente de IA e de fim local, reader verifica arquivo e rotas revalidam acesso', async () => {
    await db.insert(meetingConferencing).values({ meeting_id: id, mode: 'virtual', google_meet_url: 'https://meet.google.com/abc-defg-hij', transcription_space_name: 'spaces/room', transcription_policy_version: 'policy-1' }); now = new Date(+end + 60000);
    vi.spyOn(meet, 'conferenceSource').mockResolvedValue({ conference: 'conferenceRecords/session', conferenceEndedAt: end.toISOString(), transcripts: ['conferenceRecords/session/transcripts/one'], entries: [{ text: 'Proposta aprovada.', start_at: start.toISOString(), end_at: new Date(+start + 4000).toISOString() }] });
    const storage = new TranscriptStorage(directory); await new MeetingTranscriptWorker(db, meet, storage, () => now).runOnce();
    const reader = new PostgresTranscriptSourceReader(db, storage, 'policy-1'); const status = await reader.describe(id); expect(status.state).toBe('available');
    expect((await reader.loadForGeneration(id, status.ref!, AbortSignal.timeout(1000))).entries[0].id).toBe('segment-1');
    await expect(reader.loadForGeneration(randomUUID(), status.ref!, AbortSignal.timeout(1000))).rejects.toThrow();
    let actor = accounts[0]; const app = express(); app.use((req, _res, next) => { req.auth = { user_id: actor.toString(), session_id: 'mock' }; next(); }); app.use(createMeetingTranscriptRouter(repository, reader, storage));
    await request(app).get('/meetings/' + id + '/transcript').expect(409); await db.update(meetings).set({ ended_at: now, ended_by_user_id: accounts[0] }).where(eq(meetings.id, id));
    const download = await request(app).get('/meetings/' + id + '/transcript/download?version=1').expect(200); expect(download.headers['cache-control']).toBe('no-store'); expect(download.headers['content-type']).toContain('application/vnd.openxmlformats');
    actor = accounts[1]; await request(app).get('/meetings/' + id + '/transcript').expect(403);
    await db.update(meetingConferencing).set({ transcription_policy_version: null, transcription_space_name: null }).where(eq(meetingConferencing.meeting_id, id)); expect(await reader.isCurrent(status.ref!)).toBe(false);
  });
  it('não torna disponível artefato com erro em disco e recupera lease vencido', async () => {
    await db.insert(meetingConferencing).values({ meeting_id: id, mode: 'virtual', google_meet_url: 'https://meet.google.com/abc-defg-hij', transcription_space_name: 'spaces/room', transcription_policy_version: 'policy-1' }); now = new Date(+end + 60000); const storage = new TranscriptStorage(directory);
    vi.spyOn(meet, 'conferenceSource').mockResolvedValue({ conference: 'conferenceRecords/session', conferenceEndedAt: end.toISOString(), transcripts: ['conferenceRecords/session/transcripts/one'], entries: [{ text: 'Texto', start_at: start.toISOString(), end_at: end.toISOString() }] });
    const importer = new MeetingTranscriptWorker(db, meet, storage, () => now); await importer.discover();
    await db.update(meetingTranscriptImports).set({ lease_token: randomUUID(), lease_until: new Date(+now - 1) }).where(eq(meetingTranscriptImports.meeting_id, id));
    vi.spyOn(storage, 'write').mockRejectedValueOnce(new Error('disk full')); await importer.runOnce(); expect((await new PostgresTranscriptSourceReader(db, storage, 'policy-1').describe(id)).state).toBe('failed');
    expect(await db.select().from(meetingTranscriptSnapshots).where(eq(meetingTranscriptSnapshots.meeting_id, id))).toHaveLength(0);
  });
});
