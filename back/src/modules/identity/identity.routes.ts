import express, { Router } from 'express';
import { IdentitySessionController } from './identity.controller';
import { identityErrorHandler, requireAuthentication } from './session.middleware';
import type { SessionService } from './session.service';

/** Matriz dos seis contratos; login, logout e me já possuem handlers.
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

/** Montado em /auth. Os demais contratos serão implementados nas próximas issues. */
export function createIdentityRouter(sessions: SessionService): Router {
  const router = Router();
  const controller = new IdentitySessionController(sessions);
  const authenticate = requireAuthentication(sessions);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json());
  router.post('/login', controller.login);
  router.post('/logout', authenticate, controller.logout);
  router.get('/me', authenticate, controller.me);
  router.use(identityErrorHandler);
  return router;
}
