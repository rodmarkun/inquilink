ALTER TABLE "agency_invitations" DROP CONSTRAINT "agency_invitations_invited_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "application_notes" DROP CONSTRAINT "application_notes_author_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "application_status_history" DROP CONSTRAINT "application_status_history_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agency_invitations" ALTER COLUMN "invited_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "application_notes" ALTER COLUMN "author_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "application_status_history" ALTER COLUMN "actor_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "account_purge_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "account_purge_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "account_purge_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agencies" ADD COLUMN "account_purge_claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "deletion_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "deletion_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "application_documents" ADD COLUMN "deletion_claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "retention_claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "retention_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "retention_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_application_retention_reopen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.retention_state = 'deleting'
     AND ((to_jsonb(NEW) - ARRAY['retention_claimed_at','retention_claim_token','retention_attempts','retention_next_attempt_at'])
       IS DISTINCT FROM
          (to_jsonb(OLD) - ARRAY['retention_claimed_at','retention_claim_token','retention_attempts','retention_next_attempt_at'])) THEN
    RAISE EXCEPTION 'APPLICATION_RETENTION_IN_PROGRESS' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
UPDATE "applications"
SET "retention_claimed_at" = NULL,
    "retention_claim_token" = NULL,
    "retention_next_attempt_at" = LEAST("retention_next_attempt_at", now())
WHERE "retention_claimed_at" IS NOT NULL
  AND "retention_claim_token" IS NULL;
--> statement-breakpoint
ALTER TABLE "document_storage_cleanup" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "document_storage_cleanup" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_storage_cleanup" ADD COLUMN "claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_purge_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_purge_next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_purge_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_purge_claim_token" varchar(100);--> statement-breakpoint
ALTER TABLE "agency_invitations" ADD CONSTRAINT "agency_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agencies_account_purge_due_idx" ON "agencies" USING btree ("account_state","account_purge_next_attempt_at","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_deletion_due_idx" ON "application_documents" USING btree ("deletion_state","deletion_next_attempt_at","created_at","id");--> statement-breakpoint
CREATE INDEX "applications_retention_due_idx" ON "applications" USING btree ("retention_state","retention_next_attempt_at","created_at","id");--> statement-breakpoint
CREATE INDEX "document_storage_cleanup_due_idx" ON "document_storage_cleanup" USING btree ("next_attempt_at","created_at","id");--> statement-breakpoint
CREATE INDEX "users_account_purge_due_idx" ON "users" USING btree ("account_state","account_purge_next_attempt_at","created_at","id");--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_account_purge_claim_check" CHECK (("agencies"."account_purge_claimed_at" is null) = ("agencies"."account_purge_claim_token" is null));--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "documents_deletion_claim_check" CHECK (("application_documents"."deletion_claimed_at" is null) = ("application_documents"."deletion_claim_token" is null));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_retention_claim_check" CHECK (("applications"."retention_claimed_at" is null) = ("applications"."retention_claim_token" is null));--> statement-breakpoint
ALTER TABLE "document_storage_cleanup" ADD CONSTRAINT "document_storage_cleanup_claim_check" CHECK (("document_storage_cleanup"."claimed_at" is null) = ("document_storage_cleanup"."claim_token" is null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_purge_claim_check" CHECK (("users"."account_purge_claimed_at" is null) = ("users"."account_purge_claim_token" is null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_application_note_author_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.author_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agency_memberships
    WHERE agency_id = NEW.agency_id AND user_id = NEW.author_user_id
  ) THEN
    RAISE EXCEPTION 'APPLICATION_NOTE_AUTHOR_NOT_MEMBER' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
