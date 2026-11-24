import { and, desc, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { groups, meetingConferencing, meetings, meetingTranscriptImports, meetingTranscriptSnapshots } from '../../db/schema';
import type { TranscriptRef, TranscriptSourceReader } from './transcript.contract';
import type { TranscriptStorage } from './transcript.storage';
type Snapshot = typeof meetingTranscriptSnapshots.$inferSelect;
export function snapshotRef(row: Snapshot): TranscriptRef {
  return { meetingId: row.meeting_id, transcriptId: row.id, version: row.version, contentHash: row.content_hash,
    conferenceName: row.conference_name, providerTranscriptNames: row.provider_transcript_names,
    conferenceEndedAt: row.conference_ended_at.toISOString(), policyVersion: row.policy_version };
}
export function sameTranscript(a: TranscriptRef, b: TranscriptRef) {
  return a.meetingId === b.meetingId && a.transcriptId === b.transcriptId && a.version === b.version && a.contentHash === b.contentHash &&
    a.conferenceName === b.conferenceName && a.conferenceEndedAt === b.conferenceEndedAt && a.policyVersion === b.policyVersion &&
    JSON.stringify(a.providerTranscriptNames) === JSON.stringify(b.providerTranscriptNames);
}
export class PostgresTranscriptSourceReader implements TranscriptSourceReader {
  constructor(private readonly db: NodePgDatabase, private readonly storage: TranscriptStorage, private readonly policyVersion: string) {}
  async latest(meetingId: string) {
    const [row] = await this.db.select({ snapshot: meetingTranscriptSnapshots }).from(meetingTranscriptSnapshots)
      .innerJoin(meetings, eq(meetings.id, meetingTranscriptSnapshots.meeting_id))
      .leftJoin(groups, eq(groups.id, meetings.group_id))
      .innerJoin(meetingTranscriptImports, eq(meetingTranscriptImports.meeting_id, meetings.id))
      .innerJoin(meetingConferencing, eq(meetingConferencing.meeting_id, meetings.id))
      .where(and(eq(meetings.id, meetingId), isNull(groups.deleted_at), isNull(meetings.cancelled_at),
        eq(meetingTranscriptImports.state, 'available'), eq(meetingTranscriptImports.conference_name, meetingTranscriptSnapshots.conference_name), eq(meetingTranscriptImports.schedule_version, meetings.schedule_version),
        eq(meetingTranscriptImports.policy_version, this.policyVersion), eq(meetingTranscriptSnapshots.policy_version, this.policyVersion),
        eq(meetingConferencing.transcription_policy_version, this.policyVersion),
        eq(meetingConferencing.transcription_space_name, meetingTranscriptImports.space_name)))
      .orderBy(desc(meetingTranscriptSnapshots.version)).limit(1);
    return row?.snapshot ?? null;
  }
  async describe(meetingId: string) {
    const row = await this.latest(meetingId);
    if (row) {
      try { await this.storage.read(row.docx_storage_key, row.docx_hash, row.docx_bytes); }
      catch { return { state: 'failed' as const, ref: null, failureCode: 'TRANSCRIPT_FILE_UNAVAILABLE' }; }
      return { state: 'available' as const, ref: snapshotRef(row), failureCode: null };
    }
    const [job] = await this.db.select().from(meetingTranscriptImports).where(eq(meetingTranscriptImports.meeting_id, meetingId));
    return { state: job?.state === 'available' ? 'unavailable' as const : job?.state ?? 'unavailable' as const,
      ref: null, failureCode: job?.state === 'available' ? 'TRANSCRIPT_SOURCE_REVOKED' : job?.failure_code ?? null };
  }
  async isCurrent(expected: TranscriptRef) {
    const status = await this.describe(expected.meetingId);
    return status.state === 'available' && !!status.ref && sameTranscript(status.ref, expected);
  }
  async loadForGeneration(meetingId: string, expected: TranscriptRef, signal: AbortSignal) {
    signal.throwIfAborted();
    if (meetingId !== expected.meetingId || !await this.isCurrent(expected)) throw new Error('TRANSCRIPT_SOURCE_CHANGED');
    const row = await this.latest(meetingId);
    if (!row || !sameTranscript(snapshotRef(row), expected)) throw new Error('TRANSCRIPT_SOURCE_CHANGED');
    signal.throwIfAborted();
    return { ref: snapshotRef(row), entries: row.entries };
  }
}
