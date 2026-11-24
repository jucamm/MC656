import { billIsSelectable } from '../legislative-bills/legislative.types';
import { randomUUID } from 'node:crypto';
import { requireActiveGroupMember, requireGroupAdministrator } from '../groups/group-access';
import type { PageDto, PageInput } from '../groups/groups.types';
import { invalidField } from '../identity/validators/registration.validator';
import { meetingError } from './meetings.errors';
import type { MeetingTransaction, PostgresMeetingsRepository } from './meetings.repository';
import type {
  CreateMeetingInput, InvitationDecision, Meeting, MeetingCursor, MeetingDto, MeetingInvitationDto,
  MeetingModeratorsDto, MeetingParticipantDto, OrganizerTransfer, OrganizerTransferDto, Participant, ReceivedOrganizerTransferDto, TransferResolution,
} from './meetings.types';

function toMeetingDto(row: Pick<Meeting, 'id' | 'subject' | 'starts_at' | 'access_mode' | 'legislative_bill_id'> & {
  organizer_name: string;
  canManage: boolean;
}): MeetingDto {
  return {
    id: row.id, subject: row.subject, legislative_bill_id: row.legislative_bill_id, starts_at: row.starts_at.toISOString(),
    visibility: row.access_mode === 'public' ? 'public' : 'private',
    organizer_name: row.organizer_name, actions: { can_manage: row.canManage },
  };
}

function toOrganizerTransferDto(transfer: OrganizerTransfer): OrganizerTransferDto {
  return {
    id: transfer.id, meeting_id: transfer.meeting_id, status: transfer.status,
    requested_by_user_id: transfer.requested_by_user_id.toString(),
    recipient_user_id: transfer.recipient_user_id.toString(),
    requested_at: transfer.requested_at.toISOString(),
  };
}

function requireOrganizer(meeting: Meeting, actorId: bigint): void {
  if (meeting.organizer_user_id !== actorId) throw meetingError('MEETING_ORGANIZER_REQUIRED');
}

export class MeetingsService {
  constructor(private readonly repository: PostgresMeetingsRepository, private readonly clock = () => new Date()) {}

  async create(actor: { id: bigint; name: string }, input: CreateMeetingInput): Promise<MeetingDto> {
    const meeting = await this.repository.transaction(async tx => {
      const group = input.groupId ? await tx.lockGroup(input.groupId) : null;
      if (input.groupId && !group) throw meetingError('GROUP_NOT_FOUND');
      if (group) {
        const member = await requireActiveGroupMember(group, actor.id);
        requireGroupAdministrator(member.role);
      }

      const emailIds = await tx.findUserIdsByEmail(input.participantEmails);
      if (emailIds.length !== input.participantEmails.length) throw meetingError('MEETING_PARTICIPANT_NOT_ELIGIBLE');
      const selectedIds = [...new Set([...input.participantIds, ...emailIds])].filter(id => id !== actor.id);
      const groupMemberIds = new Set(await group?.findMemberIds(selectedIds));
      if (input.participantIds.some(id => id !== actor.id && !groupMemberIds.has(id))) {
        throw meetingError('MEETING_PARTICIPANT_NOT_ELIGIBLE');
      }

      const bill = input.legislativeBillId ? await tx.lockLegislativeBill(input.legislativeBillId) : null;
      const now = this.clock();
      if (input.legislativeBillId && (!bill || !billIsSelectable(bill, now))) throw meetingError('LEGISLATIVE_BILL_UNAVAILABLE');
      if (input.startsAt <= now) invalidField('starts_at', 'Informe um horário de início no futuro.');
      const meetingId = randomUUID();
      const participants: Participant[] = [{
        meeting_id: meetingId, user_id: actor.id, origin: 'creator', status: 'confirmed', created_at: now,
      }];
      for (const id of selectedIds) {
        const member = groupMemberIds.has(id);
        participants.push({
          meeting_id: meetingId, user_id: id, origin: member ? 'group' : 'invitation',
          status: member ? 'confirmed' : 'pending', created_at: now,
        });
      }
      return tx.insertMeeting({
        id: meetingId, subject: bill?.label ?? input.subject, legislative_bill_id: input.legislativeBillId, starts_at: input.startsAt, group_id: input.groupId,
        access_mode: input.accessMode, created_by_user_id: actor.id, organizer_user_id: actor.id, created_at: now,
      }, participants);
    });
    return toMeetingDto({ ...meeting, organizer_name: actor.name, canManage: true });
  }

