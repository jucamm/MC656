import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from '../../errors/domain.error';
import type { AuthIdentity, LoginData, MeData, UserDto } from './identity.types';
import { PasswordService } from './password.service';
import type { SessionRepository } from './session.repository';
import { invalidField, normalizeEmail } from './validators/registration.validator';

/**
 * Consultas de identidade necessárias às sessões; separa credencial interna e DTO público.
 * @remarks Somente findCredentialsByEmail carrega password_hash.
 */
export interface SessionUserRepository {
  /**
   * @param {string} email - E-mail canônico produzido pela validação compartilhada.
   * @returns {Promise<{user_id: string, password_hash: string} | null>} Credencial interna ou ausência.
   */
  findCredentialsByEmail(email: string): Promise<{ user_id: string; password_hash: string } | null>;
  /**
   * @param {string} id - ID decimal persistido.
   * @returns {Promise<UserDto | null>} Conta atual sem hash; não usar estado de login em cache.
   */
  findById(id: string): Promise<UserDto | null>;
}

/** Um mês de calendário UTC, ajustando dias inexistentes para o fim do mês. */
/**
 * Calcula um mês de calendário sem converter a regra para um número fixo de dias.
 * @param {Date} date - Instante válido de login/atividade, interpretado em UTC.
 * @returns {Date} Nova data, preservando hora/milissegundos e limitando o dia ao fim do mês.
 * @remarks Não altera date; considera ano bissexto e passagem de dezembro para janeiro.
 */
export function addCalendarMonthUtc(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  // Primeiro fixa o dia em 1 para setUTCMonth não transbordar, por exemplo,
  // de 31/janeiro para março antes de avaliarmos o último dia de fevereiro.
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  // Dia zero do mês seguinte representa o último dia do mês-alvo em UTC.
  // Math.min faz 31/janeiro virar 28/29 de fevereiro, preservando o horário.
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * Produz a chave de busca persistida sem guardar a credencial utilizável.
 * @param {string} token - Token opaco original de alta entropia.
 * @returns {string} SHA-256 em hexadecimal (64 caracteres).
 * @remarks SHA-256 atende ao token aleatório; não substitui Bcrypt para senhas humanas.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Gerencia sessões independentes por login e carrega a conta atual em cada autenticação.
 * @remarks Não usa JWT, refresh token ou estado de verificação embutido na credencial.
 */
export class SessionService {
  /**
   * @param {SessionUserRepository} users - Consulta de credencial e estado atual.
   * @param {SessionRepository} sessions - Persistência com renovação/revogação condicionais.
   * @param {PasswordService} passwords - Comparação Bcrypt reutilizada do cadastro.
   * @param {() => Date} clock - Relógio injetável, permitindo testar expiração sem espera real.
   */
  constructor(
    private readonly users: SessionUserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords = new PasswordService(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Autentica conta pending ou verified e emite uma sessão nova para esse login.
   * @param {unknown} input - Objeto externo contendo exclusivamente email e password.
   * @returns {Promise<LoginData>} Token original emitido uma vez, validade inicial e conta pública.
   * @throws {DomainError} VALIDATION_ERROR para estrutura inválida; INVALID_CREDENTIALS para credenciais recusadas.
   * @throws {Error} Falhas de Bcrypt ou persistência, tratadas genericamente na borda HTTP.
   */
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
    // A política mínima atual não é reaplicada aqui: uma mudança de cadastro
    // não deve invalidar uma senha já existente. A comparação ainda recusa mais de 72 bytes.
    const credentials = await this.users.findCredentialsByEmail(email);
    if (!credentials || !await this.passwords.compare(fields.password, credentials.password_hash)) {
      throw new DomainError('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.', {});
    }
    const user = await this.users.findById(credentials.user_id);
    if (!user) throw new DomainError('INVALID_CREDENTIALS', 'E-mail ou senha inválidos.', {});
    // 32 bytes fornecem 256 bits aleatórios. Base64url sem padding ocupa
    // 43 caracteres; token e UUID não carregam permissões ou dados do usuário.
    const token = randomBytes(32).toString('base64url');
    const now = this.clock();
    const expires = addCalendarMonthUtc(now);
    await this.sessions.create({
      id: randomUUID(), user_id: BigInt(user.id), token_hash: hashSessionToken(token),
      created_at: now, last_activity_at: now, expires_at: expires,
    });
    return { token, token_type: 'Bearer', expires_at: expires.toISOString(), user };
  }

  /**
   * Resolve e renova uma sessão somente enquanto ela ainda é válida.
   * @param {string} token - Credencial extraída exclusivamente do header pelo middleware.
   * @returns {Promise<{identity: AuthIdentity, user: UserDto}>} IDs autenticados e estado atual.
   * @throws {DomainError} UNAUTHENTICATED, SESSION_REVOKED ou SESSION_EXPIRED.
   * @throws {Error} Falhas de persistência, sem conversão para falsa ausência de sessão.
   */
  async authenticate(token: string): Promise<{ identity: AuthIdentity; user: UserDto }> {
    // Somente tokens emitidos por este serviço; não aceita tokens em cookies/query.
    // A regex limita o alfabeto base64url e o comprimento do formato emitido;
    // conformidade sintática não autentica: o hash ainda precisa corresponder no banco.
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
    // NOTE: Recarregar a conta aqui faz a reciclagem de telefone retirar acesso
    // na próxima requisição, sem revogar a sessão ou exigir um novo token.
    const user = await this.users.findById(session.user_id.toString());
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    return { identity: { user_id: user.id, session_id: session.id }, user };
  }

  /**
   * Revoga somente a sessão resolvida pelo middleware, sem apagar seu registro.
   * @param {AuthIdentity} identity - Identidade confiável da sessão corrente.
   * @returns {Promise<void>} Resolve após revogação persistida.
   * @throws {DomainError} UNAUTHENTICATED se a sessão já não puder ser revogada.
   */
  async logout(identity: AuthIdentity): Promise<void> {
    if (!await this.sessions.revoke(identity, this.clock())) {
      throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    }
  }

  /**
   * Recupera o estado necessário para retomar o onboarding após recarregar a página.
   * @param {AuthIdentity} identity - Identidade já autenticada pelo middleware.
   * @returns {Promise<MeData>} Conta atual e metadados sem token, código, hash ou HMAC.
   * @throws {DomainError} UNAUTHENTICATED se a conta não existir mais.
   * @remarks A autenticação/renovação é pré-condição HTTP; este método não valida o token.
   */
  async me(identity: AuthIdentity): Promise<MeData> {
    const user = await this.users.findById(identity.user_id);
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Autenticação necessária.', {});
    return { user, verification_challenges: await this.sessions.currentChallenges(user.id) };
  }
}
