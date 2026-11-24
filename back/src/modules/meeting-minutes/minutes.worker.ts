import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { meetingAgendaItems, meetingMinuteRevisions, meetingMinutes, meetings } from '../../db/schema';
import { findConferencing } from '../meeting-conferencing/meeting-conferencing.repository';
import { PostgresMeetingsRepository, type MeetingDatabaseTransaction } from '../meetings/meetings.repository';
import { TranscriptError } from './meet-transcript.client';
import type { Minutes } from './minutes.types';

export const transcriptDeadlineMs = 24 * 60 * 60 * 1000;
const leaseMs = 10 * 60 * 1000;

type Source = { conference: string; transcripts: string[]; excerpt: string };
export type ImportTranscript = (job: Minutes, meeting: typeof meetings.$inferSelect) => Promise<Source>;

export async function enqueueMinutes(db: MeetingDatabaseTransaction, meetingId: string, endedAt: Date) {
  const config = await findConferencing(db, meetingId);
  const space = config?.transcription_space_name;
  if (!space) return; // Sem captura, a revisão projeta indisponível até receber notas.
  await db.insert(meetingMinutes).values({
    meeting_id: meetingId, source_kind: 'meet_transcript',
    source_space_name: space, generation_status: 'queued',
    next_attempt_at: endedAt,
    deadline_at: new Date(endedAt.getTime() + transcriptDeadlineMs),
  }).onConflictDoNothing({ target: meetingMinutes.meeting_id });
}

export class MinutesWorker {
  private readonly repository: PostgresMeetingsRepository;
  constructor(private readonly db: NodePgDatabase, private readonly importTranscript: ImportTranscript,
    private readonly clock = () => new Date()) {
    this.repository = new PostgresMeetingsRepository(db);
  }

  private async claim() {
    const now = this.clock();
    return this.db.transaction(async tx => {
      const [candidate] = await tx.select().from(meetingMinutes).where(and(
        ne(meetingMinutes.visibility, 'deleted'),
        or(and(eq(meetingMinutes.generation_status, 'queued'), lte(meetingMinutes.next_attempt_at, now)),
          and(eq(meetingMinutes.generation_status, 'running'), lte(meetingMinutes.lease_until, now))),
      )).orderBy(asc(meetingMinutes.next_attempt_at), asc(meetingMinutes.meeting_id)).limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;
      const [job] = await tx.update(meetingMinutes).set({
        generation_status: 'running', attempt_count: candidate.attempt_count + 1,
        lease_token: randomUUID(), lease_until: new Date(now.getTime() + leaseMs),
      }).where(eq(meetingMinutes.meeting_id, candidate.meeting_id)).returning();
      return job;
    });
  }

  async runOnce(): Promise<boolean> {
    const now = this.clock();
    await this.db.update(meetingMinutes).set({ sla_missed_at: now }).where(and(
      ne(meetingMinutes.visibility, 'deleted'), isNull(meetingMinutes.sla_missed_at),
      isNull(meetingMinutes.transcript_ready_at), isNotNull(meetingMinutes.deadline_at),
      lte(meetingMinutes.deadline_at, now),
    ));
    const job = await this.claim();
    if (!job) return false;

    const [meeting] = await this.db.select().from(meetings).where(eq(meetings.id, job.meeting_id));
    if (!meeting.ended_at) throw new Error('Job de ata sem encerramento.');
    let source: Source | undefined;
    let failure: TranscriptError | undefined;
    try {
      const available = await this.repository.transaction(async tx =>
        tx.lockActiveMeeting(meeting.id, meeting.group_id));
      if (!available) throw new TranscriptError('GROUP_UNAVAILABLE', true);
      if (job.source_kind === 'meet_transcript') {
        if (job.deadline_at && now >= job.deadline_at && job.failure_code !== 'MANUAL_RETRY') {
          throw new TranscriptError('SLA_EXCEEDED');
        }
        source = await this.importTranscript(job, meeting);
      }
    } catch (error) {
      failure = error instanceof TranscriptError ? error : new TranscriptError('GENERATION_FAILED');
    }

    await this.repository.transaction(async (tx, db) => {
      const active = await tx.lockActiveMeeting(meeting.id, meeting.group_id);
      const [current] = await db.select().from(meetingMinutes)
        .where(eq(meetingMinutes.meeting_id, meeting.id)).for('update');
      const finished = this.clock();
      if (current.visibility === 'deleted' || current.draft_revision_id || current.published_revision_id ||
          current.lease_token !== job.lease_token || !current.lease_until || current.lease_until <= finished) return;

      const deadline = job.deadline_at;
      const missed = deadline && finished >= deadline ? current.sla_missed_at ?? finished : current.sla_missed_at;
      const clear = { lease_until: null, lease_token: null, sla_missed_at: missed };
      if (!active) failure = new TranscriptError('GROUP_UNAVAILABLE', true);
      if (failure) {
        const delay = Math.max(failure.retryAfterMs, Math.min(15 * 60_000, 30_000 * 2 ** Math.min(job.attempt_count, 10)));
        const retryAt = new Date(finished.getTime() + delay);
        const retry = failure.retryable && (deadline ? retryAt < deadline : job.attempt_count < 8);
        await db.update(meetingMinutes).set({
          ...clear, next_attempt_at: retry ? retryAt : null,
          generation_status: retry ? 'queued' : 'failed',
          failure_code: !retry && failure.retryable && deadline && missed ? 'SLA_EXCEEDED' : failure.code,
        }).where(eq(meetingMinutes.meeting_id, meeting.id));
        return;
      }
      const agenda = await db.select({ id: meetingAgendaItems.id, subject: meetingAgendaItems.subject,
        status: meetingAgendaItems.review_status }).from(meetingAgendaItems)
        .where(eq(meetingAgendaItems.meeting_id, meeting.id)).orderBy(meetingAgendaItems.id).limit(50);
      const id = randomUUID();
      const body = [
        'Início previsto: ' + meeting.starts_at.toISOString(), 'Encerramento: ' + meeting.ended_at?.toISOString(),
        'Pautas registradas (até 50)', ...agenda.map(item => '- ' + item.subject + ' (' + item.status + ', ' + item.id + ')'),
        source ? 'Transcrição do Meet para revisão\n' + source.excerpt : 'Notas fornecidas pelo gestor\n' + (job.source_notes ?? ''),
        'Decisões e encaminhamentos: preencher após revisão.',
      ].join('\n');
      await db.insert(meetingMinuteRevisions).values({
        id, meeting_id: meeting.id, title: meeting.subject, body,
        source_kind: job.source_kind, created_at: finished,
      });
      await db.update(meetingMinutes).set({
        ...clear, generation_status: 'ready', failure_code: null, next_attempt_at: null,
        draft_revision_id: id, draft_status: 'pending', version: sql`${meetingMinutes.version} + 1`,
        transcript_ready_at: source ? finished : null,
        conference_name: source?.conference, source_transcripts: source?.transcripts,
      }).where(eq(meetingMinutes.meeting_id, meeting.id));
    });
    return true;
  }
}
