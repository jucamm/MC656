import express, { Router } from 'express';
import { IdentitySessionController, IdentityVerificationController, type IdentityOnboardingServices } from './identity.controller';
import { identityErrorHandler, requireAuthentication } from './session.middleware';
import type { SessionService } from './session.service';

/** Matriz dos seis contratos de identidade.
 * Todos os recursos fora do onboarding exigirão conta verified (Issue 8).
 */
/**
 * Matriz compartilhada de acesso e sucesso dos seis endpoints de identidade.
 * @remarks Todos aceitam pending quando exigem sessão; a ordem telefone/e-mail continua no serviço.
 */
export const identityRoutes = [
  { method: 'POST', path: '/auth/register', authentication: false, verified_account: false, success_status: 201 },
  { method: 'POST', path: '/auth/login', authentication: false, verified_account: false, success_status: 200 },
  { method: 'POST', path: '/auth/logout', authentication: true, verified_account: false, success_status: 204 },
  { method: 'GET', path: '/auth/me', authentication: true, verified_account: false, success_status: 200 },
  { method: 'POST', path: '/auth/verifications/:channel/send', authentication: true, verified_account: false, success_status: 200 },
  { method: 'POST', path: '/auth/verifications/:channel/confirm', authentication: true, verified_account: false, success_status: 200 },
] as const;

/** Montado em /auth; onboarding exige a composição dos serviços correspondentes. */
/**
 * Monta o onboarding antes do gate global de conta verificada.
 * @param {SessionService} sessions - Dependência obrigatória de login/me/logout.
 * @param {IdentityOnboardingServices | undefined} onboarding - Cadastro e verificação opcionais na composição isolada de testes.
 * @returns {Router} Router relativo a /auth, com parsing e erros específicos de identidade.
 * @remarks no-store evita cache do token/estado; logout 204 mantém corpo vazio.
 */
export function createIdentityRouter(sessions: SessionService, onboarding?: IdentityOnboardingServices): Router {
  const router = Router();
  const controller = new IdentitySessionController(sessions);
  const authenticate = requireAuthentication(sessions);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  // Parsing dentro do router permite que JSON inválido também use o envelope
  // de identidade, sem alterar o contrato de erros dos módulos de negócio.
  router.use(express.json());
  router.post('/login', controller.login);
  router.post('/logout', authenticate, controller.logout);
  router.get('/me', authenticate, controller.me);
  if (onboarding) {
    const verification = new IdentityVerificationController(onboarding);
    router.post('/register', verification.register);
    router.post('/verifications/:channel/send', authenticate, verification.send);
    router.post('/verifications/:channel/confirm', authenticate, verification.confirm);
  }
  router.use(identityErrorHandler);
  return router;
}
