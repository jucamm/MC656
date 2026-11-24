import { mockGroups } from '../../../mocks/mock-groups';
import { mockUsers, type MockUser } from '../../../mocks/mock-users';
import { DecisionProcessServiceError } from '../decision-process.errors';
import { requireDecisionProcessRole, type DecisionProcessGroupAccess } from '../decision-process.group-access';

export function fixtureDecisionProcessGroupAccess(users: readonly MockUser[] = mockUsers): DecisionProcessGroupAccess {
  function checkRole(groupId: string, userId: string, role: 'ADMIN' | 'MEMBER') {
    if (!mockGroups.some(group => group.id === groupId)) {
      throw new DecisionProcessServiceError('GROUP_NOT_FOUND', 'Grupo não encontrado.');
    }
    const user = users.find(candidate => candidate.id === userId);
    if (!user) throw new DecisionProcessServiceError('UNAUTHENTICATED', 'Usuário mockado não encontrado.');
    requireDecisionProcessRole(user.memberships.find(membership => membership.groupId === groupId)?.role ?? null, role);
  }

  return {
    async requireMember(groupId, userId) {
      checkRole(groupId, userId, 'MEMBER');
      return groupId;
    },
    async withAdministrator(groupId, userId, operation) {
      checkRole(groupId, userId, 'ADMIN');
      return operation({
        groupId,
        async findMemberIds(userIds) {
          return new Set(users.filter(user => userIds.includes(user.id) &&
            user.memberships.some(membership => membership.groupId === groupId)).map(user => user.id));
        },
      });
    },
  };
}
