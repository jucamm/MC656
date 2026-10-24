import type { RegisterData } from './identity.types';
import type { InitialEmailVerificationRequester } from './notifications/initial-email-verification';
import { PasswordService } from './password.service';
import type { UserRepository } from './user.repository';
import { MockEmailPolicy, type EmailPolicy } from './validators/email-policy';
import { validateRegistrationFields } from './validators/registration.validator';

export class RegistrationService {
  constructor(
    private readonly users: UserRepository,
    private readonly initialEmail: InitialEmailVerificationRequester,
    private readonly passwords: PasswordService = new PasswordService(),
    private readonly emailPolicy: EmailPolicy = new MockEmailPolicy(),
  ) {}

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
