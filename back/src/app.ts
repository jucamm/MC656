import { identityErrorHandler, requireAuthentication, requireVerifiedAccount } from './modules/identity/session.middleware';
import type { IdentityOnboardingServices } from './modules/identity/identity.controller';
import { createIdentityRouter } from './modules/identity/identity.routes';
import type { SessionService } from './modules/identity/session.service';
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
  identitySessions?: SessionService,
  identityOnboarding?: IdentityOnboardingServices,
): Express {
  const application = express();
  const service = new DecisionProcessService(repository);
  const controller = new DecisionProcessController(service);

  if (identitySessions) application.use('/auth', createIdentityRouter(identitySessions, identityOnboarding));
  // As rotas de grupos existentes passam a consultar a identidade real
  // quando o módulo está configurado; o onboarding continua disponível a pending.
  if (identitySessions) {
    application.use('/groups', requireAuthentication(identitySessions), requireVerifiedAccount, identityErrorHandler);
  }
  application.use(express.json());
  application.use(createDecisionProcessRouter(controller));
  application.use(errorHandlerMiddleware);

  return application;
}

export const app = createApp();
