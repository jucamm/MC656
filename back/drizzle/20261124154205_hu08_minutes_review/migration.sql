CREATE TABLE "meeting_minute_events" (
	"id" uuid PRIMARY KEY,
	"meeting_id" uuid NOT NULL,
	"actor_user_id" bigint NOT NULL,
	"action" text NOT NULL,
	"revision_id" uuid,
	"from_visibility" text NOT NULL,
	"to_visibility" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resulting_version" integer NOT NULL,
	CONSTRAINT "minute_events_version_unique" UNIQUE("meeting_id","resulting_version"),
	CONSTRAINT "minute_events_state_check" CHECK (
    "resulting_version" > 1
    AND "action" IN ('edit','publish','reject','hide','delete')
    AND "from_visibility" IN ('unpublished','published','hidden')
    AND "to_visibility" IN ('unpublished','published','hidden','deleted')
    AND ("revision_id" IS NULL) = ("action" = 'delete')
  )
);
--> statement-breakpoint
ALTER TABLE "meeting_minute_events" ADD CONSTRAINT "meeting_minute_events_3mhBWvDIlAtq_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meeting_minutes"("meeting_id");--> statement-breakpoint
ALTER TABLE "meeting_minute_events" ADD CONSTRAINT "meeting_minute_events_actor_user_id_users_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "meeting_minute_events" ADD CONSTRAINT "minute_events_revision_fk" FOREIGN KEY ("meeting_id","revision_id") REFERENCES "meeting_minute_revisions"("meeting_id","id");