CREATE TABLE "meeting_transcription_consents" (
	"meeting_id" uuid,
	"user_id" bigint,
	"policy_version" varchar(80),
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "meeting_transcription_consents_pkey" PRIMARY KEY("meeting_id","user_id","policy_version")
);
--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD COLUMN "transcription_space_name" text;--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD COLUMN "transcription_policy_version" varchar(80);--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD CONSTRAINT "meeting_conferencing_transcription_space_name_key" UNIQUE("transcription_space_name");--> statement-breakpoint
ALTER TABLE "meeting_transcription_consents" ADD CONSTRAINT "meeting_transcription_consents_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");--> statement-breakpoint
ALTER TABLE "meeting_transcription_consents" ADD CONSTRAINT "meeting_transcription_consents_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD CONSTRAINT "meeting_capture_pair_check" CHECK (("transcription_space_name" IS NULL) = ("transcription_policy_version" IS NULL));