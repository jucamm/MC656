import type { meetingPolls } from '../../db/schema';

export function toPollDto(poll: typeof meetingPolls.$inferSelect) {
  return {
    id: poll.id, meeting_id: poll.meeting_id, question: poll.question,
    status: poll.closed_at === null ? 'open' as const : 'closed' as const,
    opened_at: poll.opened_at.toISOString(), opened_by_user_id: poll.opened_by_user_id.toString(),
    closed_at: poll.closed_at?.toISOString() ?? null, closed_by_user_id: poll.closed_by_user_id?.toString() ?? null,
  };
}
