import { Router, type RequestHandler } from 'express';

import {
  requireGroupAdministratorMiddleware,
  requireGroupMemberMiddleware,
} from '../../middlewares/authorization.middleware';
import type { DecisionProcessController } from './decision-process.controller';

/**
 * Monta endpoints de grupos recebendo explicitamente a política de identidade.
 * @param {DecisionProcessController} controller - Handlers homologados de processos decisórios.
 * @param {RequestHandler} authenticate - Na aplicação real, vincula permissões ao ID já autenticado;
 * em testes isolados, pode receber fixtures explícitas do módulo.
 * @returns {Router} Rotas com checagem de associação/papel além do gate global da aplicação.
 * @remarks Não escolhe uma identidade a partir de header por conta própria.
 */
export function createDecisionProcessRouter(
  controller: DecisionProcessController,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate);
  router.post(
    '/groups/:groupId/decision-processes',
    requireGroupAdministratorMiddleware,
    controller.createProcess,
  );
  router.post(
    '/groups/:groupId/decision-processes/:processId/versions',
    requireGroupAdministratorMiddleware,
    controller.createVersion,
  );
  router.put(
    '/groups/:groupId/decision-processes/:processId',
    requireGroupAdministratorMiddleware,
    controller.reconfigureProcess,
  );
  router.get(
    '/groups/:groupId/decision-processes/:processId',
    requireGroupMemberMiddleware,
    controller.getProcess,
  );
  router.get(
    '/groups/:groupId/decision-processes/:processId/versions',
    requireGroupMemberMiddleware,
    controller.listVersions,
  );

  return router;
}
