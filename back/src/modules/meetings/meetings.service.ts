import { randomUUID } from 'node:crypto';
import { requireActiveGroupMember, requireGroupAdministrator } from '../groups/group-access';
import type { PageDto, PageInput } from '../groups/groups.types';
import { invalidField } from '../identity/validators/registration.validator';
import { meetingError } from './meetings.errors';
import type { PostgresMeetingsRepository } from './meetings.repository';
import type { CreateMeetingInput, InvitationDecision, MeetingDto, MeetingInvitationDto, Participant } from './meetings.types';

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

      const now = this.clock();
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
        id: meetingId, subject: input.subject, starts_at: input.startsAt, group_id: input.groupId,
        access_mode: input.accessMode, created_by_user_id: actor.id, organizer_user_id: actor.id, created_at: now,
      }, participants);
    });
    return {
      id: meeting.id, subject: meeting.subject, starts_at: meeting.starts_at.toISOString(),
      visibility: meeting.access_mode === 'public' ? 'public' : 'private',
      organizer_name: actor.name, actions: { can_manage: true },
    };
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
      if (availability.groupId) {
        const group = await tx.lockGroup(availability.groupId);
        if (!group || group.group.deleted_at) throw meetingError('MEETING_INVITATION_NOT_FOUND');
      }
      const meeting = await tx.lockMeeting(meetingId);
      if (!meeting) throw meetingError('MEETING_INVITATION_NOT_FOUND');

      const now = this.clock();
      const resolvedAt = now < meeting.createdAt ? meeting.createdAt : now;
      if (!await tx.resolveInvitation(meetingId, actorId, decision, resolvedAt)) {
        throw meetingError('MEETING_INVITATION_RESOLVED');
      }
    });
  }
}
