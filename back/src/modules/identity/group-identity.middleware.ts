import type { RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import type { MockUser } from '../../mocks/mock-users';

/** Vínculos fornecidos pelo servidor enquanto o módulo de grupos usa fixtures.
 * Nunca deriva identidade, grupo ou papel de headers/corpo enviados pelo cliente.
 */
/**
 * Associa permissões de grupo ao ID real após autenticação e verificação da conta.
 * @param {readonly MockUser[]} groupUsers - Vínculos definidos na composição do servidor.
 * @returns {RequestHandler} Preenche request.user para os controllers legados de grupos.
 * @throws {DomainError} UNAUTHENTICATED se for usado sem os middlewares obrigatórios.
 * @remarks Ausência de vínculo produz memberships vazio, sem conceder papel pelo header do cliente.
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
