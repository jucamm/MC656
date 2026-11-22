CREATE TABLE "meeting_conferencing" (
	"meeting_id" uuid PRIMARY KEY,
	"mode" varchar(7) NOT NULL,
	"google_meet_url" varchar(80) NOT NULL,
	CONSTRAINT "meeting_conferencing_mode_check" CHECK ("mode" IN ('virtual', 'hybrid')),
	CONSTRAINT "meeting_conferencing_url_check" CHECK (
    "google_meet_url" ~ '^https://meet[.]google[.]com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'
  )
);
--> statement-breakpoint
ALTER TABLE "meeting_conferencing" ADD CONSTRAINT "meeting_conferencing_meeting_id_meetings_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id");