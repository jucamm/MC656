import type { RequestHandler, ErrorRequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { identityErrorStatus, type IdentityErrorCode } from './identity.errors';
import type { AuthIdentity, UserDto } from './identity.types';
import type { SessionService } from './session.service';

declare module 'express-serve-static-core' {
  interface Request { auth?: AuthIdentity; account?: UserDto }
}

export function requireAuthentication(sessions: SessionService): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization) : null;
    if (!match) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const authenticated = await sessions.authenticate(match[1]);
    request.auth = authenticated.identity;
    request.account = authenticated.user;
    next();
  };
}

/** Deve seguir requireAuthentication, que carrega a conta do banco a cada uso. */
export const requireVerifiedAccount: RequestHandler = (request, _response, next) => {
  if (!request.auth || !request.account) {
    throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  }
  if (request.account.status !== 'verified') {
    throw new DomainError('ACCOUNT_NOT_VERIFIED', 'Confirme e-mail e telefone para acessar este recurso.', {});
  }
  next();
};

export const identityErrorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof DomainError && Object.hasOwn(identityErrorStatus, error.code)) {
    if ((error.code === 'VERIFICATION_RATE_LIMITED' || error.code === 'VERIFICATION_DELIVERY_BLOCKED') &&
        typeof error.details === 'object' && error.details !== null &&
        'retry_after_seconds' in error.details && typeof error.details.retry_after_seconds === 'number' &&
        Number.isInteger(error.details.retry_after_seconds) && error.details.retry_after_seconds > 0) {
      response.set('Retry-After', String(error.details.retry_after_seconds));
    }
    response.status(identityErrorStatus[error.code as IdentityErrorCode]).json({
      error: { code: error.code, message: error.message, details: error.details ?? {} },
    });
    return;
  }
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'O corpo da requisição contém JSON inválido.', details: {} } });
    return;
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ocorreu um erro interno no servidor.', details: {} } });
};
