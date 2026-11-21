import { invalidField } from '../identity/validators/registration.validator';
import {
  requireActiveGroupAccess, requireActiveGroupMember, requireGroupAdministrator,
  withActiveGroupAccess, withExistingGroup,
} from './group-access';
import { groupError } from './groups.errors';
import type { GroupsRepository, GroupTransaction } from './groups.repository';
import {
  toGroupDto, toMemberDto, toPageDto,
  type GroupDto, type GroupListState, type GroupRole, type MemberDto, type PageDto, type PageInput,
} from './groups.types';

function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > 150 || trimmed.includes('\0')) {
    invalidField('name', 'Informe um nome de grupo de até 150 caracteres.');
  }
  return trimmed;
}

async function requireOtherAdministrator(tx: GroupTransaction, userId: bigint): Promise<void> {
  if (!await tx.hasOtherVerifiedAdministrator(userId)) throw groupError('LAST_GROUP_ADMIN');
}

/** O ator vem do gate de conta verificada da aplicação. */
export class GroupsService {
  constructor(private readonly repository: GroupsRepository, private readonly clock: () => Date = () => new Date()) {}

  async createGroup(actorId: bigint, name: string): Promise<GroupDto> {
    const group = await this.repository.createGroupWithAdministrator(normalizeName(name), actorId, this.clock());
    return toGroupDto(group, 'ADMIN');
  }

  async listGroups(actorId: bigint, state: GroupListState, page: PageInput<string>): Promise<PageDto<GroupDto>> {
    const rows = await this.repository.listGroupsForMember(actorId, state, page, this.clock());
    return toPageDto(rows, row => toGroupDto(row.group, row.role, row.recoverableUntil));
  }

  async getGroup(groupId: string, actorId: bigint): Promise<GroupDto> {
    const { group, role } = await requireActiveGroupAccess(this.repository, groupId, actorId);
    return toGroupDto(group, role);
  }

  async renameGroup(groupId: string, actorId: bigint, name: string): Promise<GroupDto> {
    return withActiveGroupAccess(this.repository, groupId, actorId, 'ADMIN', async tx => {
      const normalized = normalizeName(name);
      const group = tx.group.name === normalized ? tx.group : await tx.rename(normalized, this.clock());
      return toGroupDto(group, 'ADMIN');
    });
  }

  async deleteGroup(groupId: string, actorId: bigint): Promise<void> {
    return withExistingGroup(this.repository, groupId, async tx => {
      await this.requireLifecycleAdministrator(tx, actorId);
      if (tx.group.deleted_at) return;
      const now = this.clock();
      await tx.markDeleted('ADMIN_DELETION', now);
      await tx.cancelPendingInvitations(now);
    });
  }

  async restoreGroup(groupId: string, actorId: bigint): Promise<GroupDto> {
    return withExistingGroup(this.repository, groupId, async tx => {
      await this.requireLifecycleAdministrator(tx, actorId);
      if (!tx.group.deleted_at) return toGroupDto(tx.group, 'ADMIN');

      const deadline = tx.recoverableUntil;
      if (!deadline) throw groupError('GROUP_NOT_FOUND');
      const now = this.clock();
      if (now > deadline) throw groupError('RECOVERY_WINDOW_EXPIRED');
      return toGroupDto(await tx.restore(now), 'ADMIN');
    });
  }

  private async requireLifecycleAdministrator(tx: GroupTransaction, actorId: bigint): Promise<void> {
    const actor = await tx.findMembership(actorId);
    if (!actor || (tx.group.deleted_at && actor.role !== 'ADMIN')) throw groupError('GROUP_NOT_FOUND');
    requireGroupAdministrator(actor.role);
  }

  async listMembers(groupId: string, actorId: bigint, page: PageInput<bigint>): Promise<PageDto<MemberDto>> {
    await requireActiveGroupAccess(this.repository, groupId, actorId);
    const rows = await this.repository.listActiveMembersForMember(groupId, actorId, page);
    return toPageDto(rows, toMemberDto);
  }

  async getMember(groupId: string, actorId: bigint, userId: bigint): Promise<MemberDto> {
    await requireActiveGroupAccess(this.repository, groupId, actorId);
    const member = await this.repository.findActiveMemberForMember(groupId, actorId, userId);
    if (!member) throw groupError('MEMBERSHIP_NOT_FOUND');
    return toMemberDto(member);
  }

  async changeMemberRole(groupId: string, actorId: bigint, userId: bigint, role: GroupRole): Promise<MemberDto> {
    return withActiveGroupAccess(this.repository, groupId, actorId, 'ADMIN', async tx => {
      const member = await tx.findMembership(userId);
      if (!member) throw groupError('MEMBERSHIP_NOT_FOUND');
      if (member.role === role) return toMemberDto(member);
      if (member.role === 'ADMIN') await requireOtherAdministrator(tx, userId);
      const updated = await tx.setMemberRole(userId, role);
      if (!updated) throw groupError('MEMBERSHIP_NOT_FOUND');
      return toMemberDto({ ...updated, name: member.name });
    });
  }

  async removeMember(groupId: string, actorId: bigint, userId: bigint): Promise<void> {
    return withExistingGroup(this.repository, groupId, async tx => {
      const actor = await requireActiveGroupMember(tx, actorId);
      const isLeaving = actorId === userId;
      if (!isLeaving) requireGroupAdministrator(actor.role);
      const member = isLeaving ? actor : await tx.findMembership(userId);
      if (!member) throw groupError('MEMBERSHIP_NOT_FOUND');

      if (isLeaving && member.role === 'ADMIN' && !await tx.hasOtherMembers(userId)) {
        const now = this.clock();
        await tx.removeMember(userId);
        await tx.markDeleted('LAST_MEMBER_LEFT', now);
        await tx.cancelPendingInvitations(now);
        return;
      }
      if (member.role === 'ADMIN') await requireOtherAdministrator(tx, userId);
      await tx.removeMember(userId);
    });
  }
}
