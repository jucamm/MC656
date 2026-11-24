import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, boolean, check, date, foreignKey, index, integer, jsonb, pgEnum, pgTable,
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

export const legislativeBills = pgTable('legislative_bills', {
  id: uuid('id').primaryKey(),
  house_key: varchar('house_key', { length: 12 }).notNull(),
  uf: varchar('uf', { length: 2 }),
  external_id: varchar('external_id', { length: 120 }).notNull(),
  kind: varchar('kind', { length: 8 }).notNull(),
  number: integer('number').notNull(),
  year: integer('year').notNull(),
  label: varchar('label', { length: 150 }).notNull(),
  abstract: text('abstract').notNull(),
  official_url: text('official_url').notNull(),
  status: text('status', { enum: ['in_progress', 'closed', 'unknown'] }).notNull(),
  status_label: varchar('status_label', { length: 240 }).notNull(),
  source_updated_at: timestamp('source_updated_at', { withTimezone: true }),
  verified_at: timestamp('verified_at', { withTimezone: true }).notNull(),
}, table => [
  unique('legislative_bills_source_unique').on(table.house_key, table.external_id),
  index('legislative_bills_offer_idx').on(table.house_key, table.status, table.verified_at),
  check('legislative_bills_state_check', sql`
    ${table.kind} = 'PL' AND ${table.status} IN ('in_progress','closed','unknown')
    AND ${table.number} > 0 AND ${table.year} BETWEEN 1800 AND 9999
    AND ${table.official_url} LIKE 'https://%'
    AND (CASE WHEN ${table.house_key} IN ('CD','SF') THEN ${table.uf} IS NULL
      WHEN ${table.house_key} = 'CLDF' THEN ${table.uf} IS NOT NULL AND ${table.uf} = 'DF'
      ELSE ${table.uf} IN ('AC','AL','AP','AM','BA','CE','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
        AND ${table.uf} IS NOT NULL AND ${table.house_key} = 'AL-' || ${table.uf} END)
  `),
]);

