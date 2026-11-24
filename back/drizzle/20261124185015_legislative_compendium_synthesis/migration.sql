CREATE TABLE "legislative_compendium_summaries" (
	"bill_id" uuid PRIMARY KEY,
	"state" text NOT NULL,
	"source_hash" text NOT NULL,
	"pipeline_version" text NOT NULL,
	"payload" jsonb,
	"generated_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"failure_code" text,
	CONSTRAINT "compendium_summary_state_check" CHECK (
    "state" IN ('queued','running','ready','failed') AND "attempts" >= 0
    AND ("state" = 'running') = ("lease_token" IS NOT NULL)
    AND ("lease_token" IS NULL) = ("lease_until" IS NULL)
    AND ("state" = 'ready') = ("payload" IS NOT NULL)
    AND ("payload" IS NULL) = ("generated_at" IS NULL)
  )
);
--> statement-breakpoint
CREATE TABLE "legislative_minute_insights" (
	"revision_id" uuid,
	"pipeline_version" text,
	"points" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legislative_minute_insights_pkey" PRIMARY KEY("revision_id","pipeline_version")
);
--> statement-breakpoint
CREATE INDEX "compendium_summary_queue_idx" ON "legislative_compendium_summaries" ("next_attempt_at") WHERE "state" = 'queued';--> statement-breakpoint
CREATE INDEX "compendium_summary_leases_idx" ON "legislative_compendium_summaries" ("lease_until") WHERE "state" = 'running';--> statement-breakpoint
ALTER TABLE "legislative_compendium_summaries" ADD CONSTRAINT "legislative_compendium_summaries_laCC1Pac7k6T_fkey" FOREIGN KEY ("bill_id") REFERENCES "legislative_bills"("id");--> statement-breakpoint
ALTER TABLE "legislative_minute_insights" ADD CONSTRAINT "legislative_minute_insights_ESZ1T0ltOXww_fkey" FOREIGN KEY ("revision_id") REFERENCES "meeting_minute_revisions"("id");