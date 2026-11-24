export type MeetingAccess =
  | { visibility: 'public' }
  | { visibility: 'private'; audience?: 'group' | 'selected' };

export interface CreateMeeting {
  subject: string;
  legislative_bill_id?: string;
  starts_at: string;
  group_id?: string;
  access: MeetingAccess;
  participant_ids: string[];
  participant_emails: string[];
}

export interface Meeting {
  id: string;
  legislative_bill_id?: string | null;
  subject: string;
  starts_at: string;
  visibility: MeetingAccess['visibility'];
  organizer_name: string;
  actions: { can_manage: boolean };
}

export interface MeetingParticipant {
  user_id: string;
  name: string;
  origin: 'creator' | 'group' | 'invitation';
  status: 'confirmed' | 'pending' | 'declined';
  is_eligible: boolean;
  is_moderator: boolean;
}

export interface MeetingInvitation {
  meeting_id: string;
  subject: string;
  starts_at: string;
  invited_by_user_name: string;
}

export interface OrganizerTransfer {
  id: string;
  meeting_id: string;
  requested_by_user_id: string;
  recipient_user_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  requested_at: string;
}

export interface ReceivedOrganizerTransfer extends OrganizerTransfer {
  subject: string;
  starts_at: string;
  requested_by_user_name: string;
}