export const legislativeSourceSync = pgTable('legislative_source_sync', {
  house_key: varchar('house_key', { length: 12 }).primaryKey(),
  last_attempt_at: timestamp('last_attempt_at', { withTimezone: true }),
  last_success_at: timestamp('last_success_at', { withTimezone: true }),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  lease_token: uuid('lease_token'),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  failure_code: varchar('failure_code', { length: 40 }),
}, table => [
  check('legislative_source_lease_check', sql`(${table.lease_token} IS NULL) = (${table.lease_until} IS NULL)`),
]);

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey(),
  subject: varchar('subject', { length: 150 }).notNull(),
  legislative_bill_id: uuid('legislative_bill_id').references(() => legislativeBills.id),
  starts_at: timestamp('starts_at', { withTimezone: true }).notNull(),
  scheduled_ends_at: timestamp('scheduled_ends_at', { withTimezone: true }),
  schedule_version: integer('schedule_version').notNull().default(1),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: bigint('created_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  organizer_user_id: bigint('organizer_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  group_id: uuid('group_id').references(() => groups.id),
  access_mode: meetingAccessMode('access_mode').notNull(),
  ended_at: timestamp('ended_at', { withTimezone: true }),
  ended_by_user_id: bigint('ended_by_user_id', { mode: 'bigint' }).references(() => users.id),
}, (table) => [
  check('meetings_schedule_check', sql`${table.schedule_version} > 0 AND (${table.scheduled_ends_at} IS NULL OR ${table.scheduled_ends_at} > ${table.starts_at}) AND (${table.cancelled_at} IS NULL OR ${table.ended_at} IS NULL)`),
  check('meetings_subject_not_blank_check', sql`${table.subject} ~ '[^[:space:]]'`),
  check('meetings_starts_after_creation_check', sql`${table.starts_at} > ${table.created_at}`),
  check('meetings_group_access_check', sql`${table.access_mode} <> 'group' OR ${table.group_id} IS NOT NULL`),
  check('meetings_end_state_check', sql`
    (${table.ended_at} IS NULL) = (${table.ended_by_user_id} IS NULL)
    AND (${table.ended_at} IS NULL OR ${table.ended_at} >= ${table.starts_at})
  `),
  index('meetings_legislative_bill_idx').on(table.legislative_bill_id).where(sql`${table.legislative_bill_id} IS NOT NULL`),
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

export const meetingParticipationBlocks = pgTable('meeting_participation_blocks', {
  meeting_id: uuid('meeting_id').notNull(),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull(),
  blocked_by_user_id: bigint('blocked_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  blocked_at: timestamp('blocked_at', { withTimezone: true }).notNull(),
}, table => [
  primaryKey({ columns: [table.meeting_id, table.user_id] }),
  foreignKey({
    name: 'meeting_participation_blocks_target_fk',
    columns: [table.meeting_id, table.user_id],
    foreignColumns: [meetingParticipants.meeting_id, meetingParticipants.user_id],
  }),
  check('meeting_participation_blocks_actor_check', sql`${table.user_id} <> ${table.blocked_by_user_id}`),
]);

export const meetingAgendaItems = pgTable('meeting_agenda_items', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  proposed_by_user_id: bigint('proposed_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  subject: varchar('subject', { length: 150 }).notNull(),
  context: varchar('context', { length: 4000 }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  review_status: text('review_status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  reviewed_by_user_id: bigint('reviewed_by_user_id', { mode: 'bigint' }).references(() => users.id),
  reviewed_at: timestamp('reviewed_at', { withTimezone: true }),
}, (table) => [
  check('meeting_agenda_items_text_check', sql`${table.subject} ~ '[^[:space:]]' AND ${table.context} ~ '[^[:space:]]'`),
  check('meeting_agenda_items_review_check', sql`
    (${table.review_status} = 'pending' AND ${table.reviewed_by_user_id} IS NULL AND ${table.reviewed_at} IS NULL)
    OR (${table.review_status} IN ('approved', 'rejected') AND ${table.reviewed_by_user_id} IS NOT NULL
      AND ${table.reviewed_at} IS NOT NULL AND ${table.reviewed_at} >= ${table.created_at})
  `),
  unique('action_item_agenda_scope_unique').on(table.meeting_id, table.id),
  index('meeting_agenda_items_meeting_id_idx').on(table.meeting_id, table.id),
]);

export const meetingConferencing = pgTable('meeting_conferencing', {
  meeting_id: uuid('meeting_id').primaryKey().references(() => meetings.id),
  mode: varchar('mode', { length: 7 }).$type<'virtual' | 'hybrid'>().notNull(),
  google_meet_url: varchar('google_meet_url', { length: 80 }),
  provisioning: text('provisioning', { enum: ['manual', 'automatic'] }).notNull().default('manual'),
  transcription_space_name: text('transcription_space_name').unique(),
  transcription_policy_version: varchar('transcription_policy_version', { length: 80 }),
}, (table) => [
  check('meeting_provisioning_check', sql`${table.provisioning} IN ('manual','automatic') AND (${table.provisioning} = 'automatic' OR ${table.google_meet_url} IS NOT NULL)`),
  check('meeting_capture_pair_check', sql`((${table.transcription_space_name} IS NULL) = (${table.transcription_policy_version} IS NULL)) OR (${table.provisioning} = 'automatic' AND ${table.transcription_space_name} IS NULL AND ${table.transcription_policy_version} IS NOT NULL)`),
  check('meeting_conferencing_mode_check', sql`${table.mode} IN ('virtual', 'hybrid')`),
  check('meeting_conferencing_url_check', sql`
    ${table.google_meet_url} ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'
  `),
]);

export const meetingPolls = pgTable('meeting_polls', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  question: varchar('question', { length: 150 }).notNull(),
  opened_at: timestamp('opened_at', { withTimezone: true }).notNull(),
  opened_by_user_id: bigint('opened_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  closed_at: timestamp('closed_at', { withTimezone: true }),
  closed_by_user_id: bigint('closed_by_user_id', { mode: 'bigint' }).references(() => users.id),
}, table => [
  check('meeting_polls_question_not_blank_check', sql`${table.question} ~ '[^[:space:]]'`),
  check('meeting_polls_close_state_check', sql`
    (${table.closed_at} IS NULL) = (${table.closed_by_user_id} IS NULL)
    AND (${table.closed_at} IS NULL OR ${table.closed_at} >= ${table.opened_at})
  `),
  unique('action_item_polls_scope_unique').on(table.meeting_id, table.id),
  index('meeting_polls_meeting_id_idx').on(table.meeting_id, table.id),
  uniqueIndex('meeting_polls_one_open_idx').on(table.meeting_id).where(sql`${table.closed_at} IS NULL`),
]);

export const meetingMinutes = pgTable('meeting_minutes', {
  meeting_id: uuid('meeting_id').primaryKey().references(() => meetings.id),
  source_kind: text('source_kind', { enum: ['meet_transcript', 'notes', 'none'] }).notNull(),
  source_space_name: text('source_space_name').unique(),
  conference_name: text('conference_name').unique(),
  source_transcripts: text('source_transcripts').array(),
  source_notes: text('source_notes'),
  source_transcript_id: uuid('source_transcript_id').references(() => meetingTranscriptSnapshots.id),
  source_transcript_version: integer('source_transcript_version'),
  source_content_hash: text('source_content_hash'),
  pipeline_version: text('pipeline_version'),
  source_policy_version: text('source_policy_version'),
  generation_status: text('generation_status', { enum: ['queued', 'running', 'ready', 'unavailable', 'failed'] }).notNull(),
  attempt_count: integer('attempt_count').notNull().default(0),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }),
  lease_token: uuid('lease_token'),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  deadline_at: timestamp('deadline_at', { withTimezone: true }),
  transcript_ready_at: timestamp('transcript_ready_at', { withTimezone: true }),
  sla_missed_at: timestamp('sla_missed_at', { withTimezone: true }),
  failure_code: text('failure_code'),
  version: integer('version').notNull().default(1),
  visibility: text('visibility', { enum: ['unpublished', 'published', 'hidden', 'deleted'] }).notNull().default('unpublished'),
  draft_revision_id: uuid('draft_revision_id'),
  draft_status: text('draft_status', { enum: ['pending', 'rejected'] }),
  published_revision_id: uuid('published_revision_id'),
  published_at: timestamp('published_at', { withTimezone: true }),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
}, (table): import('drizzle-orm/pg-core').PgTableExtraConfigValue[] => [
  foreignKey({ name: 'minutes_draft_revision_fk', columns: [table.meeting_id, table.draft_revision_id],
    foreignColumns: [meetingMinuteRevisions.meeting_id, meetingMinuteRevisions.id] }),
  foreignKey({ name: 'minutes_published_revision_fk', columns: [table.meeting_id, table.published_revision_id],
    foreignColumns: [meetingMinuteRevisions.meeting_id, meetingMinuteRevisions.id] }),
  check('minutes_state_check', sql`
    ${table.version} > 0 AND ${table.attempt_count} >= 0
    AND ${table.source_kind} IN ('meet_transcript','notes','none')
    AND ${table.generation_status} IN ('queued','running','ready','unavailable','failed')
    AND ${table.visibility} IN ('unpublished','published','hidden','deleted')
    AND (${table.draft_status} IS NULL OR ${table.draft_status} IN ('pending','rejected'))
    AND (${table.draft_revision_id} IS NULL) = (${table.draft_status} IS NULL)
    AND (${table.published_revision_id} IS NULL) = (${table.published_at} IS NULL)
    AND (${table.visibility} NOT IN ('published','hidden') OR ${table.published_revision_id} IS NOT NULL)
    AND (${table.visibility} = 'deleted') = (${table.deleted_at} IS NOT NULL)
    AND (${table.lease_token} IS NULL) = (${table.lease_until} IS NULL)
    AND (${table.visibility} = 'deleted' OR (${table.generation_status} = 'running') = (${table.lease_token} IS NOT NULL))
    AND (${table.generation_status} <> 'queued' OR ${table.next_attempt_at} IS NOT NULL)
  `),
  index('minutes_pending_idx').on(table.next_attempt_at).where(sql`${table.generation_status} = 'queued'`),
  index('minutes_leases_idx').on(table.lease_until).where(sql`${table.generation_status} = 'running'`),
  index('minutes_published_idx').on(table.published_at.desc(), table.meeting_id.desc())
    .where(sql`${table.visibility} = 'published'`),
]);

export const meetingMinuteRevisions = pgTable('meeting_minute_revisions', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetingMinutes.meeting_id),
  title: varchar('title', { length: 150 }).notNull(),
  body: text('body').notNull(),
  source_kind: text('source_kind', { enum: ['meet_transcript', 'notes', 'none'] }).notNull(),
  created_by_user_id: bigint('created_by_user_id', { mode: 'bigint' }).references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  generation_provenance: jsonb('generation_provenance').$type<{ sourceKind: 'notes' | 'meet_transcript'; sourceHash: string; pipelineVersion: string; transcriptId?: string; transcriptVersion?: number; policyVersion?: string }>(),
}, table => [
  unique('minute_revisions_meeting_id_unique').on(table.meeting_id, table.id),
  check('minute_revision_content_check', sql`
    char_length(${table.body}) BETWEEN 1 AND 32000 AND ${table.title} ~ '[^[:space:]]'
    AND ${table.source_kind} IN ('meet_transcript','notes','none')
  `),
]);


