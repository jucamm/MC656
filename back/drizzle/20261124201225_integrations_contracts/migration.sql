CREATE TABLE "meeting_google_integrations" (
	"meeting_id" uuid PRIMARY KEY,
	"state" text DEFAULT 'configuration_pending' NOT NULL,
	"agenda_state" text DEFAULT 'pending' NOT NULL,
	"calendar_id" text,
	"event_id" text,
	"event_etag" text,
	"conference_request_id" uuid,
	"desired_version" integer DEFAULT 1 NOT NULL,
	"applied_version" integer DEFAULT 0 NOT NULL,
	"link_due_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"failure_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_google_event_unique" UNIQUE("calendar_id","event_id"),
	CONSTRAINT "meeting_google_state_check" CHECK ("state" IN ('configuration_pending','scheduled','provisioning','ready','failed','cancelled') AND "agenda_state" IN ('pending','synced','failed','cancelled')),
	CONSTRAINT "meeting_google_versions_check" CHECK ("desired_version" > 0 AND "applied_version" >= 0 AND "applied_version" <= "desired_version" AND "attempts" >= 0),
	CONSTRAINT "meeting_google_lease_check" CHECK (("lease_token" IS NULL) = ("lease_until" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "meeting_transcript_imports" (
	"meeting_id" uuid PRIMARY KEY,
	"state" text DEFAULT 'pending' NOT NULL,
	"schedule_version" integer NOT NULL,
	"space_name" text NOT NULL,
	"policy_version" text NOT NULL,
	"conference_name" text,
	"conference_ended_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"failure_code" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_import_state_check" CHECK ("state" IN ('pending','processing','available','unavailable','failed') AND "schedule_version" > 0 AND "attempts" >= 0 AND "consecutive_failures" >= 0),
	CONSTRAINT "transcript_import_lease_check" CHECK (("lease_token" IS NULL) = ("lease_until" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "meeting_transcript_snapshots" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"normalization_version" text NOT NULL,
	"conference_name" text NOT NULL,
	"provider_transcript_names" text[] NOT NULL,
	"conference_ended_at" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"entries" jsonb NOT NULL,
	"docx_storage_key" text NOT NULL,
	"docx_hash" text NOT NULL,
	"docx_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transcript_snapshot_version_unique" UNIQUE("meeting_id","version"),
	CONSTRAINT "transcript_snapshot_hash_unique" UNIQUE("meeting_id","content_hash"),
	CONSTRAINT "transcript_snapshot_content_check" CHECK ("version" > 0 AND "docx_bytes" > 0 AND jsonb_typeof("entries") = 'array' AND jsonb_array_length("entries") > 0 AND cardinality("provider_transcript_names") > 0)
);
--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD COLUMN "provisioning" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_minute_revisions" ADD COLUMN "generation_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "source_transcript_id" uuid;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "source_transcript_version" integer;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "source_content_hash" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "pipeline_version" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "source_policy_version" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "scheduled_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "schedule_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ALTER COLUMN "google_meet_url" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "meeting_google_queue_idx" ON "meeting_google_integrations" ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "transcript_import_queue_idx" ON "meeting_transcript_imports" ("next_attempt_at");--> statement-breakpoint
ALTER TABLE "meeting_google_integrations" ADD CONSTRAINT "meeting_google_integrations_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_8iEBAbNEeexN_fkey" FOREIGN KEY ("source_transcript_id") REFERENCES "meeting_transcript_snapshots"("id");--> statement-breakpoint
ALTER TABLE "meeting_transcript_imports" ADD CONSTRAINT "meeting_transcript_imports_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_transcript_snapshots" ADD CONSTRAINT "meeting_transcript_snapshots_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD CONSTRAINT "meeting_provisioning_check" CHECK ("provisioning" IN ('manual','automatic') AND ("provisioning" = 'automatic' OR "google_meet_url" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_schedule_check" CHECK ("schedule_version" > 0 AND ("scheduled_ends_at" IS NULL OR "scheduled_ends_at" > "starts_at") AND ("cancelled_at" IS NULL OR "ended_at" IS NULL));