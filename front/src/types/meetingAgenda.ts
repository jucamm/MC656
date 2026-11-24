import type { Page } from './groups';

export type AgendaReviewStatus = 'pending' | 'approved' | 'rejected';

export interface AgendaItem {
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

export interface AgendaPage extends Page<AgendaItem> {
  actions: { can_submit: boolean; can_review: boolean };
}

export type CreateAgendaItem = Pick<AgendaItem, 'subject' | 'context'>;
