ALTER TABLE "agencies" ADD COLUMN "fiscal_id" varchar(20);--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "billing_name" varchar(200);--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "adult_profile_id" varchar(50) DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "normalized_phone" varchar(15);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "normalized_email" varchar(320);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "adult_profiles" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "agencies" SET "billing_name" = "name" WHERE "billing_name" IS NULL;--> statement-breakpoint
UPDATE "applications" AS application
SET "normalized_phone" = NULLIF(regexp_replace(COALESCE(application."phone", application."draft_data"->>'phone', ''), '[^0-9]', '', 'g'), ''),
    "normalized_email" = lower(account."email"),
    "adult_profiles" = jsonb_build_array(jsonb_build_object(
      'id', 'primary',
      'isPrimary', true,
      'fullName', COALESCE(application."draft_data"->>'fullName', account."full_name"),
      'email', lower(account."email"),
      'phone', COALESCE(application."phone", application."draft_data"->>'phone'),
      'employmentStatus', COALESCE(application."draft_data"->>'employmentStatus', ''),
      'employerOrActivity', COALESCE(application."draft_data"->>'employerOrActivity', ''),
      'contractType', COALESCE(application."draft_data"->>'contractType', ''),
      'netMonthlyIncomeCents', COALESCE(application."individual_net_monthly_income_cents", 0)
    ))
FROM "users" AS account
WHERE account."id" = application."tenant_user_id";--> statement-breakpoint
CREATE INDEX "applications_duplicate_phone_idx" ON "applications" USING btree ("property_id","normalized_phone");--> statement-breakpoint
CREATE INDEX "applications_duplicate_email_idx" ON "applications" USING btree ("property_id","normalized_email");
