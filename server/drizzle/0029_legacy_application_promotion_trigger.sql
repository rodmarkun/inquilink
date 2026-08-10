CREATE OR REPLACE FUNCTION "application_safe_iso_date"("candidate" text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
	parsed date;
BEGIN
	IF "candidate" !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' OR left("candidate", 4) = '0000' THEN
		RETURN NULL;
	END IF;
	BEGIN
		parsed := "candidate"::date;
	EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
		RETURN NULL;
	END;
	IF to_char(parsed, 'YYYY-MM-DD') <> "candidate" THEN
		RETURN NULL;
	END IF;
	RETURN parsed;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "application_adult_profiles_from_draft"("draft" jsonb, "fallback_email" text, "fallback_name" text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
	WITH candidate_adults AS (
		SELECT adult, ordinal
		FROM jsonb_array_elements(CASE WHEN jsonb_typeof("draft"->'additionalAdults') = 'array' THEN "draft"->'additionalAdults' ELSE '[]'::jsonb END) WITH ORDINALITY AS entry(adult, ordinal)
		WHERE jsonb_typeof(adult) = 'object'
			AND adult->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
			AND lower(adult->>'id') <> 'primary'
			AND length(trim(COALESCE(adult->>'fullName', ''))) BETWEEN 2 AND 200
			AND length(trim(COALESCE(adult->>'employmentStatus', ''))) BETWEEN 1 AND 100
			AND length(trim(COALESCE(adult->>'employerOrActivity', ''))) BETWEEN 1 AND 200
			AND length(trim(COALESCE(adult->>'contractType', ''))) BETWEEN 1 AND 100
			AND adult->>'netMonthlyIncomeCents' ~ '^[0-9]{1,9}$'
			AND CASE WHEN adult->>'netMonthlyIncomeCents' ~ '^[0-9]{1,9}$' THEN (adult->>'netMonthlyIncomeCents')::bigint <= 100000000 ELSE false END
			AND (NULLIF(adult->>'email', '') IS NULL OR (length(adult->>'email') <= 320 AND adult->>'email' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
			AND (NULLIF(adult->>'phone', '') IS NULL OR adult->>'phone' ~ '^\+[1-9][0-9]{7,14}$')
	), valid_adults AS (
		SELECT candidate.* FROM candidate_adults AS candidate
		WHERE NOT EXISTS (
			SELECT 1 FROM candidate_adults AS duplicate
			WHERE duplicate.ordinal <> candidate.ordinal AND lower(duplicate.adult->>'id') = lower(candidate.adult->>'id')
		)
	)
	SELECT jsonb_build_array(jsonb_build_object(
		'id', 'primary',
		'isPrimary', true,
		'fullName', COALESCE(NULLIF("draft"->>'fullName', ''), "fallback_name", ''),
		'email', CASE WHEN lower(trim(NULLIF("draft"->>'email', ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(trim("draft"->>'email')) <= 320 THEN lower(trim("draft"->>'email')) WHEN lower(trim("fallback_email")) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(trim("fallback_email")) <= 320 THEN lower(trim("fallback_email")) END,
		'phone', CASE WHEN "draft"->>'phone' ~ '^\+[1-9][0-9]{7,14}$' THEN "draft"->>'phone' END,
		'employmentStatus', COALESCE("draft"->>'employmentStatus', ''),
		'employerOrActivity', COALESCE("draft"->>'employerOrActivity', ''),
		'contractType', COALESCE("draft"->>'contractType', ''),
		'netMonthlyIncomeCents', CASE WHEN "draft"->>'individualNetMonthlyIncomeCents' ~ '^[0-9]{1,9}$' THEN CASE WHEN ("draft"->>'individualNetMonthlyIncomeCents')::bigint <= 100000000 THEN ("draft"->>'individualNetMonthlyIncomeCents')::integer ELSE 0 END ELSE 0 END
	)) || COALESCE((
		SELECT jsonb_agg(jsonb_build_object(
			'id', adult->>'id', 'isPrimary', false, 'fullName', COALESCE(adult->>'fullName', ''),
			'email', lower(NULLIF(adult->>'email', '')), 'phone', NULLIF(adult->>'phone', ''),
			'employmentStatus', COALESCE(adult->>'employmentStatus', ''),
			'employerOrActivity', COALESCE(adult->>'employerOrActivity', ''),
			'contractType', COALESCE(adult->>'contractType', ''),
			'netMonthlyIncomeCents', CASE WHEN adult->>'netMonthlyIncomeCents' ~ '^[0-9]{1,9}$' THEN CASE WHEN (adult->>'netMonthlyIncomeCents')::bigint <= 100000000 THEN (adult->>'netMonthlyIncomeCents')::integer ELSE 0 END ELSE 0 END
		) ORDER BY ordinal)
		FROM valid_adults
	), '[]'::jsonb);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "promote_legacy_submitted_application"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	account_email text;
	account_name text;
BEGIN
	IF NEW."submitted_at" IS NOT NULL AND NEW."application_data_promoted_at" IS NULL THEN
		SELECT "email", "full_name" INTO account_email, account_name FROM "users" WHERE "id" = NEW."tenant_user_id";
		NEW."phone" := CASE WHEN NEW."draft_data"->>'phone' ~ '^\+[1-9][0-9]{7,14}$' THEN NEW."draft_data"->>'phone' END;
		NEW."individual_net_monthly_income_cents" := CASE WHEN NEW."draft_data"->>'individualNetMonthlyIncomeCents' ~ '^[0-9]{1,9}$' THEN CASE WHEN (NEW."draft_data"->>'individualNetMonthlyIncomeCents')::bigint <= 100000000 THEN (NEW."draft_data"->>'individualNetMonthlyIncomeCents')::integer END END;
		NEW."household_net_monthly_income_cents" := CASE WHEN NEW."draft_data"->>'householdNetMonthlyIncomeCents' ~ '^[0-9]{1,9}$' THEN CASE WHEN (NEW."draft_data"->>'householdNetMonthlyIncomeCents')::bigint <= 100000000 THEN (NEW."draft_data"->>'householdNetMonthlyIncomeCents')::integer END END;
		NEW."adult_occupants" := CASE WHEN NEW."draft_data"->>'adultOccupants' ~ '^[0-9]{1,2}$' THEN CASE WHEN (NEW."draft_data"->>'adultOccupants')::integer BETWEEN 1 AND 20 THEN (NEW."draft_data"->>'adultOccupants')::integer END END;
		NEW."minor_occupants" := CASE WHEN NEW."draft_data"->>'minorOccupants' ~ '^[0-9]{1,2}$' THEN CASE WHEN (NEW."draft_data"->>'minorOccupants')::integer BETWEEN 0 AND 20 THEN (NEW."draft_data"->>'minorOccupants')::integer END END;
		NEW."intended_move_in_date" := "application_safe_iso_date"(NEW."draft_data"->>'intendedMoveInDate');
		NEW."normalized_phone" := CASE WHEN NEW."draft_data"->>'phone' ~ '^\+[1-9][0-9]{7,14}$' THEN regexp_replace(NEW."draft_data"->>'phone', '[^0-9]', '', 'g') END;
		NEW."normalized_email" := CASE WHEN lower(trim(NULLIF(NEW."draft_data"->>'email', ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(trim(NEW."draft_data"->>'email')) <= 320 THEN lower(trim(NEW."draft_data"->>'email')) WHEN lower(trim(account_email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(trim(account_email)) <= 320 THEN lower(trim(account_email)) END;
		NEW."adult_profiles" := "application_adult_profiles_from_draft"(NEW."draft_data", account_email, account_name);
		NEW."application_data_promoted_at" := now();
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "applications_legacy_promotion_trigger"
BEFORE INSERT OR UPDATE OF "submitted_at", "draft_data" ON "applications"
FOR EACH ROW
EXECUTE FUNCTION "promote_legacy_submitted_application"();
