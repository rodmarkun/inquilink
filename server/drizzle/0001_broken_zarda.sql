CREATE TABLE "application_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"application_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "category" varchar(50) DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ALTER COLUMN "category" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "responsible_user_id" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "submission_key_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "property_type" varchar(80);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "bedrooms" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "bathrooms" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "floor_area_sqm" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "available_from" date;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "public_location" varchar(240);--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "cover_image_url" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "gallery_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "requested_document_categories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "public_link_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_notes_agency_idx" ON "application_notes" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "application_notes_application_idx" ON "application_notes" USING btree ("application_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_submission_key_unique" ON "applications" USING btree ("submission_key_hash");
