CREATE TYPE "meeting_access_mode" AS ENUM('public', 'group', 'selected');--> statement-breakpoint
CREATE TYPE "meeting_participant_origin" AS ENUM('creator', 'group', 'invitation');--> statement-breakpoint
CREATE TYPE "meeting_participant_status" AS ENUM('confirmed', 'pending', 'declined');--> statement-breakpoint
CREATE TABLE "meeting_participants" (
	"meeting_id" uuid,
	"user_id" bigint,
	"origin" "meeting_participant_origin" NOT NULL,
	"status" "meeting_participant_status" NOT NULL,
	"is_moderator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "meeting_participants_pkey" PRIMARY KEY("meeting_id","user_id"),
	CONSTRAINT "meeting_participants_origin_status_check" CHECK ("origin" = 'invitation' OR "status" = 'confirmed'),
	CONSTRAINT "meeting_participants_moderator_confirmed_check" CHECK (NOT "is_moderator" OR "status" = 'confirmed'),
	CONSTRAINT "meeting_participants_resolution_check" CHECK (
    ("resolved_at" IS NOT NULL) = ("origin" = 'invitation' AND "status" <> 'pending')
    AND ("resolved_at" IS NULL OR "resolved_at" >= "created_at")
  )
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY,
	"subject" varchar(150) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"organizer_user_id" bigint NOT NULL,
	"group_id" uuid,
	"access_mode" "meeting_access_mode" NOT NULL,
	CONSTRAINT "meetings_subject_not_blank_check" CHECK ("subject" ~ '[^[:space:]]'),
	CONSTRAINT "meetings_starts_after_creation_check" CHECK ("starts_at" > "created_at"),
	CONSTRAINT "meetings_group_access_check" CHECK ("access_mode" <> 'group' OR "group_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "meeting_participants_user_meeting_idx" ON "meeting_participants" ("user_id","meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_starts_at_id_idx" ON "meetings" ("starts_at","id");--> statement-breakpoint
CREATE INDEX "meetings_group_id_idx" ON "meetings" ("group_id");--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD CONSTRAINT "meeting_participants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_user_id_users_id_fkey" FOREIGN KEY ("organizer_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id");