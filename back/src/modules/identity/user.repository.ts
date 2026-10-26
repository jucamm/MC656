import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../../db/schema';
import { DomainError } from '../../errors/domain.error';
import type { UserDto } from './identity.types';

/**
 * Entrada interna de persistência, construída exclusivamente pelo serviço.
 * @property {string} name - Nome validado.
 * @property {string} email - Endereço normalizado para unicidade e login consistentes.
 * @property {string} phone - Celular normalizado com máscara canônica.
 * @property {string} password_hash - Hash Bcrypt; nunca a senha original.
 */
export interface NewUser { name: string; email: string; phone: string; password_hash: string }
/**
 * Operações de usuário cujo retorno é sempre uma projeção pública segura.
 * @remarks A consulta de credenciais é separada deste contrato de cadastro/consulta.
 */
export interface UserRepository {
  /**
   * @param {NewUser} input - Dados já validados e protegidos.
   * @returns {Promise<UserDto>} Conta pending criada; duplicidade rejeita com EMAIL_ALREADY_REGISTERED.
   */
  create(input: NewUser): Promise<UserDto>;
  /**
   * @param {string} id - ID decimal da própria conta.
   * @returns {Promise<UserDto | null>} Conta atual sem password_hash ou null.
   */
  findById(id: string): Promise<UserDto | null>;
}

// Projeção explícita: hashes nunca são carregados nas consultas públicas.
export const publicUserColumns = {
  id: users.id, name: users.name, email: users.email, phone: users.phone,
  status: users.status, email_verified_at: users.email_verified_at,
  phone_verified_at: users.phone_verified_at, created_at: users.created_at,
};

type PublicUser = Pick<typeof users.$inferSelect, keyof typeof publicUserColumns>;
/**
 * Converte os tipos de persistência para o contrato público sem perder precisão de ID.
 * @param {PublicUser} user - Projeção sem password_hash, obtida do ORM.
 * @returns {UserDto} bigint decimal e datas UTC serializados como strings.
 * @remarks BigInt não é convertido para number, que perderia precisão em IDs grandes.
 */
export function toUserDto(user: PublicUser): UserDto {
  return {
    id: user.id.toString(), name: user.name, email: user.email, phone: user.phone,
    status: user.status, email_verified_at: user.email_verified_at?.toISOString() ?? null,
    phone_verified_at: user.phone_verified_at?.toISOString() ?? null,
    created_at: user.created_at.toISOString(),
  };
}

/**
 * Persiste usuários e aplica projeção explícita para não carregar segredos em consultas públicas.
 */
export class PostgresUserRepository implements UserRepository {
  /**
   * @param {NodePgDatabase} db - Conexão Drizzle usada pelas consultas parametrizadas.
   */
  constructor(private readonly db: NodePgDatabase) {}

  /**
   * Insere pending e canais nulos, deixando a unicidade ser arbitrada pelo banco.
   * @param {NewUser} input - Dados internos normalizados e hash Bcrypt.
   * @returns {Promise<UserDto>} Conta criada sem campos secretos.
   * @throws {DomainError} EMAIL_ALREADY_REGISTERED somente para a constraint de e-mail.
   * @throws {Error} Outras falhas de banco permanecem erros internos.
   */
  async create(input: NewUser): Promise<UserDto> {
    // NOTE: Não se usa SELECT prévio como garantia de unicidade: duas requisições
    // poderiam passar nessa consulta ao mesmo tempo. A constraint decide a disputa.
    try {
      const [user] = await this.db.insert(users).values({
        name: input.name, email: input.email, phone: input.phone, password_hash: input.password_hash,
        status: 'pending', email_verified_at: null, phone_verified_at: null,
      }).returning(publicUserColumns);
      return toUserDto(user);
    } catch (error: unknown) {
      // Drizzle envolve o erro original do pg em cause. Somente a constraint
      // de e-mail é traduzida; outros problemas não viram falsa duplicidade.
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (typeof cause === 'object' && cause !== null &&
          // 23505 identifica unique_violation; a constraint evita transformar
          // qualquer outra colisão ou falha SQL em uma falsa duplicidade de e-mail.
          'code' in cause && cause.code === '23505' &&
          'constraint' in cause && cause.constraint === 'users_email_key') {
        throw new DomainError('EMAIL_ALREADY_REGISTERED', 'E-mail já cadastrado.', {});
      }
      throw error;
    }
  }

  /** Consulta interna exclusiva para comparação de senha; nunca é DTO público. */
  /**
   * Consulta interna restrita ao login; não deve ser serializada ou logada.
   * @param {string} email - E-mail normalizado pela mesma rotina do cadastro.
   * @returns {Promise<{user_id: string, password_hash: string} | null>} Credencial ou ausência.
   */
  async findCredentialsByEmail(email: string): Promise<{ user_id: string; password_hash: string } | null> {
    const [row] = await this.db.select({ user_id: users.id, password_hash: users.password_hash })
      .from(users).where(eq(users.email, email));
    return row ? { user_id: row.user_id.toString(), password_hash: row.password_hash } : null;
  }

  /**
   * Busca o estado atual, inclusive após a reciclagem de telefone.
   * @param {string} id - ID decimal confiável da identidade autenticada.
   * @returns {Promise<UserDto | null>} Projeção segura da conta, sem cache de status.
   * @throws {Error} Falha de banco ou conversão inválida do ID interno.
   */
  async findById(id: string): Promise<UserDto | null> {
    const [user] = await this.db.select(publicUserColumns).from(users).where(eq(users.id, BigInt(id)));
    return user ? toUserDto(user) : null;
  }
}
