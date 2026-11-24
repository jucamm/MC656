import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { groups, meetingMinuteRevisions, meetingMinutes, meetings } from '../../db/schema';
import { DomainError } from '../../errors/domain.error';
import type { PageInput } from '../groups/groups.types';
import { visibleTo, type MeetingDatabaseTransaction, type PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { type MeetingCursor } from '../meetings/meetings.types';
import { editorialActions, minutesMissing as missing, requireMinutesManager } from '../meeting-minutes-review/minutes-review.policy';
import type { MeetTranscriptClient } from './meet-transcript.client';
import type { TranscriptSourceReader } from '../meeting-transcripts/transcript.contract';
import { aiConfiguration } from '../ai/gemini';
import { revisionDto, type Minutes } from './minutes.types';

const readOnly = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;
const conflict = () => new DomainError('MINUTES_CONFLICT', 'A ata já está em processamento ou revisão.');
const noTranscript = () => new DomainError('TRANSCRIPT_UNAVAILABLE', 'Transcrição indisponível.');

async function load(db: MeetingDatabaseTransaction, id: string) {
  const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, id));
  if (row?.visibility === 'deleted') throw missing();
  return row;
}

async function revision(db: MeetingDatabaseTransaction, meetingId: string, id: string | null | undefined) {
  if (!id) return null;
  const [row] = await db.select().from(meetingMinuteRevisions)
    .where(and(eq(meetingMinuteRevisions.meeting_id, meetingId), eq(meetingMinuteRevisions.id, id)));
  return row ?? null;
}

const recoverable = new Set(['MEET_UNAVAILABLE', 'MEET_WAITING_ARTIFACT', 'SLA_EXCEEDED',
  'MEET_ACCESS_DENIED', 'MEET_NOT_CONFIGURED', 'GROUP_UNAVAILABLE', 'GENERATION_FAILED',
  'AI_PROVIDER_UNREACHABLE', 'AI_PROVIDER_HTTP_400', 'AI_PROVIDER_HTTP_401', 'AI_PROVIDER_HTTP_403', 'AI_PROVIDER_HTTP_404',
  'AI_PROVIDER_HTTP_408', 'AI_PROVIDER_HTTP_429', 'AI_PROVIDER_HTTP_500', 'AI_PROVIDER_HTTP_502',
  'AI_PROVIDER_HTTP_503', 'AI_PROVIDER_HTTP_504',
  'AI_CONFIGURATION_PENDING', 'SOURCE_CHANGED', 'TRANSCRIPT_PENDING', 'TRANSCRIPT_UNAVAILABLE']);

export async function describeMinutesReview(db: MeetingDatabaseTransaction, id: string, row?: Minutes) {
  const hasDraft = !!(row?.draft_revision_id || row?.published_revision_id);
  const busy = row?.generation_status === 'queued' || row?.generation_status === 'running';
  return {
    version: row?.version ?? 1, generation_status: row?.generation_status ?? 'unavailable',
    visibility: row?.visibility ?? 'unpublished', draft_status: row?.draft_status ?? null,
    draft: revisionDto(await revision(db, id, row?.draft_revision_id)),
    published: revisionDto(await revision(db, id, row?.published_revision_id)),
    deadline_at: row?.deadline_at?.toISOString() ?? null,
    transcript_ready_at: row?.transcript_ready_at?.toISOString() ?? null,
    sla_missed_at: row?.sla_missed_at?.toISOString() ?? null, failure_code: row?.failure_code ?? null,
    ai: { configuration: aiConfiguration(), reason: aiConfiguration() === 'pending' ? 'AI_CONFIGURATION_PENDING' : undefined },
    actions: {
      ...editorialActions(row),
      can_add_notes: !busy && !hasDraft, can_retry: !busy && !hasDraft && recoverable.has(row?.failure_code ?? ''),
      can_read_transcript: !!(row?.conference_name && row.source_transcripts?.length),
    },
  };
}

export class MinutesService {
  constructor(private readonly meetings: PostgresMeetingsRepository,
    _legacyClient?: MeetTranscriptClient, private readonly clock = () => new Date(),
    private readonly transcripts?: TranscriptSourceReader) {}

  published(id: string, actor: bigint) {
    return this.meetings.transaction(async (tx, db) => {
      const scope = await tx.readScope(id, actor);
      if (!scope?.meeting.ended_at) throw missing();
      const row = await load(db, id);
      if (row?.visibility !== 'published' || !row.published_at) throw missing();
      const item = await revision(db, id, row.published_revision_id);
      if (!item) throw missing();
      return { meeting_id: id, revision_id: item.id, title: item.title, body: item.body,
        published_at: row.published_at.toISOString() };
    }, readOnly);
  }

