import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, check, index, integer, pgEnum, pgTable,
  primaryKey, text, timestamp, unique, uuid, varchar,
} from 'drizzle-orm/pg-core';

/**
 * Estados da conta; a coerência com os dois timestamps é imposta também por check no PostgreSQL.
 */
export const accountStatus = pgEnum('account_status', ['pending', 'verified']);
/**
 * Enum compartilhado por desafios e cotas para impedir canais divergentes na persistência.
 */
export const verificationChannel = pgEnum('verification_channel', ['email', 'phone']);
/**
 * Duas janelas independentes por conta/canal, com durações definidas pelo serviço.
 */
export const rateLimitWindow = pgEnum('rate_limit_window', ['hour', 'day']);

/**
 * Schema de identidade: e-mail único, telefone reutilizável e apenas hash de senha.
 * @remarks bigint fica como bigint no ORM; a camada de DTO converte para string decimal.
 */
export const users = pgTable('users', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  // A máscara canônica cabe em varchar(20). Não adicionar UNIQUE: contas distintas
  // podem cadastrar o mesmo número, e só a confirmação é transferida atomicamente.
  phone: varchar('phone', { length: 20 }).notNull(),
  password_hash: text('password_hash').notNull(),
  status: accountStatus('status').notNull().default('pending'),
  email_verified_at: timestamp('email_verified_at', { withTimezone: true }),
  phone_verified_at: timestamp('phone_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // A equivalência booleana proíbe tanto verified sem os dois canais quanto
  // pending com ambos preenchidos. O serviço deve atualizar status/timestamps juntos.
  check('users_verification_status_check', sql`
    (${table.status} = 'verified') =
    (${table.email_verified_at} IS NOT NULL AND ${table.phone_verified_at} IS NOT NULL)
  `),
  index('users_phone_idx').on(table.phone),
]);

/**
 * Sessões simultâneas e independentes; token original nunca é coluna.
 * @remarks timestamptz preserva o instante; cálculos de mês UTC pertencem ao serviço.
 * O logout marca revoked_at e mantém o registro para o ciclo de vida da sessão.
 */
export const authenticationSessions = pgTable('authentication_sessions', {
  id: uuid('id').primaryKey(),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  last_activity_at: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  // O check garante uma janela temporal positiva, mas não calcula um mês nem
  // substitui a recusa de sessões expiradas/revogadas no UPDATE de renovação.
  check('authentication_sessions_expiry_check', sql`${table.expires_at} > ${table.last_activity_at}`),
  index('authentication_sessions_user_id_idx').on(table.user_id),
]);

/**
 * Desafio corrente por conta/canal com HMAC em vez de código em claro.
 * @remarks Reenvio troca o UUID na linha existente; o identificador antigo perde validade.
 * Consumed/revoked são estados explícitos, separados da expiração e dos erros de código.
 */
export const verificationChallenges = pgTable('verification_challenges', {
  id: uuid('id').primaryKey(),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  channel: verificationChannel('channel').notNull(),
  code_hmac: varchar('code_hmac', { length: 64 }).notNull(),
  failed_attempts: integer('failed_attempts').notNull().default(0),
  issued_at: timestamp('issued_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumed_at: timestamp('consumed_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  // A unicidade é do par conta/canal, não de "desafios ainda ativos"; estados
  // finais ficam consultáveis até o próximo reenvio substituir essa linha.
  unique('verification_challenges_user_channel_unique').on(table.user_id, table.channel),
  check('verification_challenges_attempts_check', sql`${table.failed_attempts} BETWEEN 0 AND 3`),
  check('verification_challenges_expiry_check', sql`${table.expires_at} > ${table.issued_at}`),
]);

/**
 * Persistência de cotas por conta, canal e tipo de janela, sem dimensão de IP.
 * @remarks A PK permite quatro combinações por conta. O serviço cria as linhas somente
 * após envio aceito e preserva blocked_until mesmo quando a janela diária expira.
 */
export const rateLimits = pgTable('rate_limits', {
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  channel: verificationChannel('channel').notNull(),
  window_type: rateLimitWindow('window_type').notNull(),
  window_started_at: timestamp('window_started_at', { withTimezone: true }).notNull(),
  window_expires_at: timestamp('window_expires_at', { withTimezone: true }).notNull(),
  request_count: integer('request_count').notNull().default(0),
  blocked_until: timestamp('blocked_until', { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.user_id, table.channel, table.window_type] }),
  check('rate_limits_count_check', sql`${table.request_count} >= 0`),
  check('rate_limits_window_check', sql`${table.window_expires_at} > ${table.window_started_at}`),
  // O bloqueio longo pertence somente à linha day. Esses checks asseguram
  // integridade básica, mas os tetos 3/6 e a concorrência são garantidos pelo serviço/locks.
  check('rate_limits_daily_block_check', sql`${table.blocked_until} IS NULL OR ${table.window_type} = 'day'`),
]);
