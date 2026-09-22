import { Router } from 'express';

import { mockAuthenticationMiddleware } from '../../middlewares/authentication.middleware';
import {
  requireGroupAdministratorMiddleware,
  requireGroupMemberMiddleware,
} from '../../middlewares/authorization.middleware';
import type { DecisionProcessController } from './decision-process.controller';

export function createDecisionProcessRouter(
  controller: DecisionProcessController,
): Router {
  const router = Router();

  router.use(mockAuthenticationMiddleware);
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
