import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '../../errors/domain.error';
import type { AuthIdentity, LoginData, MeData, UserDto } from './identity.types';
import { PasswordService } from './password.service';
import type { SessionRepository } from './session.repository';
import { invalidField, normalizeEmail } from './validators/registration.validator';

export interface SessionUserRepository {
  findCredentialsByEmail(email: string): Promise<{ user_id: string; password_hash: string } | null>;
  findById(id: string): Promise<UserDto | null>;
}

/** Um mês de calendário UTC, ajustando dias inexistentes para o fim do mês. */
export function addCalendarMonthUtc(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionService {
  constructor(
    private readonly users: SessionUserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords = new PasswordService(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async login(input: unknown): Promise<LoginData> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      invalidField('body', 'Informe e-mail e senha.');
    }
    const fields = input as Record<string, unknown>;
    if (Object.keys(fields).some(key => !['email', 'password'].includes(key))) {
      invalidField('body', 'O login contém campos não permitidos.');
    }
    const email = normalizeEmail(fields.email);
    if (typeof fields.password !== 'string') invalidField('password', 'Informe uma senha válida.');
    const credentials = await this.users.findCredentialsByEmail(email);
    if (!credentials || !await this.passwords.compare(fields.password, credentials.password_hash)) {
      throw new DomainError('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.', {});
    }
    const user = await this.users.findById(credentials.user_id);
    if (!user) throw new DomainError('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.', {});
    const token = randomBytes(32).toString('base64url');
    const now = this.clock();
    const expires = addCalendarMonthUtc(now);
    await this.sessions.create({
      id: randomUUID(), user_id: BigInt(user.id), token_hash: hashSessionToken(token),
      created_at: now, last_activity_at: now, expires_at: expires,
    });
    return { token, token_type: 'Bearer', expires_at: expires.toISOString(), user };
  }

  async authenticate(token: string): Promise<{ identity: AuthIdentity; user: UserDto }> {
    // Somente tokens emitidos por este serviço; não aceita tokens em cookies/query.
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    }
    const now = this.clock();
    const hash = hashSessionToken(token);
    const session = await this.sessions.renewIfValid(hash, now, addCalendarMonthUtc(now));
    if (!session) {
      const previous = await this.sessions.findByTokenHash(hash);
      if (previous?.revoked_at) throw new DomainError('SESSION_REVOKED', 'Sessão revogada.', {});
      if (previous && previous.expires_at <= now) throw new DomainError('SESSION_EXPIRED', 'Sessão expirada.', {});
      throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    }
    const user = await this.users.findById(session.user_id.toString());
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    return { identity: { user_id: user.id, session_id: session.id }, user };
  }

  async logout(identity: AuthIdentity): Promise<void> {
    if (!await this.sessions.revoke(identity, this.clock())) {
      throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    }
  }

  async me(identity: AuthIdentity): Promise<MeData> {
    const user = await this.users.findById(identity.user_id);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    return { user, verification_challenges: await this.sessions.currentChallenges(user.id) };
  }
}
