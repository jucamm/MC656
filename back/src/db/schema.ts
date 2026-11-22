import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, check, foreignKey, index, integer, pgEnum, pgTable,
  primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar,
} from 'drizzle-orm/pg-core';

/**
 * Estados da conta; a coerência com o timestamp de confirmação é imposta também por check no PostgreSQL.
 */
export const accountStatus = pgEnum('account_status', ['pending', 'verified']);
/**
 * Enum compartilhado por desafios e cotas para impedir canais divergentes na persistência.
 */
export const verificationChannel = pgEnum('verification_channel', ['email']);
/**
 * Duas janelas independentes por conta/canal, com durações definidas pelo serviço.
 */
export const rateLimitWindow = pgEnum('rate_limit_window', ['hour', 'day']);

/**
 * Schema de identidade: e-mail único e apenas hash de senha.
 * @remarks bigint fica como bigint no ORM; a camada de DTO converte para string decimal.
 */
export const users = pgTable('users', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  password_hash: text('password_hash').notNull(),
  status: accountStatus('status').notNull().default('pending'),
  email_verified_at: timestamp('email_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('users_verification_status_check', sql`
    (${table.status} = 'verified') = (${table.email_verified_at} IS NOT NULL)
  `),
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
 * @remarks A PK permite uma linha por janela para o e-mail de cada conta. O serviço cria as linhas somente
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

export const groupRole = pgEnum('group_role', ['ADMIN', 'MEMBER']);
export const groupDeletionReason = pgEnum('group_deletion_reason', ['ADMIN_DELETION', 'LAST_MEMBER_LEFT']);
export const groupInvitationStatus = pgEnum('group_invitation_status', ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED']);

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  created_by_user_id: bigint('created_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
  deletion_reason: groupDeletionReason('deletion_reason'),
}, (table) => [
  check('groups_name_not_blank_check', sql`${table.name} ~ '[^[:space:]]'`),
  check('groups_deletion_state_check', sql`(${table.deleted_at} IS NULL) = (${table.deletion_reason} IS NULL)`),
]);

export const groupMemberships = pgTable('group_memberships', {
  group_id: uuid('group_id').notNull().references(() => groups.id),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  role: groupRole('role').notNull().default('MEMBER'),
  joined_at: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.group_id, table.user_id] }),
  index('group_memberships_user_group_idx').on(table.user_id, table.group_id),
  index('group_memberships_admin_group_idx').on(table.group_id).where(sql`${table.role} = 'ADMIN'`),
]);

export const groupInvitations = pgTable('group_invitations', {
  id: uuid('id').primaryKey(),
  group_id: uuid('group_id').notNull().references(() => groups.id),
  invited_user_id: bigint('invited_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  invited_by_user_id: bigint('invited_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  status: groupInvitationStatus('status').notNull().default('PENDING'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [
  check('group_invitations_resolution_check', sql`(${table.status} = 'PENDING') = (${table.resolved_at} IS NULL)`),
  uniqueIndex('group_invitations_pending_group_user_uidx')
    .on(table.group_id, table.invited_user_id).where(sql`${table.status} = 'PENDING'`),
  index('group_invitations_recipient_idx').on(table.invited_user_id, table.id),
]);

export const meetingAccessMode = pgEnum('meeting_access_mode', ['public', 'group', 'selected']);
export const meetingParticipantOrigin = pgEnum('meeting_participant_origin', ['creator', 'group', 'invitation']);
export const meetingParticipantStatus = pgEnum('meeting_participant_status', ['confirmed', 'pending', 'declined']);

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey(),
  subject: varchar('subject', { length: 150 }).notNull(),
  starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: bigint('created_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  organizer_user_id: bigint('organizer_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  group_id: uuid('group_id').references(() => groups.id),
  access_mode: meetingAccessMode('access_mode').notNull(),
}, (table) => [
  check('meetings_subject_not_blank_check', sql`${table.subject} ~ '[^[:space:]]'`),
  check('meetings_starts_after_creation_check', sql`${table.starts_at} > ${table.created_at}`),
  check('meetings_group_access_check', sql`${table.access_mode} <> 'group' OR ${table.group_id} IS NOT NULL`),
  index('meetings_starts_at_id_idx').on(table.starts_at, table.id),
  index('meetings_group_id_idx').on(table.group_id),
]);

export const meetingParticipants = pgTable('meeting_participants', {
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  origin: meetingParticipantOrigin('origin').notNull(),
  status: meetingParticipantStatus('status').notNull(),
  is_moderator: boolean('is_moderator').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.meeting_id, table.user_id] }),
  check('meeting_participants_origin_status_check', sql`${table.origin} = 'invitation' OR ${table.status} = 'confirmed'`),
  check('meeting_participants_moderator_confirmed_check', sql`NOT ${table.is_moderator} OR ${table.status} = 'confirmed'`),
  check('meeting_participants_resolution_check', sql`
    (${table.resolved_at} IS NOT NULL) = (${table.origin} = 'invitation' AND ${table.status} <> 'pending')
    AND (${table.resolved_at} IS NULL OR ${table.resolved_at} >= ${table.created_at})
  `),
  index('meeting_participants_user_meeting_idx').on(table.user_id, table.meeting_id),
]);

export const meetingOrganizerTransferStatus = pgEnum('meeting_organizer_transfer_status', [
  'pending', 'accepted', 'declined', 'cancelled',
]);

export const meetingOrganizerTransfers = pgTable('meeting_organizer_transfers', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  requested_by_user_id: bigint('requested_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  recipient_user_id: bigint('recipient_user_id', { mode: 'bigint' }).notNull(),
  status: meetingOrganizerTransferStatus('status').notNull().default('pending'),
  requested_at: timestamp('requested_at', { withTimezone: true }).notNull(),
  resolved_at: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [
  foreignKey({
    name: 'meeting_organizer_transfers_recipient_fk',
    columns: [table.meeting_id, table.recipient_user_id],
    foreignColumns: [meetingParticipants.meeting_id, meetingParticipants.user_id],
  }),
  check('meeting_organizer_transfers_distinct_users_check', sql`${table.requested_by_user_id} <> ${table.recipient_user_id}`),
  check('meeting_organizer_transfers_resolution_check', sql`
    (${table.status} = 'pending') = (${table.resolved_at} IS NULL)
    AND (${table.resolved_at} IS NULL OR ${table.resolved_at} >= ${table.requested_at})
  `),
  uniqueIndex('meeting_organizer_transfers_pending_idx').on(table.meeting_id).where(sql`${table.status} = 'pending'`),
  index('meeting_organizer_transfers_recipient_idx').on(table.recipient_user_id, table.id).where(sql`${table.status} = 'pending'`),
]);

export const meetingConferencing = pgTable('meeting_conferencing', {
  meeting_id: uuid('meeting_id').primaryKey().references(() => meetings.id),
  mode: varchar('mode', { length: 7 }).$type<'virtual' | 'hybrid'>().notNull(),
  google_meet_url: varchar('google_meet_url', { length: 80 }).notNull(),
}, (table) => [
  check('meeting_conferencing_mode_check', sql`${table.mode} IN ('virtual', 'hybrid')`),
  check('meeting_conferencing_url_check', sql`
    ${table.google_meet_url} ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'
  `),
]);