  async list(actorId: bigint, page: PageInput<MeetingCursor>): Promise<PageDto<MeetingDto>> {
    const rows = await this.repository.listVisible(actorId, page);
    const items = rows.slice(0, page.limit).map(toMeetingDto);
    const last = rows[page.limit - 1];
    return { items, next_cursor: rows.length > page.limit ? `${last.cursorStartsAt}|${last.id}` : null };
  }

  async get(meetingId: string, actorId: bigint): Promise<MeetingDto> {
    const meeting = await this.repository.findVisible(meetingId, actorId);
    if (!meeting) throw meetingError('MEETING_NOT_FOUND');
    return toMeetingDto(meeting);
  }

  async listParticipants(meetingId: string, actorId: bigint, page: PageInput<bigint>): Promise<PageDto<MeetingParticipantDto>> {
    const rows = await this.repository.listParticipants(meetingId, actorId, page);
    if (!rows.length) throw meetingError('MEETING_NOT_FOUND');
    if (!rows[0].canManage) throw meetingError('MEETING_MANAGEMENT_FORBIDDEN');
    const participants = rows.flatMap(({ participant }) => participant ? [participant] : []);
    const items = participants.slice(0, page.limit).map(row => ({ ...row, user_id: row.user_id.toString() }));
    return { items, next_cursor: participants.length > page.limit ? items[page.limit - 1].user_id : null };
  }

  async listInvitations(actorId: bigint, page: PageInput<string>): Promise<PageDto<MeetingInvitationDto>> {
    const rows = await this.repository.listPendingInvitations(actorId, page);
    const items = rows.slice(0, page.limit).map(row => ({ ...row, starts_at: row.starts_at.toISOString() }));
    return { items, next_cursor: rows.length > page.limit ? rows[page.limit - 1].meeting_id : null };
  }

  async respondToInvitation(meetingId: string, actorId: bigint, decision: InvitationDecision): Promise<void> {
    await this.repository.transaction(async tx => {
      const availability = await tx.findInvitationMeeting(meetingId, actorId);
      if (!availability) throw meetingError('MEETING_INVITATION_NOT_FOUND');
      const meeting = await tx.lockActiveMeeting(meetingId, availability.groupId);
      if (!meeting) throw meetingError('MEETING_INVITATION_NOT_FOUND');
      if (meeting.ended_at && decision === 'confirmed') throw meetingError('MEETING_ENDED');

      const now = this.clock();
      const resolvedAt = now < meeting.created_at ? meeting.created_at : now;
      if (!await tx.resolveInvitation(meetingId, actorId, decision, resolvedAt)) {
        throw meetingError('MEETING_INVITATION_RESOLVED');
      }
    });
  }

  async requestOrganizerTransfer(meetingId: string, actorId: bigint, recipientId: bigint): Promise<OrganizerTransferDto> {
    const transfer = await this.repository.transaction(async tx => {
      const meeting = await this.lockMeetingForOrganizer(tx, meetingId, actorId);
      const eligible = recipientId !== actorId && await tx.isEligibleParticipant(meetingId, recipientId);
      const pending = await tx.findPendingTransfer(meetingId);
      const now = this.requireBeforeStart(meeting);
      if (!eligible) throw meetingError('ORGANIZER_TRANSFER_RECIPIENT_NOT_ELIGIBLE');
      if (pending) throw meetingError('ORGANIZER_TRANSFER_ALREADY_PENDING');

      return tx.insertTransfer({
        id: randomUUID(), meeting_id: meetingId, requested_by_user_id: actorId,
        recipient_user_id: recipientId, requested_at: now,
      });
    });
    return toOrganizerTransferDto(transfer);
  }

