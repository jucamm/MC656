import { groupError } from './groups.errors';
import type { GroupsRepository, GroupTransaction } from './groups.repository';
import type { GroupRole } from './groups.types';

export function requireGroupAdministrator(role: GroupRole): void {
  if (role !== 'ADMIN') throw groupError('FORBIDDEN');
}

export async function requireActiveGroupMember(tx: GroupTransaction, userId: bigint) {
  if (tx.group.deleted_at) throw groupError('GROUP_NOT_FOUND');
  const membership = await tx.findMembership(userId);
  if (!membership) throw groupError('GROUP_NOT_FOUND');
  return membership;
}

export async function requireActiveGroupAccess(repository: GroupsRepository, groupId: string, userId: bigint) {
  const access = await repository.findActiveGroupForMember(groupId, userId);
  if (!access) throw groupError('GROUP_NOT_FOUND');
  return access;
}

export async function withExistingGroup<Result>(repository: GroupsRepository, groupId: string,
  operation: (tx: GroupTransaction) => Promise<Result>): Promise<Result> {
  const locked = await repository.withGroupLock(groupId, async tx => ({ result: await operation(tx) }));
  if (!locked) throw groupError('GROUP_NOT_FOUND');
  return locked.result;
}

export function withActiveGroupAccess<Result>(repository: GroupsRepository, groupId: string, userId: bigint,
  requiredRole: GroupRole, operation: (tx: GroupTransaction) => Promise<Result>): Promise<Result> {
  return withExistingGroup(repository, groupId, async tx => {
    const actor = await requireActiveGroupMember(tx, userId);
    if (requiredRole === 'ADMIN') requireGroupAdministrator(actor.role);
    return operation(tx);
  });
}
