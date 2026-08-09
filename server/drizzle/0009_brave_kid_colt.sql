ALTER TABLE "users" ADD COLUMN "terms_version" varchar(80);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_terms_acceptance_pair_check" CHECK (("terms_version" IS NULL AND "terms_accepted_at" IS NULL) OR ("terms_version" IS NOT NULL AND "terms_accepted_at" IS NOT NULL));
