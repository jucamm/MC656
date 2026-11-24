CREATE TABLE "legislative_bills" (
	"id" uuid PRIMARY KEY,
	"house_key" varchar(12) NOT NULL,
	"uf" varchar(2),
	"external_id" varchar(120) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"number" integer NOT NULL,
	"year" integer NOT NULL,
	"label" varchar(150) NOT NULL,
	"abstract" text NOT NULL,
	"official_url" text NOT NULL,
	"status" text NOT NULL,
	"status_label" varchar(240) NOT NULL,
	"source_updated_at" timestamp with time zone,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legislative_bills_source_unique" UNIQUE("house_key","external_id"),
	CONSTRAINT "legislative_bills_state_check" CHECK (
    "kind" = 'PL' AND "status" IN ('in_progress','closed','unknown')
    AND "number" > 0 AND "year" BETWEEN 1800 AND 9999
    AND "official_url" LIKE 'https://%'
    AND (CASE WHEN "house_key" IN ('CD','SF') THEN "uf" IS NULL
      WHEN "house_key" = 'CLDF' THEN "uf" IS NOT NULL AND "uf" = 'DF'
      ELSE "uf" IN ('AC','AL','AP','AM','BA','CE','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
        AND "uf" IS NOT NULL AND "house_key" = 'AL-' || "uf" END)
  )
);
--> statement-breakpoint
CREATE TABLE "legislative_source_sync" (
	"house_key" varchar(12) PRIMARY KEY,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"failure_code" varchar(40),
	CONSTRAINT "legislative_source_lease_check" CHECK (("lease_token" IS NULL) = ("lease_until" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "legislative_bill_id" uuid;--> statement-breakpoint
CREATE INDEX "legislative_bills_offer_idx" ON "legislative_bills" ("house_key","status","verified_at");--> statement-breakpoint
CREATE INDEX "meetings_legislative_bill_idx" ON "meetings" ("legislative_bill_id") WHERE "legislative_bill_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_legislative_bill_id_legislative_bills_id_fkey" FOREIGN KEY ("legislative_bill_id") REFERENCES "legislative_bills"("id");