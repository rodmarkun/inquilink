ALTER TABLE "application_documents" ADD COLUMN "deletion_state" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "deletion_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "delete_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "last_delete_error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "idempotency_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "last_mutation_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "last_mutation_operation" varchar(40);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "last_mutation_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_agency_idempotency_unique" ON "appointments" USING btree ("agency_id","idempotency_key_hash");