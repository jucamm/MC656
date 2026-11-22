import type { meetingAccessMode, meetingOrganizerTransfers, meetingParticipantStatus, meetingParticipants, meetings } from '../../db/schema';

export type MeetingAccessMode = typeof meetingAccessMode.enumValues[number];
export type InvitationDecision = Exclude<typeof meetingParticipantStatus.enumValues[number], 'pending'>;
export type Meeting = typeof meetings.$inferSelect;
export type Participant = typeof meetingParticipants.$inferInsert;

export interface CreateMeetingInput {
  subject: string;
  startsAt: Date;
  groupId: string | null;
  accessMode: MeetingAccessMode;
  participantIds: bigint[];
  participantEmails: string[];
}

export interface MeetingCursor {
  startsAt: string;
  id: string;
}

export interface MeetingDto {
  id: string;
  subject: string;
  starts_at: string;
  visibility: 'public' | 'private';
  organizer_name: string;
  actions: { can_manage: boolean };
}

export interface MeetingInvitationDto {
  meeting_id: string;
  subject: string;
  starts_at: string;
  invited_by_user_name: string;
}

export interface MeetingParticipantDto {
  user_id: string;
  name: string;
  origin: Participant['origin'];
  status: Participant['status'];
  is_eligible: boolean;
  is_moderator: boolean;
}

export type OrganizerTransfer = typeof meetingOrganizerTransfers.$inferSelect;
export type TransferResolution = Exclude<OrganizerTransfer['status'], 'pending'>;

export interface OrganizerTransferDto {
  id: string;
  meeting_id: string;
  requested_by_user_id: string;
  recipient_user_id: string;
  status: OrganizerTransfer['status'];
  requested_at: string;
}

export interface ReceivedOrganizerTransferDto extends OrganizerTransferDto {
  subject: string;
  starts_at: string;
  requested_by_user_name: string;
}
