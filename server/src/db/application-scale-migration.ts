import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/**
 * Resumable post-DDL data migration. Each batch commits independently because
 * the migration runner invokes this after Drizzle's schema transaction.
 */
export async function backfillSubmittedApplicationColumns(db: Database, batchSize = 1_000): Promise<number> {
  let updated = 0;
  for (;;) {
    const result = await db.execute<{ id: string }>(sql`
      with batch as (
        select id
        from applications
        where submitted_at is not null and application_data_promoted_at is null
        order by id
        limit ${batchSize}
      )
      update applications as application
      set
        phone = case when application.draft_data->>'phone' ~ '^\\+[1-9][0-9]{7,14}$' then application.draft_data->>'phone' end,
        individual_net_monthly_income_cents = case when application.draft_data->>'individualNetMonthlyIncomeCents' ~ '^[0-9]{1,9}$' then case when (application.draft_data->>'individualNetMonthlyIncomeCents')::bigint <= 100000000 then (application.draft_data->>'individualNetMonthlyIncomeCents')::integer end end,
        household_net_monthly_income_cents = case when application.draft_data->>'householdNetMonthlyIncomeCents' ~ '^[0-9]{1,9}$' then case when (application.draft_data->>'householdNetMonthlyIncomeCents')::bigint <= 100000000 then (application.draft_data->>'householdNetMonthlyIncomeCents')::integer end end,
        adult_occupants = case when application.draft_data->>'adultOccupants' ~ '^[0-9]{1,2}$' then case when (application.draft_data->>'adultOccupants')::integer between 1 and 20 then (application.draft_data->>'adultOccupants')::integer end end,
        minor_occupants = case when application.draft_data->>'minorOccupants' ~ '^[0-9]{1,2}$' then case when (application.draft_data->>'minorOccupants')::integer between 0 and 20 then (application.draft_data->>'minorOccupants')::integer end end,
        intended_move_in_date = application_safe_iso_date(application.draft_data->>'intendedMoveInDate'),
        normalized_phone = case when application.draft_data->>'phone' ~ '^\\+[1-9][0-9]{7,14}$' then regexp_replace(application.draft_data->>'phone', '[^0-9]', '', 'g') end,
        normalized_email = case when lower(trim(nullif(application.draft_data->>'email', ''))) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' and length(trim(application.draft_data->>'email')) <= 320 then lower(trim(application.draft_data->>'email')) when lower(trim(account.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' and length(trim(account.email)) <= 320 then lower(trim(account.email)) end,
        adult_profiles = application_adult_profiles_from_draft(application.draft_data, account.email, account.full_name),
        application_data_promoted_at = now()
      from batch, users as account
      where application.id = batch.id and account.id = application.tenant_user_id
      returning application.id
    `);
    const returnedRows = Array.isArray(result) ? result : ((result as unknown as { rows?: Array<{ id: string }> }).rows ?? []);
    const ids = returnedRows.map((row) => row.id).sort();
    updated += ids.length;
    if (ids.length === 0) return updated;
  }
}

type IndexSpec = { name: string; create: string };

function resultRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result as T[] : ((result as { rows?: T[] }).rows ?? []);
}

const scaleIndexes: IndexSpec[] = [
  { name: "applications_income_sort_idx", create: 'create index concurrently if not exists "applications_income_sort_idx" on "applications" using btree ("agency_id", "property_id", "household_net_monthly_income_cents" desc nulls last, "submitted_at" desc nulls last, "id" asc)' },
  { name: "applications_phone_search_idx", create: 'create index concurrently if not exists "applications_phone_search_idx" on "applications" using btree ("phone" varchar_pattern_ops)' },
  { name: "appointments_application_idx", create: 'create index concurrently if not exists "appointments_application_idx" on "appointments" using btree ("application_id")' },
  { name: "audit_application_subject_idx", create: 'create index concurrently if not exists "audit_application_subject_idx" on "audit_events" using btree ("agency_id", "subject_type", "subject_id", "created_at")' },
  { name: "audit_application_metadata_idx", create: 'create index concurrently if not exists "audit_application_metadata_idx" on "audit_events" using btree ("agency_id", (("metadata"->>\'applicationId\')), "created_at")' },
];

/**
 * Indexes are built outside Drizzle's migration transaction to avoid blocking writes.
 * PostgreSQL retains an invalid index after some interrupted concurrent builds, so
 * repair that state before retrying and verify every build before returning.
 */
export async function ensureApplicationScaleIndexes(db: Database): Promise<void> {
  for (const index of scaleIndexes) {
    const status = resultRows<{ isValid: boolean }>(await db.execute(sql`
      select pg_index.indisvalid as "isValid"
      from pg_catalog.pg_class
      join pg_catalog.pg_index on pg_index.indexrelid = pg_class.oid
      join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = current_schema() and pg_class.relname = ${index.name}
    `))[0];
    if (status && !status.isValid) {
      await db.execute(sql.raw(`drop index concurrently if exists "${index.name}"`));
    }
    await db.execute(sql.raw(index.create));
    const verified = resultRows<{ isValid: boolean }>(await db.execute(sql`
      select pg_index.indisvalid as "isValid"
      from pg_catalog.pg_class
      join pg_catalog.pg_index on pg_index.indexrelid = pg_class.oid
      join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = current_schema() and pg_class.relname = ${index.name}
    `))[0];
    if (!verified?.isValid) throw new Error(`Index ${index.name} was not built successfully.`);
  }
}
