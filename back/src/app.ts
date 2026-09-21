import express, { type Express } from 'express';

import { errorHandlerMiddleware } from './middlewares/error-handler.middleware';
import { DecisionProcessController } from './modules/decision-process/decision-process.controller';
import { createDecisionProcessRouter } from './modules/decision-process/decision-process.routes';
import { DecisionProcessService } from './modules/decision-process/decision-process.service';
import { InMemoryDecisionProcessRepository } from './modules/decision-process/repositories/in-memory-decision-process.repository';
import type { DecisionProcessRepository } from './modules/decision-process/repositories/decision-process.repository';

export function createApp(
  repository: DecisionProcessRepository =
    new InMemoryDecisionProcessRepository(),
): Express {
  const application = express();
  const service = new DecisionProcessService(repository);
  const controller = new DecisionProcessController(service);

  application.use(express.json());
  application.use(createDecisionProcessRouter(controller));
  application.use(errorHandlerMiddleware);

  return application;
}

export const app = createApp();
