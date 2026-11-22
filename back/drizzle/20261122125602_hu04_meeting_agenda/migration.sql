CREATE TABLE "meeting_agenda_items" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"proposed_by_user_id" bigint NOT NULL,
	"subject" varchar(150) NOT NULL,
	"context" varchar(4000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" bigint,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "meeting_agenda_items_text_check" CHECK ("subject" ~ '[^[:space:]]' AND "context" ~ '[^[:space:]]'),
	CONSTRAINT "meeting_agenda_items_review_check" CHECK (
    ("review_status" = 'pending' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL)
    OR ("review_status" IN ('approved', 'rejected') AND "reviewed_by_user_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL AND "reviewed_at" >= "created_at")
  )
);
--> statement-breakpoint
CREATE INDEX "meeting_agenda_items_meeting_id_idx" ON "meeting_agenda_items" ("meeting_id","id");--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_proposed_by_user_id_users_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_reviewed_by_user_id_users_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id");