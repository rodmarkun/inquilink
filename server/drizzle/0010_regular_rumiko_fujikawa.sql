ALTER TABLE "application_notes" DROP CONSTRAINT "application_notes_author_membership_fk";--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_application_note_author_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agency_memberships
    WHERE agency_id = NEW.agency_id AND user_id = NEW.author_user_id
  ) THEN
    RAISE EXCEPTION 'APPLICATION_NOTE_AUTHOR_NOT_MEMBER' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER application_notes_validate_author_membership
BEFORE INSERT OR UPDATE OF agency_id, author_user_id ON "application_notes"
FOR EACH ROW EXECUTE FUNCTION validate_application_note_author_membership();