export const meetingMinuteEvents = pgTable('meeting_minute_events', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetingMinutes.meeting_id),
  actor_user_id: bigint('actor_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  action: text('action', { enum: ['edit', 'publish', 'reject', 'hide', 'delete'] }).notNull(),
  revision_id: uuid('revision_id'),
  from_visibility: text('from_visibility', { enum: ['unpublished', 'published', 'hidden'] }).notNull(),
  to_visibility: text('to_visibility', { enum: ['unpublished', 'published', 'hidden', 'deleted'] }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  resulting_version: integer('resulting_version').notNull(),
}, table => [
  foreignKey({ name: 'minute_events_revision_fk', columns: [table.meeting_id, table.revision_id],
    foreignColumns: [meetingMinuteRevisions.meeting_id, meetingMinuteRevisions.id] }),
  unique('minute_events_version_unique').on(table.meeting_id, table.resulting_version),
  check('minute_events_state_check', sql`
    ${table.resulting_version} > 1
    AND ${table.action} IN ('edit','publish','reject','hide','delete')
    AND ${table.from_visibility} IN ('unpublished','published','hidden')
    AND ${table.to_visibility} IN ('unpublished','published','hidden','deleted')
    AND (${table.revision_id} IS NULL) = (${table.action} = 'delete')
  `),
]);

