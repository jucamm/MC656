import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { meetingAgendaItems, meetingMinuteRevisions, meetingMinutes, meetings } from '../../db/schema';
import { findConferencing } from '../meeting-conferencing/meeting-conferencing.repository';
import { PostgresMeetingsRepository, type MeetingDatabaseTransaction } from '../meetings/meetings.repository';
import { TranscriptError } from './meet-transcript.client';
import { sameTranscriptRef } from '../ai/source-reference';
import { meetingRedactor } from '../ai/source-minimization';
import type { AiClient } from '../ai/ai.contract';
import { minutesPipelineRevision } from '../ai/gemini';
import { generateProposal, proposalSegments } from '../ai/minutes-proposal';
import { SynthesisError } from '../legislative-compendia/compendium-synthesis';
import type { TranscriptRef, TranscriptSourceReader } from '../meeting-transcripts/transcript.contract';

export const transcriptDeadlineMs = 24 * 60 * 60 * 1000;
const leaseMs = 10 * 60 * 1000;
const maxAttempts = 4;

type Dependencies = { ai?: AiClient; transcripts?: TranscriptSourceReader; pipeline?: string };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

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
  constructor(private readonly db: NodePgDatabase, private readonly dependencies: Dependencies,
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
      if (candidate.attempt_count >= maxAttempts) {
        await tx.update(meetingMinutes).set({ generation_status: 'failed', failure_code: 'AI_ATTEMPT_LIMIT',
          lease_token: null, lease_until: null, next_attempt_at: null })
          .where(eq(meetingMinutes.meeting_id, candidate.meeting_id));
        return null;
      }
      const [job] = await tx.update(meetingMinutes).set({
        generation_status: 'running', attempt_count: candidate.attempt_count + 1,
        lease_token: randomUUID(), lease_until: new Date(now.getTime() + leaseMs),
      }).where(eq(meetingMinutes.meeting_id, candidate.meeting_id)).returning();
      return job;
    });
  }

  async runOnce(): Promise<boolean> {
    if (!this.dependencies.ai) return false; // Pending configuration must never fabricate a proposal.
    const now = this.clock();
    await this.db.update(meetingMinutes).set({ sla_missed_at: now }).where(and(
      ne(meetingMinutes.visibility, 'deleted'), isNull(meetingMinutes.sla_missed_at),
      isNull(meetingMinutes.transcript_ready_at), isNotNull(meetingMinutes.deadline_at),
      lte(meetingMinutes.deadline_at, now),
    ));
    const job = await this.claim();
    if (!job) return false;

    const [meeting] = await this.db.select().from(meetings).where(eq(meetings.id, job.meeting_id));
    let ref: TranscriptRef | undefined;
    let body = '';
    let sourceHash = '';
    const pipeline = this.dependencies.pipeline ?? minutesPipelineRevision;
    const signal = AbortSignal.timeout(8 * 60_000);
    let failure: TranscriptError | undefined;
    try {
      const available = await this.repository.transaction(async tx =>
        tx.lockActiveMeeting(meeting.id, meeting.group_id));
      if (!available || !meeting.ended_at || meeting.cancelled_at) throw new TranscriptError('GROUP_UNAVAILABLE', true);
      if (job.draft_revision_id || job.published_revision_id) throw new TranscriptError('EDITORIAL_CONFLICT');
      let entries: { id: string; text: string }[];
      if (job.source_kind === 'meet_transcript') {
        if (job.deadline_at && now >= job.deadline_at && job.failure_code !== 'MANUAL_RETRY') {
          throw new TranscriptError('SLA_EXCEEDED');
        }
        const reader = this.dependencies.transcripts;
        if (!reader) throw new TranscriptError('TRANSCRIPT_UNAVAILABLE');
        const description = await reader.describe(meeting.id);
        if (description.state !== 'available' || !description.ref) throw new TranscriptError(
          description.state === 'pending' || description.state === 'processing' ? 'TRANSCRIPT_PENDING' : 'TRANSCRIPT_UNAVAILABLE',
          description.state === 'pending' || description.state === 'processing');
        ref = description.ref;
        const config = await findConferencing(this.db, meeting.id);
        if (!config?.transcription_space_name || config.transcription_space_name !== job.source_space_name ||
            config.transcription_policy_version !== ref.policyVersion) throw new TranscriptError('SOURCE_CHANGED');
        const source = await reader.loadForGeneration(meeting.id, ref, signal);
        if (!sameTranscriptRef(source.ref, ref)) throw new TranscriptError('SOURCE_CHANGED', true);
        entries = source.entries;
        sourceHash = ref.contentHash;
      } else {
        if (job.source_kind !== 'notes' || !job.source_notes?.trim()) throw new TranscriptError('SOURCE_UNAVAILABLE');
        entries = [{ id: 'notes', text: job.source_notes }];
        sourceHash = hash(job.source_notes);
      }
      // Freeze provenance on the claimed job before external I/O. No transaction spans a provider call.
      const [frozen] = await this.db.update(meetingMinutes).set({ source_content_hash: sourceHash,
        pipeline_version: pipeline, source_transcript_id: ref?.transcriptId ?? null,
        source_transcript_version: ref?.version ?? null, source_policy_version: ref?.policyVersion ?? null,
        transcript_ready_at: ref ? job.transcript_ready_at ?? this.clock() : job.transcript_ready_at,
      }).where(and(eq(meetingMinutes.meeting_id, job.meeting_id), eq(meetingMinutes.lease_token, job.lease_token!)))
        .returning({ id: meetingMinutes.meeting_id });
      if (!frozen) return true;
      if (ref && !await this.dependencies.transcripts!.isCurrent(ref)) throw new TranscriptError('SOURCE_CHANGED', true);
      const redact = await meetingRedactor(this.db, meeting.id);
      entries = entries.map(entry => ({ ...entry, text: redact(entry.text) }));
      body = await generateProposal(this.dependencies.ai, { sourceKind: job.source_kind as 'notes' | 'meet_transcript',
        segments: proposalSegments(entries) }, signal, async () => {
          if (ref && !await this.dependencies.transcripts!.isCurrent(ref)) return false;
          return this.repository.transaction(async (tx, db) => {
            const active = await tx.lockActiveMeeting(meeting.id, meeting.group_id);
            const [latest] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, meeting.id));
            return !!(active?.ended_at && !active.cancelled_at && latest?.lease_token === job.lease_token &&
              latest.lease_until && latest.lease_until > this.clock() && latest.source_notes === job.source_notes &&
              latest.source_kind === job.source_kind && latest.visibility !== 'deleted' &&
              !latest.draft_revision_id && !latest.published_revision_id);
          });
        });
      if (redact(body) !== body) throw new TranscriptError('AI_UNSUPPORTED_EVIDENCE');
      if (ref && !await this.dependencies.transcripts!.isCurrent(ref)) throw new TranscriptError('SOURCE_CHANGED', true);
    } catch (error) {
      failure = error instanceof TranscriptError ? error : error instanceof SynthesisError
        ? new TranscriptError(error.code, error.retryable, error.retryMs) : new TranscriptError('GENERATION_FAILED');
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
      if (current.source_notes !== job.source_notes || current.source_kind !== job.source_kind ||
          (!failure && (current.source_content_hash !== sourceHash || current.pipeline_version !== pipeline))) {
        failure = new TranscriptError('SOURCE_CHANGED', true);
      }
      if (ref) {
        const config = await findConferencing(db, meeting.id);
        if (config?.transcription_policy_version !== ref.policyVersion || config.transcription_space_name !== job.source_space_name ||
            !await this.dependencies.transcripts!.isCurrent(ref)) failure = new TranscriptError('SOURCE_CHANGED', true);
      }
      if (!active || !active.ended_at || active.cancelled_at) failure = new TranscriptError('GROUP_UNAVAILABLE', true);
      if (job.source_kind === 'meet_transcript' && deadline && finished >= deadline && job.failure_code !== 'MANUAL_RETRY') {
        failure = new TranscriptError('SLA_EXCEEDED');
      }
      if (failure) {
        const delay = Math.max(failure.retryAfterMs, Math.min(15 * 60_000, 30_000 * 2 ** Math.min(job.attempt_count, 10))) + Math.floor(Math.random() * 1000);
        const retryAt = new Date(finished.getTime() + delay);
        const waiting = failure.code === 'TRANSCRIPT_PENDING' && job.failure_code !== 'MANUAL_RETRY';
        const retry = failure.retryable && (waiting || job.attempt_count < maxAttempts) && (job.failure_code === 'MANUAL_RETRY' || !deadline || retryAt < deadline);
        await db.update(meetingMinutes).set({
          ...clear, next_attempt_at: retry ? retryAt : null,
          attempt_count: waiting ? Math.max(0, job.attempt_count - 1) : job.attempt_count,
          generation_status: retry ? 'queued' : 'failed',
          failure_code: retry && job.failure_code === 'MANUAL_RETRY' ? 'MANUAL_RETRY' :
            !retry && failure.retryable && deadline && missed ? 'SLA_EXCEEDED' : failure.code,
        }).where(eq(meetingMinutes.meeting_id, meeting.id));
        return;
      }
      const agenda = await db.select({ id: meetingAgendaItems.id, subject: meetingAgendaItems.subject,
        status: meetingAgendaItems.review_status }).from(meetingAgendaItems)
        .where(eq(meetingAgendaItems.meeting_id, meeting.id)).orderBy(meetingAgendaItems.id);
      const id = randomUUID();
      body = [
        'Início previsto: ' + meeting.starts_at.toISOString(), 'Encerramento: ' + meeting.ended_at?.toISOString(),
        'Pautas registradas', ...agenda.map(item => '- ' + item.subject + ' (' + item.status + ')'), body,
      ].join('\n');
      if (body.length > 32_000 || meeting.subject.length > 150) {
        await db.update(meetingMinutes).set({ ...clear, generation_status: 'failed', failure_code: 'AI_OUTPUT_LIMIT',
          next_attempt_at: null }).where(eq(meetingMinutes.meeting_id, meeting.id));
        return;
      }
      await db.insert(meetingMinuteRevisions).values({
        id, meeting_id: meeting.id, title: meeting.subject, body,
        source_kind: job.source_kind, created_at: finished,
        generation_provenance: { sourceKind: job.source_kind as 'notes' | 'meet_transcript', sourceHash, pipelineVersion: pipeline,
          ...(ref ? { transcriptId: ref.transcriptId, transcriptVersion: ref.version, policyVersion: ref.policyVersion } : {}) },
      });
      await db.update(meetingMinutes).set({
        ...clear, generation_status: 'ready', failure_code: null, next_attempt_at: null,
        draft_revision_id: id, draft_status: 'pending', version: sql`${meetingMinutes.version} + 1`,
        transcript_ready_at: ref ? current.transcript_ready_at ?? finished : current.transcript_ready_at,
        conference_name: ref?.conferenceName, source_transcripts: ref?.providerTranscriptNames,
      }).where(eq(meetingMinutes.meeting_id, meeting.id));
    });
    return true;
  }
}
