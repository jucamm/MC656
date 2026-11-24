import express from 'express';
import { errorHandlerMiddleware } from '../../../middlewares/error-handler.middleware';
import { mockUsers } from '../../../mocks/mock-users';
import { DecisionProcessController } from '../decision-process.controller';
import { DecisionProcessServiceError } from '../decision-process.errors';
import { createDecisionProcessRouter } from '../decision-process.routes';
import { DecisionProcessService } from '../decision-process.service';
import type { DecisionProcessRepository } from '../repositories/decision-process.repository';
import { InMemoryDecisionProcessRepository } from '../repositories/in-memory-decision-process.repository';
import { fixtureDecisionProcessGroupAccess } from './group-access.fixture';

/** App isolado do módulo: fixtures de grupo não substituem a autenticação global. */
export function createApp(repository: DecisionProcessRepository = new InMemoryDecisionProcessRepository()) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const userId = request.header('X-Mock-User-Id');
    if (!userId || !mockUsers.some(user => user.id === userId)) {
      throw new DecisionProcessServiceError('UNAUTHENTICATED', 'Usuário mockado não encontrado.');
    }
    request.auth = { user_id: userId, session_id: 'test-session' };
    next();
  });
  const service = new DecisionProcessService(repository, fixtureDecisionProcessGroupAccess());
  app.use(createDecisionProcessRouter(new DecisionProcessController(service)));
  app.use(errorHandlerMiddleware);
  return app;
}
