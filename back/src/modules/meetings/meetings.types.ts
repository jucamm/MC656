import type { meetingAccessMode, meetingParticipantStatus, meetingParticipants, meetings } from '../../db/schema';

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
