CREATE TABLE "agency_closure_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"provider_subscription_ref" text,
	"state" varchar(30) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_applied_at" timestamp with time zone,
	"last_error_code" varchar(80),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agency_closure_cleanup_agency_unique" ON "agency_closure_cleanup" USING btree ("agency_id");
--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD CONSTRAINT "agency_closure_cleanup_state_check" CHECK ("state" IN ('pending', 'provider_applied', 'ready_for_purge', 'completed', 'failed'));
