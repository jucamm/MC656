import type { RequestHandler } from 'express';
import { DomainError } from '../../errors/domain.error';
import type { RegistrationService } from './registration.service';
import type { SessionService } from './session.service';
import type { VerificationService } from './verification.service';

/** Contratos de composição dos fluxos de identidade. */
export interface IdentityControllerDependencies {
  registration: RegistrationService;
  sessions: SessionService;
  verification: VerificationService;
}


export class IdentitySessionController {
  constructor(private readonly sessions: SessionService) {}

  login: RequestHandler = async (request, response) => {
    response.status(200).json({ data: await this.sessions.login(request.body) });
  };

  logout: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    await this.sessions.logout(request.auth);
    response.status(204).end();
  };

  me: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    response.status(200).json({ data: await this.sessions.me(request.auth) });
  };
}
