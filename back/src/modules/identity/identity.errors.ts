/** Catálogo HTTP do módulo; não altera os contratos dos módulos existentes. */
/**
 * Mapeia decisões de domínio para HTTP sem misturar erros dos módulos legados.
 * @remarks 401 distingue sessão inválida; 403 distingue autorização/origem recusada.
 * Mensagens e details são definidos na origem do erro e serializados pelo middleware.
 */
export const identityErrorStatus = {
  VALIDATION_ERROR: 400,
  INVALID_VERIFICATION_CODE: 400,
  VERIFICATION_CODE_EXPIRED: 400,
  VERIFICATION_CODE_REVOKED: 400,
  VERIFICATION_CODE_CONSUMED: 400,
  VERIFICATION_ATTEMPTS_EXCEEDED: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  ACCOUNT_NOT_VERIFIED: 403,
  CORS_NOT_ALLOWED: 403,
  EMAIL_VERIFICATION_REQUIRED: 403,
  EMAIL_ALREADY_REGISTERED: 409,
  CHANNEL_ALREADY_VERIFIED: 409,
  VERIFICATION_RATE_LIMITED: 429,
  VERIFICATION_DELIVERY_BLOCKED: 429,
  VERIFICATION_DELIVERY_FAILED: 503,
  INTERNAL_ERROR: 500,
} as const;
/**
 * União derivada das chaves do catálogo, evitando um segundo conjunto de códigos divergente.
 */
export type IdentityErrorCode = keyof typeof identityErrorStatus;
