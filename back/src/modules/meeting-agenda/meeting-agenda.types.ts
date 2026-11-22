import type { meetingAgendaItems } from '../../db/schema';
import type { PageDto, PageInput } from '../groups/groups.types';

export type AgendaItem = typeof meetingAgendaItems.$inferSelect;
export type AgendaReviewStatus = AgendaItem['review_status'];
export type AgendaItemProjection = AgendaItem & { proposer_name: string };
export type AgendaListInput = PageInput<string> & { reviewStatus?: AgendaReviewStatus };
export type AgendaCreateInput = Pick<AgendaItem, 'subject' | 'context'>;

export interface AgendaItemDto {
  id: string;
  meeting_id: string;
  subject: string;
  context: string;
  proposed_by_user_id: string;
  proposer_name: string;
  created_at: string;
  review_status: AgendaReviewStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
}

export interface AgendaPageDto extends PageDto<AgendaItemDto> {
  actions: { can_submit: boolean; can_review: boolean };
}

export function toAgendaItemDto(item: AgendaItemProjection): AgendaItemDto {
  return {
    id: item.id, meeting_id: item.meeting_id, subject: item.subject, context: item.context,
    proposed_by_user_id: item.proposed_by_user_id.toString(), proposer_name: item.proposer_name,
    created_at: item.created_at.toISOString(), review_status: item.review_status,
    reviewed_by_user_id: item.reviewed_by_user_id?.toString() ?? null,
    reviewed_at: item.reviewed_at?.toISOString() ?? null,
  };
}
