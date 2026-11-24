CREATE TABLE "action_item_email_jobs" (
	"id" uuid PRIMARY KEY,
	"assignment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_revision" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"dispatch_started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failure_code" varchar(40),
	CONSTRAINT "action_item_email_occurrence_unique" UNIQUE("assignment_id","kind","due_revision"),
	CONSTRAINT "action_item_email_state_check" CHECK (
    ("kind" = 'assigned' AND "due_revision" = 0)
    OR ("kind" IN ('reminder_week','reminder_due') AND "due_revision" > 0)
  ),
	CONSTRAINT "action_item_email_lifecycle_check" CHECK (
    "status" IN ('queued','running','sent','suppressed','failed','uncertain')
    AND ("status" = 'running') = ("lease_token" IS NOT NULL)
    AND ("lease_token" IS NULL) = ("lease_until" IS NULL)
    AND ("status" = 'sent') = ("sent_at" IS NOT NULL)
    AND ("status" <> 'queued' OR "dispatch_started_at" IS NULL)
    AND "attempt_count" BETWEEN 0 AND 5
    AND "created_at" <= "event_at"
    AND "event_at" <= "available_at" AND "available_at" < "expires_at"
    AND ("sent_at" IS NULL OR "sent_at" >= "dispatch_started_at")
    AND ("dispatch_started_at" IS NULL OR "dispatch_started_at" >= "event_at")
    AND ("status" <> 'sent' OR "dispatch_started_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX "action_item_email_queue_idx" ON "action_item_email_jobs" ("available_at","id") WHERE "status" = 'queued';--> statement-breakpoint
CREATE INDEX "action_item_email_lease_idx" ON "action_item_email_jobs" ("lease_until","id") WHERE "status" = 'running';--> statement-breakpoint
ALTER TABLE "action_item_email_jobs" ADD CONSTRAINT "action_item_email_jobs_aSFOiuvrgyxQ_fkey" FOREIGN KEY ("assignment_id") REFERENCES "meeting_action_assignments"("id");