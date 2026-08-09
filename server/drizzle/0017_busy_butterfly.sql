ALTER TABLE "invoices" DROP CONSTRAINT "invoices_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_pending_billing_operation_fk";
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "subject_type" varchar(40);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "subject_id" text;--> statement-breakpoint
UPDATE "email_outbox" SET "state" = 'expired', "recipient" = 'eliminado@inquilink.invalid', "variables" = '{}'::jsonb,
  "claimed_at" = NULL, "claim_token" = NULL, "last_error_code" = 'LEGACY_EMAIL_SUBJECT_MISSING'
WHERE "state" IN ('pending', 'processing') AND "template" = 'team_invitation'
  AND ("subject_type" IS NULL OR "subject_id" IS NULL);--> statement-breakpoint
UPDATE "invoices" AS invoice SET "agency_id" = subscription."agency_id"
FROM "subscriptions" AS subscription
WHERE invoice."subscription_id" = subscription."id" AND invoice."agency_id" <> subscription."agency_id";--> statement-breakpoint
UPDATE "subscriptions" AS subscription SET "pending_billing_operation_id" = NULL
FROM "billing_operations" AS operation
WHERE subscription."pending_billing_operation_id" = operation."id" AND subscription."agency_id" <> operation."agency_id";--> statement-breakpoint
DELETE FROM "invoices" AS older USING "invoices" AS newer
WHERE older."agency_id" = newer."agency_id" AND older."provider_invoice_ref" = newer."provider_invoice_ref"
  AND (older."issued_at" < newer."issued_at" OR (older."issued_at" = newer."issued_at" AND older."id" < newer."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "billing_operations_id_agency_unique" ON "billing_operations" USING btree ("id","agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_id_agency_unique" ON "subscriptions" USING btree ("id","agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_agency_provider_ref_unique" ON "invoices" USING btree ("agency_id","provider_invoice_ref");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_agency_fk" FOREIGN KEY ("subscription_id","agency_id") REFERENCES "public"."subscriptions"("id","agency_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_billing_operation_agency_fk" FOREIGN KEY ("pending_billing_operation_id","agency_id") REFERENCES "public"."billing_operations"("id","agency_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_subject_idx" ON "email_outbox" USING btree ("subject_type","subject_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_subject_check" CHECK (("email_outbox"."subject_type" is null and "email_outbox"."subject_id" is null) or ("email_outbox"."subject_type" in ('team_invitation', 'appointment', 'subscription') and "email_outbox"."subject_id" is not null));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_check" CHECK ("invoices"."amount_cents" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('open', 'paid', 'past_due', 'void', 'uncollectible'));
