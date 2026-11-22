import { eq } from 'drizzle-orm';
import { meetingParticipationBlocks, meetings } from '../../db/schema';
import type { MeetingDatabaseTransaction } from '../meetings/meetings.repository';

export class PostgresMeetingModerationRepository {
  constructor(private readonly db: MeetingDatabaseTransaction) {}

  async block(meetingId: string, targetId: bigint, actorId: bigint, now: Date) {
    await this.db.insert(meetingParticipationBlocks).values({
      meeting_id: meetingId, user_id: targetId, blocked_by_user_id: actorId, blocked_at: now,
    }).onConflictDoNothing();
  }

  async end(meetingId: string, actorId: bigint, now: Date) {
    await this.db.update(meetings).set({ ended_at: now, ended_by_user_id: actorId }).where(eq(meetings.id, meetingId));
  }
}
