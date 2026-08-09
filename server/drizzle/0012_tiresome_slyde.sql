ALTER TABLE "agencies" ADD COLUMN "account_state" varchar(30) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "closure_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD COLUMN "last_request_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_state" varchar(30) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "closure_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invitations_request_key_unique" ON "agency_invitations" USING btree ("agency_id","last_request_key_hash");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_closure_state_check" CHECK (("account_state" = 'active' AND "closure_requested_at" IS NULL) OR ("account_state" = 'closure_requested' AND "closure_requested_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_account_closure_state_check" CHECK (("account_state" = 'active' AND "closure_requested_at" IS NULL) OR ("account_state" = 'closure_requested' AND "closure_requested_at" IS NOT NULL));