export const meetingTranscriptionConsents = pgTable('meeting_transcription_consents', {
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  policy_version: varchar('policy_version', { length: 80 }).notNull(),
  accepted_at: timestamp('accepted_at', { withTimezone: true }).notNull(),
}, table => [primaryKey({ columns: [table.meeting_id, table.user_id, table.policy_version] })]);

export const meetingActionItems = pgTable('meeting_action_items', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  agenda_item_id: uuid('agenda_item_id'),
  poll_id: uuid('poll_id'),
  description: varchar('description', { length: 500 }).notNull(),
  due_on: date('due_on', { mode: 'string' }).notNull(),
  due_revision: integer('due_revision').notNull().default(1),
  status: text('status', { enum: ['open', 'completed', 'cancelled'] }).notNull().default('open'),
  version: integer('version').notNull().default(1),
  created_by_user_id: bigint('created_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  closed_by_user_id: bigint('closed_by_user_id', { mode: 'bigint' }).references(() => users.id),
  closed_at: timestamp('closed_at', { withTimezone: true }),
}, table => [
  foreignKey({ name: 'action_items_agenda_scope_fk', columns: [table.meeting_id, table.agenda_item_id],
    foreignColumns: [meetingAgendaItems.meeting_id, meetingAgendaItems.id] }),
  foreignKey({ name: 'action_items_poll_scope_fk', columns: [table.meeting_id, table.poll_id],
    foreignColumns: [meetingPolls.meeting_id, meetingPolls.id] }),
  index('action_items_meeting_idx').on(table.meeting_id, table.id),
  check('action_items_state_check', sql`
    (${table.agenda_item_id} IS NULL) <> (${table.poll_id} IS NULL)
    AND ${table.description} ~ '[^[:space:]]' AND ${table.version} >= ${table.due_revision} AND ${table.due_revision} > 0
    AND ${table.status} IN ('open','completed','cancelled')
    AND (${table.closed_by_user_id} IS NULL) = (${table.closed_at} IS NULL)
    AND (${table.status} = 'open') = (${table.closed_at} IS NULL)
    AND ${table.updated_at} >= ${table.created_at}
    AND (${table.closed_at} IS NULL OR ${table.closed_at} BETWEEN ${table.created_at} AND ${table.updated_at})
  `),
]);

