/** Matriz de contratos; registrar handlers somente nas issues de implementação.
 * Todos os recursos fora do onboarding exigirão conta verified (Issue 8).
 */
export const identityRoutes = [
  { method: 'POST', path: '/auth/register', authentication: false, verified_account: false, success_status: 201 },
  { method: 'POST', path: '/auth/login', authentication: false, verified_account: false, success_status: 200 },
  { method: 'POST', path: '/auth/logout', authentication: true, verified_account: false, success_status: 204 },
  { method: 'GET', path: '/auth/me', authentication: true, verified_account: false, success_status: 200 },
  { method: 'POST', path: '/auth/verifications/:channel/send', authentication: true, verified_account: false, success_status: 200 },
  { method: 'POST', path: '/auth/verifications/:channel/confirm', authentication: true, verified_account: false, success_status: 200 },
] as const;
