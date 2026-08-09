ALTER TABLE "applications" ADD COLUMN "retention_state" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "retention_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_retention_state_check" CHECK ("retention_state" IN ('active', 'deleting'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_application_retention_reopen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.retention_state = 'deleting' THEN
    RAISE EXCEPTION 'APPLICATION_RETENTION_IN_PROGRESS' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER applications_prevent_retention_reopen
BEFORE UPDATE ON "applications"
FOR EACH ROW
EXECUTE FUNCTION prevent_application_retention_reopen();--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_retained_application_child_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_retention_state varchar(20);
BEGIN
  SELECT retention_state INTO parent_retention_state
  FROM applications
  WHERE id = NEW.application_id
  FOR UPDATE;
  IF parent_retention_state = 'deleting' THEN
    RAISE EXCEPTION 'APPLICATION_RETENTION_IN_PROGRESS' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER application_documents_prevent_retention_insert
BEFORE INSERT ON "application_documents"
FOR EACH ROW EXECUTE FUNCTION prevent_retained_application_child_insert();--> statement-breakpoint
CREATE TRIGGER application_notes_prevent_retention_insert
BEFORE INSERT ON "application_notes"
FOR EACH ROW EXECUTE FUNCTION prevent_retained_application_child_insert();--> statement-breakpoint
CREATE TRIGGER application_status_history_prevent_retention_insert
BEFORE INSERT ON "application_status_history"
FOR EACH ROW EXECUTE FUNCTION prevent_retained_application_child_insert();--> statement-breakpoint
CREATE TRIGGER appointments_prevent_retention_insert
BEFORE INSERT ON "appointments"
FOR EACH ROW EXECUTE FUNCTION prevent_retained_application_child_insert();
