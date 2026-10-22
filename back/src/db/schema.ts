import { sql } from 'drizzle-orm';
import {
  bigint, bigserial, check, index, integer, pgEnum, pgTable,
  primaryKey, text, timestamp, unique, uuid, varchar,
} from 'drizzle-orm/pg-core';

export const accountStatus = pgEnum('account_status', ['pending', 'verified']);
export const verificationChannel = pgEnum('verification_channel', ['email', 'phone']);
export const rateLimitWindow = pgEnum('rate_limit_window', ['hour', 'day']);

export const users = pgTable('users', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  phone: varchar('phone', { length: 20 }).notNull(),
  password_hash: text('password_hash').notNull(),
  status: accountStatus('status').notNull().default('pending'),
  email_verified_at: timestamp('email_verified_at', { withTimezone: true }),
  phone_verified_at: timestamp('phone_verified_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('users_verification_status_check', sql`
    (${table.status} = 'verified') =
    (${table.email_verified_at} IS NOT NULL AND ${table.phone_verified_at} IS NOT NULL)
  `),
  index('users_phone_idx').on(table.phone),
]);

export const authenticationSessions = pgTable('authentication_sessions', {
  id: uuid('id').primaryKey(),
  user_id: bigint('user_id', { mode: 'bigint' }).notNull().references(() => users.id),
  token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  last_activity_at: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  check('authentication_sessions_expiry_check', sql`${table.expires_at} > ${table.last_activity_at}`),
  index('authentication_sessions_user_id_idx').on(table.user_id),
]);

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
  unique('verification_challenges_user_channel_unique').on(table.user_id, table.channel),
  check('verification_challenges_attempts_check', sql`${table.failed_attempts} BETWEEN 0 AND 3`),
  check('verification_challenges_expiry_check', sql`${table.expires_at} > ${table.issued_at}`),
]);

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
  check('rate_limits_daily_block_check', sql`${table.blocked_until} IS NULL OR ${table.window_type} = 'day'`),
]);
