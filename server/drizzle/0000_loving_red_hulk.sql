CREATE TYPE "public"."agency_role" AS ENUM('admin', 'collaborator');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('new', 'preselected', 'selected', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."appointment_state" AS ENUM('scheduled', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."document_state" AS ENUM('complete', 'missing', 'not_requested');--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('pro', 'business');--> statement-breakpoint
CREATE TYPE "public"."property_state" AS ENUM('draft', 'published', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."subscription_state" AS ENUM('incomplete', 'trialing', 'active', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."token_kind" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TYPE "public"."user_kind" AS ENUM('agency', 'tenant');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"phone" varchar(40),
	"timezone" varchar(50) DEFAULT 'Europe/Madrid' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_memberships" (
	"agency_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "agency_role" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agency_memberships_agency_id_user_id_pk" PRIMARY KEY("agency_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "application_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"agency_id" text NOT NULL,
	"tenant_user_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"byte_size" integer NOT NULL,
	"malware_scan_state" varchar(30) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_status_history" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"agency_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"from_status" "application_status" NOT NULL,
	"to_status" "application_status" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text NOT NULL,
	"tenant_user_id" text NOT NULL,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"document_state" "document_state" DEFAULT 'not_requested' NOT NULL,
	"submitted_at" timestamp with time zone,
	"draft_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_version" varchar(100),
	"consented_at" timestamp with time zone,
	"source_link_token_hash" varchar(64),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"property_id" text NOT NULL,
	"application_id" text NOT NULL,
	"responsible_user_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"state" "appointment_state" DEFAULT 'scheduled' NOT NULL,
	"instructions" text,
	"internal_note" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text,
	"actor_user_id" text,
	"action" varchar(100) NOT NULL,
	"subject_type" varchar(80) NOT NULL,
	"subject_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"template" varchar(80) NOT NULL,
	"locale" varchar(10) DEFAULT 'es-ES' NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"provider_invoice_ref" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"status" varchar(30) NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"hosted_url" text
);
--> statement-breakpoint
CREATE TABLE "one_time_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "token_kind" NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"return_path" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"responsible_user_id" text,
	"internal_reference" varchar(100) NOT NULL,
	"title" varchar(240) NOT NULL,
	"city" varchar(120) NOT NULL,
	"province" varchar(120) NOT NULL,
	"monthly_rent_cents" integer NOT NULL,
	"state" "property_state" DEFAULT 'draft' NOT NULL,
	"public_link_token_hash" varchar(64),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"plan" "plan_code" NOT NULL,
	"state" "subscription_state" DEFAULT 'incomplete' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider_customer_ref" text,
	"provider_subscription_ref" text,
	"payment_method_display" varchar(80),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "user_kind" NOT NULL,
	"email" varchar(320) NOT NULL,
	"full_name" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_tenant_user_id_users_id_fk" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenant_user_id_users_id_fk" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_agency_per_user" ON "agency_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_application_idx" ON "application_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "status_history_application_idx" ON "application_status_history" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_property_tenant_unique" ON "applications" USING btree ("property_id","tenant_user_id");--> statement-breakpoint
CREATE INDEX "applications_agency_property_idx" ON "applications" USING btree ("agency_id","property_id");--> statement-breakpoint
CREATE INDEX "applications_tenant_idx" ON "applications" USING btree ("tenant_user_id");--> statement-breakpoint
CREATE INDEX "appointments_agency_starts_idx" ON "appointments" USING btree ("agency_id","starts_at");--> statement-breakpoint
CREATE INDEX "audit_agency_created_idx" ON "audit_events" USING btree ("agency_id","created_at");--> statement-breakpoint
CREATE INDEX "invoices_agency_idx" ON "invoices" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_time_tokens_hash_unique" ON "one_time_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_agency_reference_unique" ON "properties" USING btree ("agency_id","internal_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_public_link_hash_unique" ON "properties" USING btree ("public_link_token_hash");--> statement-breakpoint
CREATE INDEX "properties_agency_idx" ON "properties" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_agency_unique" ON "subscriptions" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_kind_unique" ON "users" USING btree ("email","kind");