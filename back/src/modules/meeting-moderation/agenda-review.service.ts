import { and, eq, sql } from 'drizzle-orm';
import { meetingAgendaItems } from '../../db/schema';
import { PostgresMeetingAgendaRepository } from '../meeting-agenda/meeting-agenda.repository';
import { toAgendaItemDto } from '../meeting-agenda/meeting-agenda.types';
import type { PostgresMeetingsRepository } from '../meetings/meetings.repository';
import { moderationError } from './meeting-moderation.errors';
import { lockModerationScope } from './meeting-moderation.service';

export type AgendaReviewDecision = 'approved' | 'rejected';

export class AgendaReviewService {
  constructor(private readonly meetings: PostgresMeetingsRepository, private readonly clock = () => new Date()) {}

  review(meetingId: string, itemId: string, actorId: bigint, decision: AgendaReviewDecision) {
    return this.meetings.transaction(async (tx, db) => {
      const scope = await lockModerationScope(tx, meetingId, actorId);
      if (scope.meeting.ended_at !== null) throw moderationError('MEETING_ENDED');

      const now = this.clock();
      const [updated] = await db.update(meetingAgendaItems).set({
        review_status: decision, reviewed_by_user_id: actorId,
        reviewed_at: sql`greatest(${now.toISOString()}::timestamptz, ${meetingAgendaItems.created_at})`,
      }).where(and(eq(meetingAgendaItems.meeting_id, meetingId), eq(meetingAgendaItems.id, itemId),
        eq(meetingAgendaItems.review_status, 'pending')))
        .returning({ id: meetingAgendaItems.id });

      const item = await new PostgresMeetingAgendaRepository(db).get(meetingId, itemId);
      if (!item) throw moderationError('AGENDA_ITEM_NOT_FOUND');
      if (!updated) throw moderationError('AGENDA_ITEM_ALREADY_REVIEWED');
      return toAgendaItemDto(item);
    });
  }
}
