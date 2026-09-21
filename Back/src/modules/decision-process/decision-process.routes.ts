import { Router } from 'express';

import { mockAuthenticationMiddleware } from '../../middlewares/authentication.middleware';
import type { DecisionProcessController } from './decision-process.controller';

export function createDecisionProcessRouter(
  controller: DecisionProcessController,
): Router {
  const router = Router();

  router.use(mockAuthenticationMiddleware);
  router.post('/groups/:groupId/decision-processes', controller.createProcess);
  router.post(
    '/groups/:groupId/decision-processes/:processId/versions',
    controller.createVersion,
  );
  router.put(
    '/groups/:groupId/decision-processes/:processId',
    controller.reconfigureProcess,
  );
  router.get(
    '/groups/:groupId/decision-processes/:processId',
    controller.getProcess,
  );
  router.get(
    '/groups/:groupId/decision-processes/:processId/versions',
    controller.listVersions,
  );

  return router;
}