  async getOutgoingTransfer(meetingId: string, actorId: bigint): Promise<OrganizerTransferDto | null> {
    const row = await this.repository.findOutgoingTransfer(meetingId, actorId, this.clock());
    if (!row) throw meetingError('MEETING_NOT_FOUND');
    if (!row.canManage) throw meetingError('MEETING_ORGANIZER_REQUIRED');
    return row.transfer ? toOrganizerTransferDto(row.transfer) : null;
  }

  async listReceivedTransfers(actorId: bigint, page: PageInput<string>): Promise<PageDto<ReceivedOrganizerTransferDto>> {
    const rows = await this.repository.listReceivedTransfers(actorId, page, this.clock());
    const items = rows.slice(0, page.limit).map(row => ({
      ...toOrganizerTransferDto(row.transfer), subject: row.subject,
      starts_at: row.starts_at.toISOString(), requested_by_user_name: row.requested_by_user_name,
    }));
    return { items, next_cursor: rows.length > page.limit ? items[page.limit - 1].id : null };
  }

  async resolveOrganizerTransfer(meetingId: string, transferId: string, actorId: bigint, decision: TransferResolution): Promise<void> {
    await this.repository.transaction(async tx => {
      const meeting = decision === 'cancelled'
        ? await this.lockMeetingForOrganizer(tx, meetingId, actorId)
        : await this.lockMeetingForTransferRecipient(tx, meetingId, transferId, actorId);
      const transfer = await tx.findTransfer(meetingId, transferId);
      if (!transfer || (decision !== 'cancelled' && transfer.recipient_user_id !== actorId)) {
        throw meetingError('ORGANIZER_TRANSFER_NOT_FOUND');
      }
      if (transfer.status !== 'pending' || transfer.requested_by_user_id !== meeting.organizer_user_id) {
        throw meetingError('ORGANIZER_TRANSFER_RESOLVED');
      }
      const eligible = decision !== 'accepted' || await tx.isEligibleParticipant(meetingId, actorId);
      const now = this.requireBeforeStart(meeting);
      if (!eligible) throw meetingError('ORGANIZER_TRANSFER_RECIPIENT_NOT_ELIGIBLE');
      if (!await tx.resolveTransfer(transfer, decision, now)) throw meetingError('ORGANIZER_TRANSFER_RESOLVED');
      if (decision === 'accepted' && !await tx.changeOrganizer(meetingId, meeting.organizer_user_id, actorId)) {
        throw meetingError('ORGANIZER_TRANSFER_RESOLVED');
      }
    });
  }

  async setModerators(meetingId: string, actorId: bigint, participantIds: bigint[]): Promise<MeetingModeratorsDto> {
    return this.repository.transaction(async tx => {
      const meeting = await this.lockMeetingForOrganizer(tx, meetingId, actorId);
      const eligibleIds = await tx.findEligibleParticipantIds(meetingId, participantIds);
      this.requireBeforeStart(meeting);
      if (eligibleIds.length !== participantIds.length) throw meetingError('MEETING_PARTICIPANT_NOT_ELIGIBLE');

      await tx.replaceModerators(meetingId, eligibleIds);
      return { participant_ids: eligibleIds.map(id => id.toString()) };
    });
  }

  private async lockMeetingForOrganizer(tx: MeetingTransaction, meetingId: string, actorId: bigint): Promise<Meeting> {
    const scope = await tx.findVisibleMeetingGroup(meetingId, actorId);
    const meeting = scope && await tx.lockActiveMeeting(meetingId, scope.groupId);
    if (!meeting) throw meetingError('MEETING_NOT_FOUND');
    requireOrganizer(meeting, actorId);
    return meeting;
  }

  private async lockMeetingForTransferRecipient(
    tx: MeetingTransaction, meetingId: string, transferId: string, actorId: bigint,
  ): Promise<Meeting> {
    const scope = await tx.findTransferMeetingForRecipient(meetingId, transferId, actorId);
    const meeting = scope && await tx.lockActiveMeeting(meetingId, scope.groupId);
    if (!meeting) throw meetingError('ORGANIZER_TRANSFER_NOT_FOUND');
    return meeting;
  }

  private requireBeforeStart(meeting: Meeting): Date {
    const now = this.clock();
    if (meeting.starts_at <= now) throw meetingError('MEETING_STARTED');
    return now;
  }
}
