ALTER TABLE "billing_operations" ADD COLUMN "provider_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_operations" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_operations" ADD COLUMN "last_error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_billing_operation_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_billing_operation_fk" FOREIGN KEY ("pending_billing_operation_id") REFERENCES "billing_operations"("id") ON DELETE SET NULL;
