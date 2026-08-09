CREATE TABLE "agency_invitation_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"idempotency_key_hash" varchar(64) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"invitation_id" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agency_invitation_operations_hash_check" CHECK (length("agency_invitation_operations"."idempotency_key_hash") = 64 and length("agency_invitation_operations"."request_fingerprint") = 64)
);
--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" DROP CONSTRAINT "agency_closure_cleanup_state_check";--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_subject_check";--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD COLUMN "claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_next_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_sync_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_sync_last_error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "agency_invitation_operations" ADD CONSTRAINT "agency_invitation_operations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invitation_operations_key_unique" ON "agency_invitation_operations" USING btree ("agency_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "agency_invitation_operations_invitation_idx" ON "agency_invitation_operations" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "agency_closure_cleanup_due_idx" ON "agency_closure_cleanup" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "subscriptions_billing_sync_due_idx" ON "subscriptions" USING btree ("billing_next_sync_at","id");--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD CONSTRAINT "agency_closure_cleanup_claim_check" CHECK (("agency_closure_cleanup"."state" = 'processing') = ("agency_closure_cleanup"."claimed_at" is not null and "agency_closure_cleanup"."claim_token" is not null));--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD CONSTRAINT "agency_closure_cleanup_state_check" CHECK ("agency_closure_cleanup"."state" in ('pending', 'processing', 'provider_applied', 'ready_for_purge', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_subject_check" CHECK (("email_outbox"."subject_type" is null and "email_outbox"."subject_id" is null) or ("email_outbox"."subject_type" in ('team_invitation', 'appointment', 'subscription') and "email_outbox"."subject_id" is not null));--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billing_sync_attempts_check" CHECK ("subscriptions"."billing_sync_attempts" >= 0);