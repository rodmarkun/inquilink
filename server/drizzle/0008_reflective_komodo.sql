CREATE TABLE "document_storage_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_key" text NOT NULL,
	"agency_id" text NOT NULL,
	"application_id" text NOT NULL,
	"reason" varchar(80) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(80),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_storage_cleanup_key_unique" ON "document_storage_cleanup" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_storage_cleanup_created_idx" ON "document_storage_cleanup" USING btree ("created_at");
