import type { NextFunction, Request, Response } from 'express';

import { DomainError } from '../errors/domain.error';
import { mockGroups } from '../mocks/mock-groups';
import { MockGroupRole } from '../mocks/mock-users';

function authorizeGroupAccess(
  request: Request,
  next: NextFunction,
  administratorRequired: boolean,
): void {
  const groupId = request.params.groupId;
  const groupExists = mockGroups.some((group) => group.id === groupId);

  if (!groupExists) {
    next(new DomainError('GROUP_NOT_FOUND', 'Grupo não encontrado.'));
    return;
  }

  if (!request.user) {
    next(
      new DomainError(
        'UNAUTHENTICATED',
        'Usuário mockado não encontrado.',
      ),
    );
    return;
  }

  const membership = request.user.memberships.find(
    (candidate) => candidate.groupId === groupId,
  );
  const isAuthorized = administratorRequired
    ? membership?.role === MockGroupRole.ADMIN
    : membership !== undefined;

  if (!isAuthorized) {
    next(
      new DomainError(
        'FORBIDDEN',
        administratorRequired
          ? 'O usuário não é administrador deste grupo.'
          : 'O usuário não pertence a este grupo.',
      ),
    );
    return;
  }

  next();
}

export function requireGroupAdministratorMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  authorizeGroupAccess(request, next, true);
}

export function requireGroupMemberMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  authorizeGroupAccess(request, next, false);
}
