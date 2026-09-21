import type { NextFunction, Request, Response } from 'express';

import { DomainError } from '../errors/domain.error';
import { mockUsers, type MockUser } from '../mocks/mock-users';

declare module 'express-serve-static-core' {
  interface Request {
    user?: MockUser;
  }
}

export const MOCK_USER_HEADER = 'X-Mock-User-Id';

/** Autenticação temporária. Este middleware não deve ser usado em produção. */
export function mockAuthenticationMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const userId = request.header(MOCK_USER_HEADER);
  const user = mockUsers.find((user) => user.id === userId);

  if (!user) {
    next(
      new DomainError(
        'UNAUTHENTICATED',
        'Usuário mockado não encontrado.',
      ),
    );
    return;
  }

  request.user = user;
  next();
}

export const mockAuthMiddleware = mockAuthenticationMiddleware;
