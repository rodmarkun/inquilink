DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM applications a
    LEFT JOIN properties p ON p.id = a.property_id AND p.agency_id = a.agency_id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: application property/agency mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM applications a
    JOIN users u ON u.id = a.tenant_user_id
    WHERE u.kind <> 'tenant'
  ) THEN RAISE EXCEPTION 'rental graph audit failed: application owner is not a tenant'; END IF;

  IF EXISTS (
    SELECT 1 FROM properties p
    LEFT JOIN agency_memberships m ON m.agency_id = p.agency_id AND m.user_id = p.responsible_user_id
    WHERE p.responsible_user_id IS NOT NULL AND m.user_id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: property responsible user mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM applications a
    LEFT JOIN agency_memberships m ON m.agency_id = a.agency_id AND m.user_id = a.responsible_user_id
    WHERE a.responsible_user_id IS NOT NULL AND m.user_id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: application responsible user mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM application_documents d
    LEFT JOIN applications a ON a.id = d.application_id AND a.agency_id = d.agency_id AND a.tenant_user_id = d.tenant_user_id
    WHERE a.id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: document ownership mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM application_notes n
    LEFT JOIN applications a ON a.id = n.application_id AND a.agency_id = n.agency_id
    LEFT JOIN agency_memberships m ON m.agency_id = n.agency_id AND m.user_id = n.author_user_id
    WHERE a.id IS NULL OR m.user_id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: note ownership mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM application_status_history h
    LEFT JOIN applications a ON a.id = h.application_id AND a.agency_id = h.agency_id
    WHERE a.id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: status history ownership mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM appointments ap
    LEFT JOIN applications a ON a.id = ap.application_id AND a.agency_id = ap.agency_id AND a.property_id = ap.property_id
    LEFT JOIN agency_memberships m ON m.agency_id = ap.agency_id AND m.user_id = ap.responsible_user_id
    WHERE a.id IS NULL OR m.user_id IS NULL
  ) THEN RAISE EXCEPTION 'rental graph audit failed: appointment ownership mismatch'; END IF;
END $$;
--> statement-breakpoint
UPDATE applications a
SET document_state = CASE
  WHEN jsonb_array_length(p.requested_document_categories) = 0 THEN 'not_requested'::document_state
  WHEN NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(p.requested_document_categories) requested(category)
    WHERE NOT EXISTS (
      SELECT 1 FROM application_documents d
      WHERE d.application_id = a.id
        AND d.agency_id = a.agency_id
        AND d.tenant_user_id = a.tenant_user_id
        AND d.category = requested.category
        AND d.malware_scan_state = 'clean'
    )
  ) THEN 'complete'::document_state
  ELSE 'missing'::document_state
END,
updated_at = GREATEST(a.updated_at, now())
FROM properties p
WHERE p.id = a.property_id AND p.agency_id = a.agency_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "properties_id_agency_unique" ON "properties" USING btree ("id","agency_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "applications_id_agency_unique" ON "applications" USING btree ("id","agency_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "applications_id_agency_tenant_unique" ON "applications" USING btree ("id","agency_id","tenant_user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "applications_id_agency_property_unique" ON "applications" USING btree ("id","agency_id","property_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "applications_graph_unique" ON "applications" USING btree ("id","agency_id","property_id","tenant_user_id");
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "documents_application_graph_fk" FOREIGN KEY ("application_id","agency_id","tenant_user_id") REFERENCES "public"."applications"("id","agency_id","tenant_user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_application_agency_fk" FOREIGN KEY ("application_id","agency_id") REFERENCES "public"."applications"("id","agency_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "application_notes" ADD CONSTRAINT "application_notes_author_membership_fk" FOREIGN KEY ("agency_id","author_user_id") REFERENCES "public"."agency_memberships"("agency_id","user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "application_status_history" ADD CONSTRAINT "status_history_application_agency_fk" FOREIGN KEY ("application_id","agency_id") REFERENCES "public"."applications"("id","agency_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_property_agency_fk" FOREIGN KEY ("property_id","agency_id") REFERENCES "public"."properties"("id","agency_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_responsible_membership_fk" FOREIGN KEY ("agency_id","responsible_user_id") REFERENCES "public"."agency_memberships"("agency_id","user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_application_graph_fk" FOREIGN KEY ("application_id","agency_id","property_id") REFERENCES "public"."applications"("id","agency_id","property_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_responsible_membership_fk" FOREIGN KEY ("agency_id","responsible_user_id") REFERENCES "public"."agency_memberships"("agency_id","user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_responsible_membership_fk" FOREIGN KEY ("agency_id","responsible_user_id") REFERENCES "public"."agency_memberships"("agency_id","user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_application_tenant_kind() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.tenant_user_id AND kind = 'tenant') THEN
    RAISE EXCEPTION 'application tenant_user_id must reference a tenant account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER applications_tenant_kind_trigger
BEFORE INSERT OR UPDATE OF tenant_user_id ON applications
FOR EACH ROW EXECUTE FUNCTION enforce_application_tenant_kind();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_tenant_kind_change_with_applications() RETURNS trigger AS $$
BEGIN
  IF OLD.kind = 'tenant' AND NEW.kind <> 'tenant' AND EXISTS (SELECT 1 FROM applications WHERE tenant_user_id = OLD.id) THEN
    RAISE EXCEPTION 'cannot change tenant account kind while applications exist' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER users_tenant_kind_guard_trigger
BEFORE UPDATE OF kind ON users
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_kind_change_with_applications();
