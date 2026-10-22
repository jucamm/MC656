import type { RegistrationService } from './registration.service';
import type { SessionService } from './session.service';
import type { VerificationService } from './verification.service';

/** Dependências do futuro controller HTTP. Nenhum handler funcional nesta etapa. */
export interface IdentityControllerDependencies {
  registration: RegistrationService;
  sessions: SessionService;
  verification: VerificationService;
}
