import express from 'express';
import { mockAuthenticationMiddleware } from '../../../middlewares/authentication.middleware';
import { errorHandlerMiddleware } from '../../../middlewares/error-handler.middleware';
import { DecisionProcessController } from '../decision-process.controller';
import { createDecisionProcessRouter } from '../decision-process.routes';
import { DecisionProcessService } from '../decision-process.service';
import type { DecisionProcessRepository } from '../repositories/decision-process.repository';
import { InMemoryDecisionProcessRepository } from '../repositories/in-memory-decision-process.repository';

/** App isolado do módulo: fixtures de grupo não substituem a autenticação global. */
export function createApp(repository: DecisionProcessRepository = new InMemoryDecisionProcessRepository()) {
  const app = express();
  app.use(express.json());
  app.use(createDecisionProcessRouter(new DecisionProcessController(new DecisionProcessService(repository)), mockAuthenticationMiddleware));
  app.use(errorHandlerMiddleware);
  return app;
}
