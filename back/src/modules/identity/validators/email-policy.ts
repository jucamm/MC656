import { invalidField } from './registration.validator';

/** Ponto isolado para a futura política de domínios temporários. */
export interface EmailPolicy { validate(email: string): Promise<void> }

/** Fixture local: nenhuma lista de provedores foi aprovada pela equipe. */
export class MockEmailPolicy implements EmailPolicy {
  constructor(private readonly rejectedDomains: ReadonlySet<string> = new Set()) {}

  async validate(email: string): Promise<void> {
    if (this.rejectedDomains.has(email.split('@')[1])) {
      invalidField('email', 'Este domínio de e-mail não é aceito.');
    }
  }
}
