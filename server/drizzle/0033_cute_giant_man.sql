CREATE TABLE "guest_application_otps" (
	"id" text PRIMARY KEY NOT NULL,
	"email_normalized" varchar(320) NOT NULL,
	"property_id" text NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guest_application_otps_attempts_check" CHECK ("guest_application_otps"."attempts" >= 0 and "guest_application_otps"."attempts" <= 5),
	CONSTRAINT "guest_application_otps_expiry_check" CHECK ("guest_application_otps"."expires_at" > "guest_application_otps"."created_at"),
	CONSTRAINT "guest_application_otps_hash_check" CHECK (length("guest_application_otps"."code_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_template_check";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "duplicate_phone_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guest_application_otps" ADD CONSTRAINT "guest_application_otps_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_application_otps_lookup_idx" ON "guest_application_otps" USING btree ("property_id","email_normalized","created_at");--> statement-breakpoint
CREATE INDEX "guest_application_otps_expiry_idx" ON "guest_application_otps" USING btree ("expires_at","id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_template_check" CHECK ("email_outbox"."template" in ('new_applicant', 'viewing_reminder', 'trial_ending', 'payment_failure', 'team_invitation', 'verify_email', 'reset_password', 'guest_application_otp', 'application_received', 'viewing_created', 'viewing_rescheduled', 'viewing_cancelled'));