export interface ActionItemSource {
  kind: 'agenda_item' | 'poll';
  label?: string;
  id: string;
}

export interface ActionItemSummary {
  id: string;
  meeting_id: string;
  description: string;
  due_on: string;
  status: 'open' | 'completed' | 'cancelled';
  source: ActionItemSource;
  awaiting_my_response?: boolean;
}

export interface Assignee {
  user_id: string;
  name: string;
}

export interface ActionAssignment {
  id: string;
  user_id: string;
  state: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  proposed_by_user_id: string;
  proposed_at: string;
  responded_at: string | null;
  withdrawn_at: string | null;
}

export interface ActionItem extends ActionItemSummary {
  version: number;
  accepted_count: number;
  pending_count: number;
  my_assignment: ActionAssignment | null;
  actions: {
    can_assign: boolean;
    can_change_deadline: boolean;
    can_respond: boolean;
    can_withdraw: boolean;
    can_complete: boolean;
    can_cancel: boolean;
  };
}

export interface CreateActionItem {
  id: string;
  description: string;
  due_on: string;
  source: ActionItemSource;
  assignee_user_ids: string[];
}
