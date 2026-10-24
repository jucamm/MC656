import { Router, type RequestHandler } from 'express';

import {
  requireGroupAdministratorMiddleware,
  requireGroupMemberMiddleware,
} from '../../middlewares/authorization.middleware';
import type { DecisionProcessController } from './decision-process.controller';

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
