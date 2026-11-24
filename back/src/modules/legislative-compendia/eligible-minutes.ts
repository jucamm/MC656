import { and, eq, exists, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { groups, meetingMinuteEvents as events, meetingMinuteRevisions as revisions, meetingMinutes as minutes, meetings } from '../../db/schema';

export function eligibleMinutes(db: Pick<NodePgDatabase, 'select'>) {
  return db.select({
    bill_id: meetings.legislative_bill_id,
    meeting_id: sql<string>`${meetings.id}`.as('meeting_id'), revision_id: sql<string>`${revisions.id}`.as('revision_id'),
    published_at: minutes.published_at, title: revisions.title, body: revisions.body,
  }).from(meetings)
    .innerJoin(minutes, eq(minutes.meeting_id, meetings.id))
    .innerJoin(revisions, and(eq(revisions.meeting_id, meetings.id), eq(revisions.id, minutes.published_revision_id)))
    .leftJoin(groups, eq(groups.id, meetings.group_id))
    .where(and(isNotNull(meetings.legislative_bill_id), eq(meetings.access_mode, 'public'),
      isNotNull(meetings.ended_at), or(isNull(meetings.group_id), and(isNotNull(groups.id), isNull(groups.deleted_at))),
      eq(minutes.visibility, 'published'), isNotNull(minutes.published_at),
      exists(db.select({ id: events.id }).from(events).where(and(eq(events.meeting_id, meetings.id),
        eq(events.revision_id, revisions.id), eq(events.action, 'publish'), eq(events.to_visibility, 'published')))),
    )).as('eligible_minutes');
}
