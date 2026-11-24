import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { groups, meetingConferencing, meetings, meetingTranscriptImports as jobs, meetingTranscriptSnapshots as snapshots } from '../../db/schema';
import { TranscriptError, type MeetTranscriptClient } from '../meeting-minutes/meet-transcript.client';
import { normalizeEntries, sha256, type TranscriptStorage } from './transcript.storage';
/** Separate from minutes/AI. Remote endTime and FILE_GENERATED are mandatory. */
export class MeetingTranscriptWorker {
  constructor(private readonly db: NodePgDatabase, private readonly client: MeetTranscriptClient,
    private readonly storage: TranscriptStorage, private readonly clock = () => new Date()) {}
  async discover() {
    const rows = await this.db.select({ meeting: meetings, configuration: meetingConferencing }).from(meetings)
      .innerJoin(meetingConferencing, eq(meetingConferencing.meeting_id, meetings.id))
      .leftJoin(groups, eq(groups.id, meetings.group_id)).where(and(isNull(groups.deleted_at), isNull(meetings.cancelled_at),
        lte(meetings.starts_at, this.clock()), eq(meetingConferencing.transcription_policy_version, this.client.config.policyVersion),
        sql`${meetingConferencing.transcription_space_name} IS NOT NULL`));
    for (const row of rows) {
      // Missing expected end remains explicit configuration_pending; never invent duration.
      if (!row.meeting.scheduled_ends_at || !row.configuration.transcription_space_name) continue;
      const now = this.clock();
      await this.db.insert(jobs).values({ meeting_id: row.meeting.id, schedule_version: row.meeting.schedule_version,
        space_name: row.configuration.transcription_space_name, policy_version: this.client.config.policyVersion,
        deadline_at: new Date(+row.meeting.scheduled_ends_at + 86_400_000), next_attempt_at: now }).onConflictDoUpdate({ target: jobs.meeting_id, set: {
          schedule_version: row.meeting.schedule_version, space_name: row.configuration.transcription_space_name,
          policy_version: this.client.config.policyVersion, state: 'pending', attempts: 0, consecutive_failures: 0,
          deadline_at: new Date(+row.meeting.scheduled_ends_at + 86_400_000), next_attempt_at: now,
          lease_token: null, lease_until: null, failure_code: null,
        }, setWhere: or(sql`${jobs.schedule_version} <> ${row.meeting.schedule_version}`,
          sql`${jobs.space_name} <> ${row.configuration.transcription_space_name}`, sql`${jobs.policy_version} <> ${this.client.config.policyVersion}`) });
    }
  }
  async runOnce() {
    await this.discover(); const now = this.clock();
    const job = await this.db.transaction(async tx => {
      const [row] = await tx.select().from(jobs).where(and(sql`${jobs.state} IN ('pending', 'processing')`,
        lte(jobs.next_attempt_at, now), or(isNull(jobs.lease_until), lte(jobs.lease_until, now))))
        .orderBy(jobs.next_attempt_at).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const [claimed] = await tx.update(jobs).set({ state: 'processing', attempts: row.attempts + 1,
        lease_token: randomUUID(), lease_until: new Date(+now + 180_000) }).where(eq(jobs.meeting_id, row.meeting_id)).returning();
      return claimed;
    });
    if (!job) return false;
    try {
      if (job.attempts > 96 || job.deadline_at <= now) throw new TranscriptError('TRANSCRIPT_DEADLINE_EXCEEDED');
      const [source] = await this.db.select({ meeting: meetings, config: meetingConferencing, deletedAt: groups.deleted_at }).from(meetings)
        .innerJoin(meetingConferencing, eq(meetingConferencing.meeting_id, meetings.id)).leftJoin(groups, eq(groups.id, meetings.group_id))
        .where(eq(meetings.id, job.meeting_id));
      if (!source || source.deletedAt || source.meeting.cancelled_at || source.meeting.schedule_version !== job.schedule_version ||
        source.config.transcription_space_name !== job.space_name || source.config.transcription_policy_version !== job.policy_version ||
        job.policy_version !== this.client.config.policyVersion) throw new TranscriptError('TRANSCRIPT_SOURCE_REVOKED');
      const result = await this.client.conferenceSource(job.space_name, source.meeting.starts_at, source.meeting.scheduled_ends_at!);
      const entries = normalizeEntries(result.entries);
      const contentHash = sha256(JSON.stringify({ normalization: 'meet-entries-v1', conference: result.conference,
        providerTranscriptNames: result.transcripts, conferenceEndedAt: result.conferenceEndedAt, policyVersion: job.policy_version, entries }));
      // Storage completes before the available commit. Same hash uses a stable logical key after a crash.
      const file = await this.storage.write(job.meeting_id, contentHash, source.meeting.subject, entries);
      await this.db.transaction(async tx => {
        if (source.meeting.group_id) {
          const [group] = await tx.select().from(groups).where(eq(groups.id, source.meeting.group_id)).for('update');
          if (!group || group.deleted_at) throw new TranscriptError('TRANSCRIPT_SOURCE_REVOKED');
        }
        const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, job.meeting_id)).for('update');
        const [config] = await tx.select().from(meetingConferencing).where(eq(meetingConferencing.meeting_id, job.meeting_id));
        if (!meeting || meeting.cancelled_at || meeting.schedule_version !== job.schedule_version || config?.transcription_space_name !== job.space_name ||
          config.transcription_policy_version !== job.policy_version) throw new TranscriptError('TRANSCRIPT_SOURCE_REVOKED');
        const [current] = await tx.select().from(jobs).where(and(eq(jobs.meeting_id, job.meeting_id), eq(jobs.lease_token, job.lease_token!))).for('update');
        if (!current || !current.lease_until || current.lease_until <= this.clock()) return;
        const [duplicate] = await tx.select().from(snapshots).where(and(eq(snapshots.meeting_id, job.meeting_id), eq(snapshots.content_hash, contentHash)));
        if (!duplicate) {
          const [last] = await tx.select({ version: snapshots.version }).from(snapshots).where(eq(snapshots.meeting_id, job.meeting_id)).orderBy(desc(snapshots.version)).limit(1);
          await tx.insert(snapshots).values({ id: randomUUID(), meeting_id: job.meeting_id, version: (last?.version ?? 0) + 1,
            content_hash: contentHash, normalization_version: 'meet-entries-v1', conference_name: result.conference,
            provider_transcript_names: result.transcripts, conference_ended_at: new Date(result.conferenceEndedAt), policy_version: job.policy_version,
            entries, docx_storage_key: file.key, docx_hash: file.hash, docx_bytes: file.bytes });
        }
        await tx.update(jobs).set({ state: 'available', conference_name: result.conference,
          conference_ended_at: new Date(result.conferenceEndedAt), deadline_at: new Date(+new Date(result.conferenceEndedAt) + 86_400_000),
          failure_code: null, consecutive_failures: 0, lease_token: null, lease_until: null, updated_at: this.clock() })
          .where(eq(jobs.meeting_id, job.meeting_id));
      });
    } catch (error) {
      const waiting = error instanceof TranscriptError && error.code === 'MEET_WAITING_ARTIFACT';
      const failures = waiting ? 0 : job.consecutive_failures + 1;
      const retry = error instanceof TranscriptError && error.retryable && job.attempts < 96 && failures < 5 && job.deadline_at > this.clock();
      await this.db.update(jobs).set({ state: retry ? waiting ? 'pending' : 'processing' :
        error instanceof TranscriptError && ['TRANSCRIPT_DEADLINE_EXCEEDED', 'TRANSCRIPT_SOURCE_REVOKED'].includes(error.code) ? 'unavailable' : 'failed',
        failure_code: error instanceof TranscriptError ? error.code : 'TRANSCRIPT_STORAGE_FAILED', consecutive_failures: failures,
        next_attempt_at: new Date(+this.clock() + Math.min(900_000, 30_000 * 2 ** Math.min(job.attempts, 5))),
        lease_token: null, lease_until: null, updated_at: this.clock() }).where(and(eq(jobs.meeting_id, job.meeting_id), eq(jobs.lease_token, job.lease_token!)));
    }
    return true;
  }
}
