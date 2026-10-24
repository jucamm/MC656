import type { RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import type { MockUser } from '../../mocks/mock-users';

/** Vínculos fornecidos pelo servidor enquanto o módulo de grupos usa fixtures.
 * Nunca deriva identidade, grupo ou papel de headers/corpo enviados pelo cliente.
 */
export function bindGroupIdentity(groupUsers: readonly MockUser[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth || !request.account) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    request.user = groupUsers.find(user => user.id === request.auth!.user_id) ?? {
      id: request.auth.user_id, name: request.account.name, memberships: [],
    };
    next();
  };
}
