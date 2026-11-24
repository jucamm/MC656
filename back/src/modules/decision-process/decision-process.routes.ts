import { Router } from 'express';

import type { DecisionProcessController } from './decision-process.controller';

/** A sessão é resolvida pelo gate da aplicação, e o serviço autoriza cada operação no grupo. */
export function createDecisionProcessRouter(controller: DecisionProcessController): Router {
  const router = Router();
  router.post('/groups/:groupId/decision-processes', controller.createProcess);
  router.post('/groups/:groupId/decision-processes/:processId/versions', controller.createVersion);
  router.put('/groups/:groupId/decision-processes/:processId', controller.reconfigureProcess);
  router.get('/groups/:groupId/decision-processes/:processId', controller.getProcess);
  router.get('/groups/:groupId/decision-processes/:processId/versions', controller.listVersions);
  return router;
}
