import type { ErrorRequestHandler } from 'express';

import { DomainError } from '../errors/domain.error';

const statusByDomainErrorCode: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  GROUP_NOT_FOUND: 404,
  PROCESS_NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
};

export const errorHandlerMiddleware: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof DomainError) {
    const statusCode = statusByDomainErrorCode[error.code];
    if (statusCode) {
      response.status(statusCode).json({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
      return;
    }
  }

  if (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400
  ) {
    response.status(400).json({
      error: 'INVALID_JSON',
      message: 'O corpo da requisição contém JSON inválido.',
    });
    return;
  }

  response.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'Ocorreu um erro interno no servidor.',
  });
};
