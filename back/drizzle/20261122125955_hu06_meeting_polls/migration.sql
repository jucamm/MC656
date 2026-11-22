CREATE TABLE "meeting_polls" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"question" varchar(150) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opened_by_user_id" bigint NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" bigint,
	CONSTRAINT "meeting_polls_question_not_blank_check" CHECK ("question" ~ '[^[:space:]]'),
	CONSTRAINT "meeting_polls_close_state_check" CHECK (
    ("closed_at" IS NULL) = ("closed_by_user_id" IS NULL)
    AND ("closed_at" IS NULL OR "closed_at" >= "opened_at")
  )
);
--> statement-breakpoint
CREATE INDEX "meeting_polls_meeting_id_idx" ON "meeting_polls" ("meeting_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_polls_one_open_idx" ON "meeting_polls" ("meeting_id") WHERE "closed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "meeting_polls_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "meeting_polls_opened_by_user_id_users_id_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_polls" ADD CONSTRAINT "meeting_polls_closed_by_user_id_users_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id");