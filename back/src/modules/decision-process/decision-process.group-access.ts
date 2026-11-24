import type { GroupsRepository } from '../groups/groups.repository';
import type { GroupRole } from '../groups/groups.types';
import { isUuid, parseUserId } from '../groups/groups.validator';
import { DecisionProcessServiceError } from './decision-process.errors';

export interface DecisionProcessGroupScope {
  groupId: string;
  findMemberIds(userIds: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface DecisionProcessGroupAccess {
  requireMember(groupId: string, userId: string): Promise<string>;
  withAdministrator<Result>(groupId: string, userId: string,
    operation: (scope: DecisionProcessGroupScope) => Promise<Result>): Promise<Result>;
}

function groupUnavailable() {
  return new DecisionProcessServiceError('GROUP_NOT_FOUND', 'Grupo não encontrado.');
}

export function requireDecisionProcessRole(role: GroupRole | null, required: GroupRole): void {
  if (required === 'ADMIN' && role !== 'ADMIN') {
    throw new DecisionProcessServiceError('FORBIDDEN', 'O usuário não é administrador deste grupo.');
  }
  if (!role) throw new DecisionProcessServiceError('FORBIDDEN', 'O usuário não pertence a este grupo.');
}

function parseActor(groupId: string, userId: string): bigint {
  if (!isUuid(groupId)) throw groupUnavailable();
  const actorId = parseUserId(userId);
  if (actorId === null) throw new DecisionProcessServiceError('UNAUTHENTICATED', 'Autenticação necessária.');
  return actorId;
}

export class PersistedDecisionProcessGroupAccess implements DecisionProcessGroupAccess {
  constructor(private readonly groups: Pick<GroupsRepository, 'findActiveGroupRole' | 'withGroupLock'>) {}

  async requireMember(groupId: string, userId: string): Promise<string> {
    const actorId = parseActor(groupId, userId);
    const access = await this.groups.findActiveGroupRole(groupId, actorId);
    if (!access) throw groupUnavailable();
    requireDecisionProcessRole(access.role, 'MEMBER');
    return access.groupId;
  }

  async withAdministrator<Result>(groupId: string, userId: string,
    operation: (scope: DecisionProcessGroupScope) => Promise<Result>): Promise<Result> {
    const actorId = parseActor(groupId, userId);
    const locked = await this.groups.withGroupLock(groupId, async tx => {
      if (tx.group.deleted_at) throw groupUnavailable();
      const actor = await tx.findMembership(actorId);
      requireDecisionProcessRole(actor?.role ?? null, 'ADMIN');
      const result = await operation({
        groupId: tx.group.id,
        async findMemberIds(userIds) {
          const ids = userIds.map(parseUserId).filter(id => id !== null);
          return new Set((await tx.findMemberIds(ids)).map(id => id.toString()));
        },
      });
      return { result };
    });
    if (!locked) throw groupUnavailable();
    return locked.result;
  }
}
