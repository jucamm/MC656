CREATE TABLE "meeting_action_assignments" (
	"id" uuid PRIMARY KEY,
	"action_item_id" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"proposed_by_user_id" bigint NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "action_assignments_state_check" CHECK (
    "state" IN ('pending','accepted','declined','withdrawn')
    AND ("state" = 'pending') = ("responded_at" IS NULL)
    AND ("state" = 'withdrawn') = ("withdrawn_at" IS NOT NULL)
    AND ("responded_at" IS NULL OR "responded_at" >= "proposed_at")
    AND ("withdrawn_at" IS NULL OR "withdrawn_at" >= "responded_at")
  )
);
--> statement-breakpoint
CREATE TABLE "meeting_action_items" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"agenda_item_id" uuid,
	"poll_id" uuid,
	"description" varchar(500) NOT NULL,
	"due_on" date NOT NULL,
	"due_revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_by_user_id" bigint,
	"closed_at" timestamp with time zone,
	CONSTRAINT "action_items_state_check" CHECK (
    ("agenda_item_id" IS NULL) <> ("poll_id" IS NULL)
    AND "description" ~ '[^[:space:]]' AND "version" >= "due_revision" AND "due_revision" > 0
    AND "status" IN ('open','completed','cancelled')
    AND ("closed_by_user_id" IS NULL) = ("closed_at" IS NULL)
    AND ("status" = 'open') = ("closed_at" IS NULL)
    AND "updated_at" >= "created_at"
    AND ("closed_at" IS NULL OR "closed_at" BETWEEN "created_at" AND "updated_at")
  )
);
--> statement-breakpoint
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "action_item_agenda_scope_unique" UNIQUE("meeting_id","id");--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "action_item_polls_scope_unique" UNIQUE("meeting_id","id");--> statement-breakpoint
CREATE INDEX "action_assignments_history_idx" ON "meeting_action_assignments" ("action_item_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_assignments_active_unique" ON "meeting_action_assignments" ("action_item_id","user_id") WHERE "state" IN ('pending','accepted');--> statement-breakpoint
CREATE INDEX "action_items_meeting_idx" ON "meeting_action_items" ("meeting_id","id");--> statement-breakpoint
ALTER TABLE "meeting_action_assignments" ADD CONSTRAINT "meeting_action_assignments_RZguiZXAcfO8_fkey" FOREIGN KEY ("action_item_id") REFERENCES "meeting_action_items"("id");--> statement-breakpoint
ALTER TABLE "meeting_action_assignments" ADD CONSTRAINT "meeting_action_assignments_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_action_assignments" ADD CONSTRAINT "meeting_action_assignments_proposed_by_user_id_users_id_fkey" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_closed_by_user_id_users_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "action_items_agenda_scope_fk" FOREIGN KEY ("meeting_id","agenda_item_id") REFERENCES "meeting_agenda_items"("meeting_id","id");--> statement-breakpoint
ALTER TABLE "meeting_action_items" ADD CONSTRAINT "action_items_poll_scope_fk" FOREIGN KEY ("meeting_id","poll_id") REFERENCES "meeting_polls"("meeting_id","id");