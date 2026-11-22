export interface MeetingModerationState {
  phase: 'scheduled' | 'in_progress' | 'ended';
  actions: { can_moderate: boolean; can_end: boolean; can_manage_polls: boolean };
  targets: { user_id: string; name: string; is_blocked: boolean; can_block: boolean }[];
}

export interface MeetingPoll {
  id: string;
  meeting_id: string;
  question: string;
  status: 'open' | 'closed';
  opened_at: string;
  opened_by_user_id: string;
  closed_at: string | null;
  closed_by_user_id: string | null;
}

export type AgendaReviewDecision = 'approved' | 'rejected';
