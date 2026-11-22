import { and, eq, gt, isNull } from 'drizzle-orm';
import { meetingPolls } from '../../db/schema';
import type { PageInput } from '../groups/groups.types';
import type { MeetingDatabaseTransaction } from '../meetings/meetings.repository';

export class PostgresMeetingPollsRepository {
  constructor(private readonly db: MeetingDatabaseTransaction) {}

  list(meetingId: string, page: PageInput<string>) {
    return this.db.select().from(meetingPolls).where(and(
      eq(meetingPolls.meeting_id, meetingId), page.after ? gt(meetingPolls.id, page.after) : undefined,
    )).orderBy(meetingPolls.id).limit(page.limit + 1);
  }

  async find(meetingId: string, pollId: string) {
    const [poll] = await this.db.select().from(meetingPolls)
      .where(and(eq(meetingPolls.meeting_id, meetingId), eq(meetingPolls.id, pollId)));
    return poll;
  }

  async open(poll: typeof meetingPolls.$inferInsert) {
    const [created] = await this.db.insert(meetingPolls).values(poll).onConflictDoNothing().returning();
    return created;
  }

  async closeOpen(meetingId: string, actorId: bigint, now: Date) {
    await this.db.update(meetingPolls).set({ closed_at: now, closed_by_user_id: actorId }).where(and(
      eq(meetingPolls.meeting_id, meetingId), isNull(meetingPolls.closed_at),
    ));
  }
}
