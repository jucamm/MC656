import type { NextFunction, Request, Response } from 'express';

import { mockUsers, type MockUser } from '../mocks/mock-users';

declare global {
  namespace Express {
    interface Request {
      user?: MockUser;
    }
  }
}

export const MOCK_USER_HEADER = 'X-Mock-User-Id';

/** Autenticação temporária. Este middleware não deve ser usado na main da aplicação. */
export function mockAuthenticationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const userId = request.header(MOCK_USER_HEADER);
  const user = mockUsers.find((user) => user.id === userId);

  if (!user) {
    response.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Usuário mockado não encontrado.',
    });
    return;
  }

  request.user = user;
  next();
}

export const mockAuthMiddleware = mockAuthenticationMiddleware;
