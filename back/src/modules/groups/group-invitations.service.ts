import { normalizeEmail } from '../identity/validators/registration.validator';
import { requireActiveGroupAccess, requireGroupAdministrator, withActiveGroupAccess } from './group-access';
import { groupError } from './groups.errors';
import type { GroupsRepository, GroupTransaction } from './groups.repository';
import {
  toAdminInvitationDto, toGroupDto, toPageDto, toRecipientInvitationDto,
  type AcceptedInvitationDto, type AdminInvitationDto, type PageDto, type PageInput, type RecipientInvitationDto,
} from './groups.types';

function requirePendingInvitation(invitation: Awaited<ReturnType<GroupTransaction['findInvitation']>>) {
  if (!invitation) throw groupError('INVITATION_NOT_FOUND');
  if (invitation.status !== 'PENDING') throw groupError('INVITATION_RESOLVED');
  return invitation;
}

/** A conta verificada vem da sessão, inclusive ao resolver um convite recebido. */
export class GroupInvitationsService {
  constructor(private readonly repository: GroupsRepository, private readonly clock: () => Date = () => new Date()) {}

  async invite(groupId: string, actorId: bigint, email: string): Promise<AdminInvitationDto> {
    return withActiveGroupAccess(this.repository, groupId, actorId, 'ADMIN', async tx => {
      const invitee = await tx.findInviteeByEmail(normalizeEmail(email));
      if (!invitee) throw groupError('USER_NOT_ELIGIBLE');
      if (await tx.findMembership(invitee.id)) throw groupError('MEMBERSHIP_ALREADY_EXISTS');
      if (await tx.findPendingInvitation(invitee.id)) throw groupError('INVITATION_ALREADY_PENDING');
      const invitation = await tx.createInvitation(invitee.id, actorId, this.clock());
      return toAdminInvitationDto({ ...invitation, group_name: tx.group.name, invited_user_name: invitee.name });
    });
  }

  async listForGroup(groupId: string, actorId: bigint, page: PageInput<string>): Promise<PageDto<AdminInvitationDto>> {
    const { role } = await requireActiveGroupAccess(this.repository, groupId, actorId);
    requireGroupAdministrator(role);
    const rows = await this.repository.listPendingInvitationsForAdmin(groupId, actorId, page);
    return toPageDto(rows, toAdminInvitationDto);
  }

  async listReceived(actorId: bigint, page: PageInput<string>): Promise<PageDto<RecipientInvitationDto>> {
    return toPageDto(await this.repository.listPendingInvitationsForRecipient(actorId, page), toRecipientInvitationDto);
  }

  async cancel(groupId: string, actorId: bigint, invitationId: string): Promise<void> {
    return withActiveGroupAccess(this.repository, groupId, actorId, 'ADMIN', async tx => {
      requirePendingInvitation(await tx.findInvitation(invitationId));
      if (!await tx.resolveInvitation(invitationId, 'CANCELLED', this.clock())) throw groupError('INVITATION_RESOLVED');
    });
  }

  async accept(invitationId: string, actorId: bigint): Promise<AcceptedInvitationDto> {
    return this.withReceivedInvitation(invitationId, actorId, async (tx, invitation) => {
      if (await tx.findMembership(actorId)) throw groupError('MEMBERSHIP_ALREADY_EXISTS');
      const now = this.clock();
      const resolved = await tx.resolveInvitation(invitation.id, 'ACCEPTED', now);
      if (!resolved) throw groupError('INVITATION_RESOLVED');
      const member = await tx.addMember(actorId, now);
      return {
        invitation: toRecipientInvitationDto({ ...resolved, group_name: tx.group.name,
          invited_by_user_name: invitation.invited_by_user_name }),
        group: toGroupDto(tx.group, member.role),
      };
    });
  }

  async decline(invitationId: string, actorId: bigint): Promise<void> {
    return this.withReceivedInvitation(invitationId, actorId, async tx => {
      if (!await tx.resolveInvitation(invitationId, 'DECLINED', this.clock())) throw groupError('INVITATION_RESOLVED');
    });
  }

  private async withReceivedInvitation<Result>(invitationId: string, actorId: bigint,
    operation: (tx: GroupTransaction, invitation: ReturnType<typeof requirePendingInvitation>) => Promise<Result>): Promise<Result> {
    const groupId = await this.repository.findInvitationGroupForRecipient(invitationId, actorId);
    if (!groupId) throw groupError('INVITATION_NOT_FOUND');
    const locked = await this.repository.withGroupLock(groupId, async tx => {
      if (tx.group.deleted_at) throw groupError('INVITATION_NOT_FOUND');
      const invitation = await tx.findInvitation(invitationId);
      if (invitation?.invited_user_id !== actorId) throw groupError('INVITATION_NOT_FOUND');
      return { result: await operation(tx, requirePendingInvitation(invitation)) };
    });
    if (!locked) throw groupError('INVITATION_NOT_FOUND');
    return locked.result;
  }
}
