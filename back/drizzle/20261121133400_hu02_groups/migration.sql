CREATE TYPE "group_deletion_reason" AS ENUM('ADMIN_DELETION', 'LAST_MEMBER_LEFT');--> statement-breakpoint
CREATE TYPE "group_invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "group_role" AS ENUM('ADMIN', 'MEMBER');--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" uuid PRIMARY KEY,
	"group_id" uuid NOT NULL,
	"invited_user_id" bigint NOT NULL,
	"invited_by_user_id" bigint NOT NULL,
	"status" "group_invitation_status" DEFAULT 'PENDING'::"group_invitation_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "group_invitations_resolution_check" CHECK (("status" = 'PENDING') = ("resolved_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid,
	"user_id" bigint,
	"role" "group_role" DEFAULT 'MEMBER'::"group_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_pkey" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY,
	"name" varchar(150) NOT NULL,
	"created_by_user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_reason" "group_deletion_reason",
	CONSTRAINT "groups_name_not_blank_check" CHECK ("name" ~ '[^[:space:]]'),
	CONSTRAINT "groups_deletion_state_check" CHECK (("deleted_at" IS NULL) = ("deletion_reason" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "group_invitations_pending_group_user_uidx" ON "group_invitations" ("group_id","invited_user_id") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "group_invitations_recipient_idx" ON "group_invitations" ("invited_user_id","id");--> statement-breakpoint
CREATE INDEX "group_memberships_user_group_idx" ON "group_memberships" ("user_id","group_id");--> statement-breakpoint
CREATE INDEX "group_memberships_admin_group_idx" ON "group_memberships" ("group_id") WHERE "role" = 'ADMIN';--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id");--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invited_user_id_users_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invited_by_user_id_users_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id");--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_user_id_users_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id");