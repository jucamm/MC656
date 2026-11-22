CREATE TYPE "meeting_organizer_transfer_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TABLE "meeting_organizer_transfers" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"requested_by_user_id" bigint NOT NULL,
	"recipient_user_id" bigint NOT NULL,
	"status" "meeting_organizer_transfer_status" DEFAULT 'pending'::"meeting_organizer_transfer_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "meeting_organizer_transfers_distinct_users_check" CHECK ("requested_by_user_id" <> "recipient_user_id"),
	CONSTRAINT "meeting_organizer_transfers_resolution_check" CHECK (
    ("status" = 'pending') = ("resolved_at" IS NULL)
    AND ("resolved_at" IS NULL OR "resolved_at" >= "requested_at")
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_organizer_transfers_pending_idx" ON "meeting_organizer_transfers" ("meeting_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "meeting_organizer_transfers_recipient_idx" ON "meeting_organizer_transfers" ("recipient_user_id","id") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "meeting_organizer_transfers" ADD CONSTRAINT "meeting_organizer_transfers_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_organizer_transfers" ADD CONSTRAINT "meeting_organizer_transfers_requested_by_user_id_users_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_organizer_transfers" ADD CONSTRAINT "meeting_organizer_transfers_recipient_fk" FOREIGN KEY ("meeting_id","recipient_user_id") REFERENCES "meeting_participants"("meeting_id","user_id");