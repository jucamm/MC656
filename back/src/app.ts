import { DomainError } from './errors/domain.error';
import type { MockUser } from './mocks/mock-users';
import { pautasRouter } from './modules/pautas/pautas.routes';
import { bindGroupIdentity } from './modules/identity/group-identity.middleware';
import { readTrustedOrigin, trustedOriginCors } from './modules/identity/cors.middleware';
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

export interface AppOptions {
  trustedOrigin?: string;
  /** Vínculos por ID real, fornecidos no servidor. Não cria associações automáticas. */
  groupUsers?: readonly MockUser[];
}

export function createApp(
  repository: DecisionProcessRepository =
    new InMemoryDecisionProcessRepository(),
  identitySessions?: SessionService,
  identityOnboarding?: IdentityOnboardingServices,
  options: AppOptions = {},
): Express {
  const application = express();
  const groupUsers = options.groupUsers ?? [];
  const service = new DecisionProcessService(repository, undefined, groupUsers);
  const controller = new DecisionProcessController(service);

  application.use(trustedOriginCors(readTrustedOrigin(options.trustedOrigin)));
  if (identitySessions) application.use('/auth', createIdentityRouter(identitySessions, identityOnboarding));
  // Gate global: nenhum router registrado abaixo fica público ou depende de headers mockados.
  application.use(identitySessions ? requireAuthentication(identitySessions) : (_request, _response, _next) => {
    throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
  });
  application.use(requireVerifiedAccount);
  application.use(identityErrorHandler);
  application.use(express.json());
  application.use('/api/pautas', pautasRouter);
  application.use(createDecisionProcessRouter(controller, bindGroupIdentity(groupUsers)));
  application.use(errorHandlerMiddleware);

  return application;
}

export const app = createApp();
