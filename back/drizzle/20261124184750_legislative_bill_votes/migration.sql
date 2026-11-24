CREATE TABLE "legislative_bill_votes" (
	"bill_id" uuid,
	"user_id" bigint,
	"choice" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legislative_bill_votes_pkey" PRIMARY KEY("bill_id","user_id"),
	CONSTRAINT "legislative_bill_vote_choice_check" CHECK ("choice" IN ('for','against'))
);
--> statement-breakpoint
ALTER TABLE "legislative_bill_votes" ADD CONSTRAINT "legislative_bill_votes_bill_id_legislative_bills_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "legislative_bills"("id");--> statement-breakpoint
ALTER TABLE "legislative_bill_votes" ADD CONSTRAINT "legislative_bill_votes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");