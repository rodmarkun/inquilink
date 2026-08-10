ALTER TABLE "applications" ADD COLUMN "phone" varchar(16);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "individual_net_monthly_income_cents" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "household_net_monthly_income_cents" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "adult_occupants" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "minor_occupants" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "intended_move_in_date" date;
