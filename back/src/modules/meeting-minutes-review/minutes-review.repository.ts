import { eq } from 'drizzle-orm';
import { meetingMinuteEvents, meetingMinuteRevisions, meetingMinutes } from '../../db/schema';
import type { MeetingDatabaseTransaction } from '../meetings/meetings.repository';

export async function lockMinutes(db: MeetingDatabaseTransaction, meetingId: string) {
  const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.meeting_id, meetingId)).for('update');
  return row;
}

export function addMinuteRevision(db: MeetingDatabaseTransaction, value: typeof meetingMinuteRevisions.$inferInsert) {
  return db.insert(meetingMinuteRevisions).values(value);
}

export async function updateMinutes(db: MeetingDatabaseTransaction, meetingId: string,
  values: Partial<typeof meetingMinutes.$inferInsert>) {
  const [row] = await db.update(meetingMinutes).set(values).where(eq(meetingMinutes.meeting_id, meetingId)).returning();
  return row;
}

export function addMinuteEvent(db: MeetingDatabaseTransaction, value: typeof meetingMinuteEvents.$inferInsert) {
  return db.insert(meetingMinuteEvents).values(value);
}