export const meetingActionAssignments = pgTable('meeting_action_assignments', {
  id: uuid('id').primaryKey(),
  action_item_id: uuid('action_item_id').notNull().references(() => meetingActionItems.id),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  proposed_by_user_id: bigint('proposed_by_user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  state: text('state', { enum: ['pending', 'accepted', 'declined', 'withdrawn'] }).notNull().default('pending'),
  proposed_at: timestamp('proposed_at', { withTimezone: true }).notNull(),
  responded_at: timestamp('responded_at', { withTimezone: true }),
  withdrawn_at: timestamp('withdrawn_at', { withTimezone: true }),
}, table => [
  index('action_assignments_history_idx').on(table.action_item_id, table.id),
  uniqueIndex('action_assignments_active_unique').on(table.action_item_id, table.user_id)
    .where(sql`${table.state} IN ('pending','accepted')`),
  check('action_assignments_state_check', sql`
    ${table.state} IN ('pending','accepted','declined','withdrawn')
    AND (${table.state} = 'pending') = (${table.responded_at} IS NULL)
    AND (${table.state} = 'withdrawn') = (${table.withdrawn_at} IS NOT NULL)
    AND (${table.responded_at} IS NULL OR ${table.responded_at} >= ${table.proposed_at})
    AND (${table.withdrawn_at} IS NULL OR ${table.withdrawn_at} >= ${table.responded_at})
  `),
]);

export const actionItemEmailJobs = pgTable('action_item_email_jobs', {
  id: uuid('id').primaryKey(),
  assignment_id: uuid('assignment_id').notNull().references(() => meetingActionAssignments.id),
  kind: text('kind', { enum: ['assigned', 'reminder_week', 'reminder_due'] }).notNull(),
  due_revision: integer('due_revision').notNull(),
  status: text('status', { enum: ['queued', 'running', 'sent', 'suppressed', 'failed', 'uncertain'] }).notNull().default('queued'),
  event_at: timestamp('event_at', { withTimezone: true }).notNull(),
  available_at: timestamp('available_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
  attempt_count: integer('attempt_count').notNull().default(0),
  lease_token: uuid('lease_token'),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  dispatch_started_at: timestamp('dispatch_started_at', { withTimezone: true }),
  sent_at: timestamp('sent_at', { withTimezone: true }),
  failure_code: varchar('failure_code', { length: 40 }),
}, table => [
  unique('action_item_email_occurrence_unique').on(table.assignment_id, table.kind, table.due_revision),
  index('action_item_email_queue_idx').on(table.available_at, table.id).where(sql`${table.status} = 'queued'`),
  index('action_item_email_lease_idx').on(table.lease_until, table.id).where(sql`${table.status} = 'running'`),
  check('action_item_email_state_check', sql`
    (${table.kind} = 'assigned' AND ${table.due_revision} = 0)
    OR (${table.kind} IN ('reminder_week','reminder_due') AND ${table.due_revision} > 0)
  `),
  check('action_item_email_lifecycle_check', sql`
    ${table.status} IN ('queued','running','sent','suppressed','failed','uncertain')
    AND (${table.status} = 'running') = (${table.lease_token} IS NOT NULL)
    AND (${table.lease_token} IS NULL) = (${table.lease_until} IS NULL)
    AND (${table.status} = 'sent') = (${table.sent_at} IS NOT NULL)
    AND (${table.status} <> 'queued' OR ${table.dispatch_started_at} IS NULL)
    AND ${table.attempt_count} BETWEEN 0 AND 5
    AND ${table.created_at} <= ${table.event_at}
    AND ${table.event_at} <= ${table.available_at} AND ${table.available_at} < ${table.expires_at}
    AND (${table.sent_at} IS NULL OR ${table.sent_at} >= ${table.dispatch_started_at})
    AND (${table.dispatch_started_at} IS NULL OR ${table.dispatch_started_at} >= ${table.event_at})
    AND (${table.status} <> 'sent' OR ${table.dispatch_started_at} IS NOT NULL)
  `),
]);

export const legislativeBillVotes = pgTable('legislative_bill_votes', {
  bill_id: uuid('bill_id').notNull().references(() => legislativeBills.id),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  choice: text('choice', { enum: ['for', 'against'] }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull(),
}, table => [
  primaryKey({ columns: [table.bill_id, table.user_id] }),
  check('legislative_bill_vote_choice_check', sql`${table.choice} IN ('for','against')`),
]);

export const legislativeMinuteInsights = pgTable('legislative_minute_insights', {
  revision_id: uuid('revision_id').notNull().references(() => meetingMinuteRevisions.id),
  pipeline_version: text('pipeline_version').notNull(),
  points: jsonb('points').$type<import('../modules/legislative-compendia/compendium-synthesis').Insight[]>().notNull(),
  generated_at: timestamp('generated_at', { withTimezone: true }).notNull(),
}, table => [primaryKey({ columns: [table.revision_id, table.pipeline_version] })]);

export const legislativeCompendiumSummaries = pgTable('legislative_compendium_summaries', {
  bill_id: uuid('bill_id').primaryKey().references(() => legislativeBills.id),
  state: text('state', { enum: ['queued', 'running', 'ready', 'failed'] }).notNull(),
  source_hash: text('source_hash').notNull(),
  pipeline_version: text('pipeline_version').notNull(),
  payload: jsonb('payload').$type<import('../modules/legislative-compendia/compendium-synthesis').Topic[]>(),
  generated_at: timestamp('generated_at', { withTimezone: true }),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  lease_token: uuid('lease_token'),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  failure_code: text('failure_code'),
}, table => [
  index('compendium_summary_queue_idx').on(table.next_attempt_at).where(sql`${table.state} = 'queued'`),
  index('compendium_summary_leases_idx').on(table.lease_until).where(sql`${table.state} = 'running'`),
  check('compendium_summary_state_check', sql`
    ${table.state} IN ('queued','running','ready','failed') AND ${table.attempts} >= 0
    AND (${table.state} = 'running') = (${table.lease_token} IS NOT NULL)
    AND (${table.lease_token} IS NULL) = (${table.lease_until} IS NULL)
    AND (${table.state} = 'ready') = (${table.payload} IS NOT NULL)
    AND (${table.payload} IS NULL) = (${table.generated_at} IS NULL)
  `),
]);


/** One durable Calendar intent per local meeting; I/O runs outside its lease transaction. */
export const meetingGoogleIntegrations = pgTable('meeting_google_integrations', {
  meeting_id: uuid('meeting_id').primaryKey().references(() => meetings.id),
  state: text('state', { enum: ['configuration_pending', 'scheduled', 'provisioning', 'ready', 'failed', 'cancelled'] }).notNull().default('configuration_pending'),
  agenda_state: text('agenda_state', { enum: ['pending', 'synced', 'failed', 'cancelled'] }).notNull().default('pending'),
  calendar_id: text('calendar_id'),
  event_id: text('event_id'),
  event_etag: text('event_etag'),
  conference_request_id: uuid('conference_request_id'),
  desired_version: integer('desired_version').notNull().default(1),
  applied_version: integer('applied_version').notNull().default(0),
  link_due_at: timestamp('link_due_at', { withTimezone: true }),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  lease_token: uuid('lease_token'),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  failure_code: text('failure_code'),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('meeting_google_event_unique').on(table.calendar_id, table.event_id),
  check('meeting_google_state_check', sql`${table.state} IN ('configuration_pending','scheduled','provisioning','ready','failed','cancelled') AND ${table.agenda_state} IN ('pending','synced','failed','cancelled')`),
  check('meeting_google_versions_check', sql`${table.desired_version} > 0 AND ${table.applied_version} >= 0 AND ${table.applied_version} <= ${table.desired_version} AND ${table.attempts} >= 0`),
  check('meeting_google_lease_check', sql`(${table.lease_token} IS NULL) = (${table.lease_until} IS NULL)`),
  index('meeting_google_queue_idx').on(table.next_attempt_at),
]);

/** Discovery/import state is separate from immutable available snapshots and AI jobs. */
export const meetingTranscriptImports = pgTable('meeting_transcript_imports', {
  meeting_id: uuid('meeting_id').primaryKey().references(() => meetings.id),
  state: text('state', { enum: ['pending', 'processing', 'available', 'unavailable', 'failed'] }).notNull().default('pending'),
  schedule_version: integer('schedule_version').notNull(),
  space_name: text('space_name').notNull(),
  policy_version: text('policy_version').notNull(),
  conference_name: text('conference_name'),
  conference_ended_at: timestamp('conference_ended_at', { withTimezone: true }),
  deadline_at: timestamp('deadline_at', { withTimezone: true }).notNull(),
  next_attempt_at: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consecutive_failures: integer('consecutive_failures').notNull().default(0),
  lease_token: uuid('lease_token'),
  lease_until: timestamp('lease_until', { withTimezone: true }),
  failure_code: text('failure_code'),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check('transcript_import_state_check', sql`${table.state} IN ('pending','processing','available','unavailable','failed') AND ${table.schedule_version} > 0 AND ${table.attempts} >= 0 AND ${table.consecutive_failures} >= 0`),
  check('transcript_import_lease_check', sql`(${table.lease_token} IS NULL) = (${table.lease_until} IS NULL)`),
  index('transcript_import_queue_idx').on(table.next_attempt_at),
]);

export const meetingTranscriptSnapshots = pgTable('meeting_transcript_snapshots', {
  id: uuid('id').primaryKey(),
  meeting_id: uuid('meeting_id').notNull().references(() => meetings.id),
  version: integer('version').notNull(),
  content_hash: text('content_hash').notNull(),
  normalization_version: text('normalization_version').notNull(),
  conference_name: text('conference_name').notNull(),
  provider_transcript_names: text('provider_transcript_names').array().notNull(),
  conference_ended_at: timestamp('conference_ended_at', { withTimezone: true }).notNull(),
  policy_version: text('policy_version').notNull(),
  entries: jsonb('entries').$type<import('../modules/meeting-transcripts/transcript.contract').TranscriptEntry[]>().notNull(),
  docx_storage_key: text('docx_storage_key').notNull(),
  docx_hash: text('docx_hash').notNull(),
  docx_bytes: integer('docx_bytes').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique('transcript_snapshot_version_unique').on(table.meeting_id, table.version),
  unique('transcript_snapshot_hash_unique').on(table.meeting_id, table.content_hash),
  check('transcript_snapshot_content_check', sql`${table.version} > 0 AND ${table.docx_bytes} > 0 AND jsonb_typeof(${table.entries}) = 'array' AND jsonb_array_length(${table.entries}) > 0 AND cardinality(${table.provider_transcript_names}) > 0`),
]);
