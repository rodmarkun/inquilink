CREATE TABLE "agency_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "agency_role" DEFAULT 'collaborator' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"accepted_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text,
	"actor_user_id" text,
	"event_name" varchar(80) NOT NULL,
	"placement" varchar(30),
	"plan" "plan_code",
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"operation" varchar(40) NOT NULL,
	"idempotency_key_hash" varchar(64) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"state" varchar(20) DEFAULT 'pending' NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "contact_email" varchar(320);--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "dedupe_key" varchar(160);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "state" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "last_error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invitations_token_hash_unique" ON "agency_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_invitations_agency_email_unique" ON "agency_invitations" USING btree ("agency_id","email");--> statement-breakpoint
CREATE INDEX "agency_invitations_agency_idx" ON "agency_invitations" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "analytics_events_agency_time_idx" ON "analytics_events" USING btree ("agency_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_name_time_idx" ON "analytics_events" USING btree ("event_name","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_operations_idempotency_unique" ON "billing_operations" USING btree ("agency_id","operation","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "billing_operations_agency_idx" ON "billing_operations" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_dedupe_key_unique" ON "email_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_outbox_delivery_idx" ON "email_outbox" USING btree ("state","available_at");