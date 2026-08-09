ALTER TABLE "email_outbox" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "agency_id" text;--> statement-breakpoint
UPDATE "email_outbox" SET "state" = 'expired', "recipient" = 'eliminado@inquilink.invalid', "variables" = '{}'::jsonb,
  "claimed_at" = NULL, "claim_token" = NULL, "last_error_code" = 'LEGACY_EMAIL_SCOPE_MISSING'
WHERE "state" IN ('pending', 'processing') AND "user_id" IS NULL AND "agency_id" IS NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_user_idx" ON "email_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_outbox_agency_idx" ON "email_outbox" USING btree ("agency_id");--> statement-breakpoint
UPDATE "email_outbox" SET "recipient" = 'eliminado@inquilink.invalid', "variables" = '{}'::jsonb, "claimed_at" = NULL, "claim_token" = NULL
WHERE "state" IN ('sent', 'failed', 'expired');--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD CONSTRAINT "agency_closure_cleanup_attempts_check" CHECK ("agency_closure_cleanup"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "agency_closure_cleanup" ADD CONSTRAINT "agency_closure_cleanup_provider_state_check" CHECK (("agency_closure_cleanup"."state" <> 'provider_applied' or "agency_closure_cleanup"."provider_applied_at" is not null) and ("agency_closure_cleanup"."state" not in ('ready_for_purge', 'completed') or "agency_closure_cleanup"."provider_subscription_ref" is null));--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_expiry_check" CHECK ("agency_invitations"."expires_at" > "agency_invitations"."created_at");--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_terminal_state_check" CHECK (not ("agency_invitations"."accepted_at" is not null and "agency_invitations"."revoked_at" is not null));--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_hash_lengths_check" CHECK (length("agency_invitations"."token_hash") = 64 and ("agency_invitations"."last_request_key_hash" is null or length("agency_invitations"."last_request_key_hash") = 64));--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_shape_check" CHECK (
    ("analytics_events"."event_name" = 'marketing_cta_clicked' and "analytics_events"."agency_id" is null and "analytics_events"."actor_user_id" is null and "analytics_events"."placement" in ('hero', 'pricing', 'final') and "analytics_events"."plan" is null)
    or ("analytics_events"."event_name" = 'trial_activated' and "analytics_events"."agency_id" is not null and "analytics_events"."actor_user_id" is not null and "analytics_events"."placement" is null and "analytics_events"."plan" is not null)
    or ("analytics_events"."event_name" in ('agency_registration_completed', 'first_property_published', 'public_link_copied', 'first_applicant_reviewed', 'whatsapp_contact_initiated', 'viewing_scheduled', 'trial_converted_to_paid') and "analytics_events"."agency_id" is not null and "analytics_events"."actor_user_id" is not null and "analytics_events"."placement" is null and "analytics_events"."plan" is null)
    or ("analytics_events"."event_name" in ('tenant_account_created', 'application_started', 'application_completed') and "analytics_events"."agency_id" is null and "analytics_events"."actor_user_id" is not null and "analytics_events"."placement" is null and "analytics_events"."plan" is null)
  );--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_operation_check" CHECK ("billing_operations"."operation" in ('create_trial', 'update_payment_method', 'cancel', 'reactivate'));--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_state_check" CHECK ("billing_operations"."state" in ('pending', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_attempts_check" CHECK ("billing_operations"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_hash_lengths_check" CHECK (length("billing_operations"."idempotency_key_hash") = 64 and length("billing_operations"."request_fingerprint") = 64);--> statement-breakpoint
ALTER TABLE "billing_operations" ADD CONSTRAINT "billing_operations_completion_check" CHECK ("billing_operations"."state" <> 'completed' or "billing_operations"."response" is not null);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_template_check" CHECK ("email_outbox"."template" in ('new_applicant', 'viewing_reminder', 'trial_ending', 'payment_failure', 'team_invitation', 'verify_email', 'reset_password', 'application_received', 'viewing_created', 'viewing_rescheduled', 'viewing_cancelled'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_state_check" CHECK ("email_outbox"."state" in ('pending', 'processing', 'sent', 'failed', 'expired'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_attempts_check" CHECK ("email_outbox"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_delivery_window_check" CHECK ("email_outbox"."expires_at" > "email_outbox"."created_at");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_claim_check" CHECK (("email_outbox"."state" = 'processing') = ("email_outbox"."claimed_at" is not null and "email_outbox"."claim_token" is not null));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_sent_check" CHECK ("email_outbox"."state" <> 'sent' or "email_outbox"."sent_at" is not null);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_terminal_scrub_check" CHECK ("email_outbox"."state" not in ('sent', 'failed', 'expired') or ("email_outbox"."recipient" = 'eliminado@inquilink.invalid' and "email_outbox"."variables" = '{}'::jsonb));--> statement-breakpoint
