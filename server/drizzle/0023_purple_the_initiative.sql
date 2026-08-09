ALTER TABLE "analytics_events" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DATA TYPE text;--> statement-breakpoint
-- Explicit compatibility mapping for every pre-2.1 subscription and analytics
-- row. Legacy Pro retains the middle tier (Profesional); legacy Business retains
-- the highest self-service tier (Inmobiliaria). No workspace is silently moved
-- to the lower Particular allowance and no product data is deleted.
UPDATE "analytics_events" SET "plan" = CASE "plan" WHEN 'pro' THEN 'professional' WHEN 'business' THEN 'inmobiliaria' ELSE "plan" END;--> statement-breakpoint
UPDATE "subscriptions" SET "plan" = CASE "plan" WHEN 'pro' THEN 'professional' WHEN 'business' THEN 'inmobiliaria' ELSE "plan" END;--> statement-breakpoint
DROP TYPE "public"."plan_code";--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('particular', 'professional', 'inmobiliaria');--> statement-breakpoint
ALTER TABLE "analytics_events" ALTER COLUMN "plan" SET DATA TYPE "public"."plan_code" USING "plan"::"public"."plan_code";--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DATA TYPE "public"."plan_code" USING "plan"::"public"."plan_code";