  history(actor: bigint, page: PageInput<MeetingCursor>) {
    return this.meetings.transaction(async (_tx, db) => {
      const after = page.after;
      const rows = await db.select({
        meeting_id: meetings.id, title: meetingMinuteRevisions.title, starts_at: meetings.starts_at,
        published_at: meetingMinutes.published_at,
        cursorAt: sql<string>`to_char(${meetingMinutes.published_at} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      }).from(meetingMinutes).innerJoin(meetings, eq(meetings.id, meetingMinutes.meeting_id))
        .innerJoin(meetingMinuteRevisions, and(eq(meetingMinuteRevisions.meeting_id, meetings.id),
          eq(meetingMinuteRevisions.id, meetingMinutes.published_revision_id)))
        .leftJoin(groups, eq(groups.id, meetings.group_id))
        .where(and(visibleTo(db, actor), isNotNull(meetings.ended_at), eq(meetingMinutes.visibility, 'published'), after ?
          sql`(${meetingMinutes.published_at}, ${meetings.id}) < (${after.startsAt}::timestamptz, ${after.id}::uuid)` : undefined))
        .orderBy(desc(meetingMinutes.published_at), desc(meetings.id)).limit(page.limit + 1);
      const items = rows.slice(0, page.limit).map(row => ({
        meeting_id: row.meeting_id, title: row.title, starts_at: row.starts_at.toISOString(),
        published_at: row.published_at?.toISOString(),
      }));
      const last = rows[page.limit - 1];
      return { items, next_cursor: rows.length > page.limit ? last.cursorAt + '|' + last.meeting_id : null };
    }, readOnly);
  }

  async review(id: string, actor: bigint) {
    const result = await this.meetings.transaction(async (tx, db) => {
      requireMinutesManager(await tx.readScope(id, actor));
      const row = await load(db, id);
      return { review: await describeMinutesReview(db, id, row), row };
    }, readOnly);
    if (this.transcripts) {
      const description = await this.transcripts.describe(id);
      result.review.actions.can_read_transcript = description.state === 'available';
      const row = result.row;
      const sourceOutdated = row?.source_kind === 'meet_transcript' && !!(row.draft_revision_id || row.published_revision_id) &&
        (description.state !== 'available' || !description.ref || description.ref.contentHash !== row.source_content_hash ||
          description.ref.version !== row.source_transcript_version);
      return { ...result.review, ai: { ...result.review.ai, source_outdated: Boolean(sourceOutdated) } };
    }
    return result.review;
  }

  async transcript(id: string, actor: bigint, limit: number, cursor: number) {
    const read = () => this.meetings.transaction(async (tx, db) => {
      requireMinutesManager(await tx.readScope(id, actor));
      return load(db, id);
    }, readOnly);
    await read();
    const reader = this.transcripts;
    if (!reader) throw noTranscript();
    const described = await reader.describe(id);
    if (described.state !== 'available' || !described.ref) throw noTranscript();
    const source = await reader.loadForGeneration(id, described.ref, AbortSignal.timeout(25_000)).catch(() => { throw noTranscript(); });
    await read(); // Permission may have changed while loading the private snapshot.
    if (!await reader.isCurrent(described.ref)) throw noTranscript();
    return { items: source.entries.slice(cursor, cursor + limit),
      next_cursor: cursor + limit < source.entries.length ? id + ':' + (cursor + limit) : null };
  }

  queue(id: string, actor: bigint, notes?: string) {
    return this.meetings.transaction(async (tx, db) => {
      requireMinutesManager(await tx.lockScope(id, actor));
      const row = await load(db, id);
      if (row && (row.draft_revision_id || row.published_revision_id ||
          row.generation_status === 'queued' || row.generation_status === 'running')) throw conflict();
      if (notes === undefined && (!row || !recoverable.has(row.failure_code ?? ''))) throw conflict();
      const changes = {
        generation_status: 'queued' as const, next_attempt_at: this.clock(),
        failure_code: notes === undefined ? 'MANUAL_RETRY' : null,
        source_kind: notes === undefined ? row!.source_kind : 'notes' as const,
        source_notes: notes ?? row?.source_notes ?? null, attempt_count: 0,
        source_content_hash: null, pipeline_version: null, source_transcript_id: null,
        source_transcript_version: null, source_policy_version: null,
      };
      await db.insert(meetingMinutes).values({ meeting_id: id, ...changes })
        .onConflictDoUpdate({ target: meetingMinutes.meeting_id, set: changes });
    });
  }
}
