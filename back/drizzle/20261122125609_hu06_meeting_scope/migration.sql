CREATE TABLE "meeting_participation_blocks" (
	"meeting_id" uuid,
	"user_id" bigint,
	"blocked_by_user_id" bigint NOT NULL,
	"blocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "meeting_participation_blocks_pkey" PRIMARY KEY("meeting_id","user_id"),
	CONSTRAINT "meeting_participation_blocks_actor_check" CHECK ("user_id" <> "blocked_by_user_id")
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "ended_by_user_id" bigint;--> statement-breakpoint
ALTER TABLE "meeting_participation_blocks" ADD CONSTRAINT "meeting_participation_blocks_blocked_by_user_id_users_id_fkey" FOREIGN KEY ("blocked_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_participation_blocks" ADD CONSTRAINT "meeting_participation_blocks_target_fk" FOREIGN KEY ("meeting_id","user_id") REFERENCES "meeting_participants"("meeting_id","user_id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_ended_by_user_id_users_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_end_state_check" CHECK (
    ("ended_at" IS NULL) = ("ended_by_user_id" IS NULL)
    AND ("ended_at" IS NULL OR "ended_at" >= "starts_at")
  );