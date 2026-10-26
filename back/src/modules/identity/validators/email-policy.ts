import { invalidField } from './registration.validator';

/** Ponto isolado para a futura política de domínios temporários. */
/**
 * Contrato isolado para a política de domínios de e-mail, após normalização.
 * @property {(email: string) => Promise<void>} validate - Resolve se aceito;
 *  rejeita com VALIDATION_ERROR quando a política recusa o domínio.
 */
export interface EmailPolicy { validate(email: string): Promise<void> }

/** Fixture local: nenhuma lista de provedores foi aprovada pela equipe. */
/**
 * Política local de fixtures; uma coleção vazia não recusa nenhum domínio.
 * @remarks Não representa uma lista de provedores aprovada nem detecção real de e-mails temporários.
 */
export class MockEmailPolicy implements EmailPolicy {
  /**
   * @param {ReadonlySet<string>} rejectedDomains - Domínios canônicos explicitamente recusados no teste.
   */
  constructor(private readonly rejectedDomains: ReadonlySet<string> = new Set()) {}

  /**
   * Consulta somente a fixture, sem DNS ou comunicação externa.
   * @param {string} email - Endereço já validado e normalizado.
   * @returns {Promise<void>} Resolve quando a fixture permite o domínio.
   * @throws {DomainError} VALIDATION_ERROR se o domínio estiver na coleção.
   */
  async validate(email: string): Promise<void> {
    if (this.rejectedDomains.has(email.split('@')[1])) {
      invalidField('email', 'Este domínio de e-mail não é aceito.');
    }
  }
}
