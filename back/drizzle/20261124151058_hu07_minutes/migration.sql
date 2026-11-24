CREATE TABLE "meeting_minute_revisions" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"title" varchar(150) NOT NULL,
	"body" text NOT NULL,
	"source_kind" text NOT NULL,
	"created_by_user_id" bigint,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "minute_revisions_meeting_id_unique" UNIQUE("meeting_id","id"),
	CONSTRAINT "minute_revision_content_check" CHECK (
    char_length("body") BETWEEN 1 AND 32000 AND "title" ~ '[^[:space:]]'
    AND "source_kind" IN ('meet_transcript','notes','none')
  )
);
--> statement-breakpoint
CREATE TABLE "meeting_minutes" (
	"meeting_id" uuid PRIMARY KEY,
	"source_kind" text NOT NULL,
	"source_space_name" text UNIQUE,
	"conference_name" text UNIQUE,
	"source_transcripts" text[],
	"source_notes" text,
	"generation_status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"transcript_ready_at" timestamp with time zone,
	"sla_missed_at" timestamp with time zone,
	"failure_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'unpublished' NOT NULL,
	"draft_revision_id" uuid,
	"draft_status" text,
	"published_revision_id" uuid,
	"published_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "minutes_state_check" CHECK (
    "version" > 0 AND "attempt_count" >= 0
    AND "source_kind" IN ('meet_transcript','notes','none')
    AND "generation_status" IN ('queued','running','ready','unavailable','failed')
    AND "visibility" IN ('unpublished','published','hidden','deleted')
    AND ("draft_status" IS NULL OR "draft_status" IN ('pending','rejected'))
    AND ("draft_revision_id" IS NULL) = ("draft_status" IS NULL)
    AND ("published_revision_id" IS NULL) = ("published_at" IS NULL)
    AND ("visibility" NOT IN ('published','hidden') OR "published_revision_id" IS NOT NULL)
    AND ("visibility" = 'deleted') = ("deleted_at" IS NOT NULL)
    AND ("lease_token" IS NULL) = ("lease_until" IS NULL)
    AND ("visibility" = 'deleted' OR ("generation_status" = 'running') = ("lease_token" IS NOT NULL))
    AND ("generation_status" <> 'queued' OR "next_attempt_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "minutes_pending_idx" ON "meeting_minutes" ("next_attempt_at") WHERE "generation_status" = 'queued';--> statement-breakpoint
CREATE INDEX "minutes_leases_idx" ON "meeting_minutes" ("lease_until") WHERE "generation_status" = 'running';--> statement-breakpoint
CREATE INDEX "minutes_published_idx" ON "meeting_minutes" ("published_at" DESC NULLS LAST,"meeting_id" DESC NULLS LAST) WHERE "visibility" = 'published';--> statement-breakpoint
ALTER TABLE "meeting_minute_revisions" ADD CONSTRAINT "meeting_minute_revisions_lGSsRgc5Zapr_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_minutes"("meeting_id");--> statement-breakpoint
ALTER TABLE "meeting_minute_revisions" ADD CONSTRAINT "meeting_minute_revisions_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "minutes_draft_revision_fk" FOREIGN KEY ("meeting_id","draft_revision_id") REFERENCES "meeting_minute_revisions"("meeting_id","id");--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "minutes_published_revision_fk" FOREIGN KEY ("meeting_id","published_revision_id") REFERENCES "meeting_minute_revisions"("meeting_id","id");