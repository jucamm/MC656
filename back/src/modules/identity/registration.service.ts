import type { RegisterData } from './identity.types';
import type { InitialEmailVerificationRequester } from './notifications/initial-email-verification';
import { PasswordService } from './password.service';
import type { UserRepository } from './user.repository';
import { MockEmailPolicy, type EmailPolicy } from './validators/email-policy';
import { validateRegistrationFields } from './validators/registration.validator';

/**
 * Coordena cadastro persistido e solicitação inicial de verificação de e-mail.
 * @remarks A comunicação ocorre depois da criação: sua falha não desfaz a conta.
 */
export class RegistrationService {
  /**
   * @param {UserRepository} users - Persistência com projeção pública e unicidade no banco.
   * @param {InitialEmailVerificationRequester} initialEmail - Emissor de e-mail inicial ou fixture.
   * @param {PasswordService} passwords - Política e Bcrypt assíncrono.
   * @param {EmailPolicy} emailPolicy - Política isolada de domínios, mockada por padrão.
   */
  constructor(
    private readonly users: UserRepository,
    private readonly initialEmail: InitialEmailVerificationRequester,
    private readonly passwords: PasswordService = new PasswordService(),
    private readonly emailPolicy: EmailPolicy = new MockEmailPolicy(),
  ) {}

  /**
   * Executa a cadeia de validação antes de criar uma conta pending.
   * @param {unknown} input - Dados externos do cadastro, ainda não confiáveis.
   * @returns {Promise<RegisterData>} Conta segura e resultado do envio, inclusive failed.
   * @throws {DomainError} VALIDATION_ERROR ou EMAIL_ALREADY_REGISTERED.
   * @throws {Error} Falhas internas anteriores à etapa de comunicação.
   * @remarks Exceções do emissor são convertidas em envio failed, sem expor sua causa.
   */
  async register(input: unknown): Promise<RegisterData> {
    // Cadeia simples: formato/normalização → senha → política de domínio.
    const validated = validateRegistrationFields(input);
    this.passwords.validate(validated.password);
    await this.emailPolicy.validate(validated.email);
    const password_hash = await this.passwords.hash(validated.password);
    const user = await this.users.create({
      name: validated.name, email: validated.email, phone: validated.phone, password_hash,
    });

    // A criação é confirmada antes da comunicação. Uma falha de envio nunca
    // desfaz a conta nem orienta o cliente a repetir o cadastro.
    try {
      const email_verification = await this.initialEmail.request({ user_id: user.id, email: user.email });
      return { user, email_verification };
    } catch {
      return { user, email_verification: { delivery_status: 'failed', challenge_id: null, expires_at: null } };
    }
  }
}
