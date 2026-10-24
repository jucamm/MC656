import type { RequestHandler, ErrorRequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import { identityErrorStatus, type IdentityErrorCode } from './identity.errors';
import type { AuthIdentity, UserDto } from './identity.types';
import type { SessionService } from './session.service';

declare module 'express-serve-static-core' {
  interface Request { auth?: AuthIdentity; account?: UserDto }
}

/**
 * Extrai a credencial explícita e atualiza o contexto confiável da requisição.
 * @param {SessionService} sessions - Resolve, valida e renova sessões persistidas.
 * @returns {RequestHandler} Middleware assíncrono para Express 5.
 * @throws {DomainError} UNAUTHENTICATED para header ausente/malformado; erros de sessão vêm do serviço.
 */
export function requireAuthentication(sessions: SessionService): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.headers.authorization;
    // Esquema Bearer é case-insensitive; o token mantém o case original.
    // A regex aceita somente um token base64url de 43 caracteres, sem sufixos
    // ou múltiplas credenciais. Cookies/query/body nunca são consultados.
    const match = typeof authorization === 'string' ? /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization) : null;
    if (!match) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const authenticated = await sessions.authenticate(match[1]);
    request.auth = authenticated.identity;
    request.account = authenticated.user;
    next();
  };
}

/** Deve seguir requireAuthentication, que carrega a conta do banco a cada uso. */
/**
 * Autoriza recursos de negócio usando o estado atual carregado nesta requisição.
 * @param {Request} request - Deve conter auth e account preenchidos pelo middleware anterior.
 * @param {Response} _response - Resposta delegada ao próximo handler/error handler.
 * @param {NextFunction} next - Continua apenas quando a conta estiver verified.
 * @returns {void} Não concede autorização de associação/papel de grupo.
 * @throws {DomainError} UNAUTHENTICATED sem contexto; ACCOUNT_NOT_VERIFIED para pending.
 */
export const requireVerifiedAccount: RequestHandler = (request, _response, next) => {
  if (!request.auth || !request.account) {
    throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  }
  if (request.account.status !== 'verified') {
    throw new DomainError('ACCOUNT_NOT_VERIFIED', 'Confirme e-mail e telefone para acessar este recurso.', {});
  }
  next();
};

/**
 * Converte erros de identidade em HTTP sem expor detalhes técnicos inesperados.
 * @param {unknown} error - Erro recebido da cadeia do Express.
 * @param {Request} _request - Requisição que originou a falha.
 * @param {Response} response - Recebe código HTTP, envelope e Retry-After quando aplicável.
 * @param {NextFunction} _next - Não utilizado: o middleware finaliza a resposta.
 * @returns {void} Erros não reconhecidos produzem INTERNAL_ERROR genérico.
 * @remarks O catálogo limita os erros públicos; JSON malformado usa VALIDATION_ERROR.
 */
export const identityErrorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof DomainError && Object.hasOwn(identityErrorStatus, error.code)) {
    // Só converte cooldowns tipados, inteiros e positivos em header HTTP.
    // A validação impede serializar detalhes arbitrários como valor de Retry-After.
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
