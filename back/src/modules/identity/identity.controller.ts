import { validateChannel } from './validators/verification.validator';
import { invalidField } from './validators/registration.validator';
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


export type IdentityOnboardingServices = Pick<IdentityControllerDependencies, 'registration' | 'verification'>;

export class IdentityVerificationController {
  constructor(private readonly services: IdentityOnboardingServices) {}

  register: RequestHandler = async (request, response) => {
    response.status(201).json({ data: await this.services.registration.register(request.body) });
  };

  send: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    if (request.body !== undefined && (request.body === null || typeof request.body !== 'object' ||
        Array.isArray(request.body) || Object.keys(request.body).length > 0)) {
      invalidField('body', 'O envio não aceita dados de destino ou outros campos.');
    }
    const challenge = await this.services.verification.send(request.auth, validateChannel(request.params.channel));
    response.status(200).json({ data: challenge });
  };

  confirm: RequestHandler = async (request, response) => {
    if (!request.auth) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    const result = await this.services.verification.confirm(request.auth, validateChannel(request.params.channel), request.body);
    response.status(200).json({ data: result });
  };
}
