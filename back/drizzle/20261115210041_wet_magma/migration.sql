DROP INDEX "users_phone_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "phone_verified_at";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_verification_status_check", ADD CONSTRAINT "users_verification_status_check" CHECK (
    ("status" = 'verified') = ("email_verified_at" IS NOT NULL)
  );