CREATE TYPE "account_status" AS ENUM('pending', 'verified');--> statement-breakpoint
CREATE TYPE "rate_limit_window" AS ENUM('hour', 'day');--> statement-breakpoint
CREATE TYPE "verification_channel" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TABLE "authentication_sessions" (
	"id" uuid PRIMARY KEY,
	"user_id" bigint NOT NULL,
	"token_hash" varchar(64) NOT NULL UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "authentication_sessions_expiry_check" CHECK ("expires_at" > "last_activity_at")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"user_id" bigint,
	"channel" "verification_channel",
	"window_type" "rate_limit_window",
	"window_started_at" timestamp with time zone NOT NULL,
	"window_expires_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("user_id","channel","window_type"),
	CONSTRAINT "rate_limits_count_check" CHECK ("request_count" >= 0),
	CONSTRAINT "rate_limits_window_check" CHECK ("window_expires_at" > "window_started_at"),
	CONSTRAINT "rate_limits_daily_block_check" CHECK ("blocked_until" IS NULL OR "window_type" = 'day')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY,
	"name" varchar(150) NOT NULL,
	"email" varchar(254) NOT NULL UNIQUE,
	"phone" varchar(20) NOT NULL,
	"password_hash" text NOT NULL,
	"status" "account_status" DEFAULT 'pending'::"account_status" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_verification_status_check" CHECK (
    ("status" = 'verified') =
    ("email_verified_at" IS NOT NULL AND "phone_verified_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "verification_challenges" (
	"id" uuid PRIMARY KEY,
	"user_id" bigint NOT NULL,
	"channel" "verification_channel" NOT NULL,
	"code_hmac" varchar(64) NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "verification_challenges_user_channel_unique" UNIQUE("user_id","channel"),
	CONSTRAINT "verification_challenges_attempts_check" CHECK ("failed_attempts" BETWEEN 0 AND 3),
	CONSTRAINT "verification_challenges_expiry_check" CHECK ("expires_at" > "issued_at")
);
--> statement-breakpoint
CREATE INDEX "authentication_sessions_user_id_idx" ON "authentication_sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" ("phone");--> statement-breakpoint
ALTER TABLE "authentication_sessions" ADD CONSTRAINT "authentication_sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "verification_challenges" ADD CONSTRAINT "verification_challenges_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");