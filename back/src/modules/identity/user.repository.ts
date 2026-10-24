import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { users } from '../../db/schema';
import { DomainError } from '../../errors/domain.error';
import type { UserDto } from './identity.types';

export interface NewUser { name: string; email: string; phone: string; password_hash: string }
export interface UserRepository {
  create(input: NewUser): Promise<UserDto>;
  findById(id: string): Promise<UserDto | null>;
}

// Projeção explícita: hashes nunca são carregados nas consultas públicas.
export const publicUserColumns = {
  id: users.id, name: users.name, email: users.email, phone: users.phone,
  status: users.status, email_verified_at: users.email_verified_at,
  phone_verified_at: users.phone_verified_at, created_at: users.created_at,
};

type PublicUser = Pick<typeof users.$inferSelect, keyof typeof publicUserColumns>;
export function toUserDto(user: PublicUser): UserDto {
  return {
    id: user.id.toString(), name: user.name, email: user.email, phone: user.phone,
    status: user.status, email_verified_at: user.email_verified_at?.toISOString() ?? null,
    phone_verified_at: user.phone_verified_at?.toISOString() ?? null,
    created_at: user.created_at.toISOString(),
  };
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async create(input: NewUser): Promise<UserDto> {
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
          'code' in cause && cause.code === '23505' &&
          'constraint' in cause && cause.constraint === 'users_email_key') {
        throw new DomainError('EMAIL_ALREADY_REGISTERED', 'E-mail já cadastrado.', {});
      }
      throw error;
    }
  }

  /** Consulta interna exclusiva para comparação de senha; nunca é DTO público. */
  async findCredentialsByEmail(email: string): Promise<{ user_id: string; password_hash: string } | null> {
    const [row] = await this.db.select({ user_id: users.id, password_hash: users.password_hash })
      .from(users).where(eq(users.email, email));
    return row ? { user_id: row.user_id.toString(), password_hash: row.password_hash } : null;
  }

  async findById(id: string): Promise<UserDto | null> {
    const [user] = await this.db.select(publicUserColumns).from(users).where(eq(users.id, BigInt(id)));
    return user ? toUserDto(user) : null;
  }
}
