import type { ErrorRequestHandler } from 'express';

import { DecisionProcessServiceError } from '../modules/decision-process/decision-process.service';

export const errorHandlerMiddleware: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof DecisionProcessServiceError) {
    response.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
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
