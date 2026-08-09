import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";

let client: PGlite | null = null;
afterEach(async () => { await client?.close(); client = null; });

async function applyMigrationFiles(database: PGlite, from: number, through: number): Promise<void> {
  const directory = new URL("../../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const file of files) {
    const index = Number(file.slice(0, 4));
    if (index < from || index > through) continue;
    const sql = await readFile(new URL(file, directory), "utf8");
    for (const statement of sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
      await database.exec(statement);
    }
  }
}

it("upgrades dirty pre-0016 data to privacy-safe deletes and tenant-safe billing ownership", async () => {
  client = new PGlite();
  await applyMigrationFiles(client, 0, 15);
  const now = "2026-08-08T10:00:00.000Z";
  await client.exec(`
    insert into users (id, kind, email, full_name, password_hash, email_verified_at, created_at, updated_at)
    values ('96000000-0000-4000-8000-000000000001', 'tenant', 'upgrade@example.es', 'Upgrade', 'hash', '${now}', '${now}', '${now}');
    insert into agencies (id, name, created_at, updated_at) values
      ('96000000-0000-4000-8000-000000000002', 'Agency A', '${now}', '${now}'),
      ('96000000-0000-4000-8000-000000000003', 'Agency B', '${now}', '${now}');
    insert into billing_operations (id, agency_id, operation, idempotency_key_hash, request_fingerprint, state, created_at, updated_at)
    values ('96000000-0000-4000-8000-000000000004', '96000000-0000-4000-8000-000000000002', 'cancel', repeat('a', 64), repeat('b', 64), 'pending', '${now}', '${now}');
    insert into subscriptions (id, agency_id, plan, state, pending_billing_operation_id, created_at, updated_at)
    values ('96000000-0000-4000-8000-000000000005', '96000000-0000-4000-8000-000000000003', 'pro', 'active', '96000000-0000-4000-8000-000000000004', '${now}', '${now}');
    insert into subscriptions (id, agency_id, plan, state, created_at, updated_at)
    values ('96000000-0000-4000-8000-000000000009', '96000000-0000-4000-8000-000000000002', 'business', 'active', '${now}', '${now}');
    insert into invoices (id, agency_id, subscription_id, provider_invoice_ref, amount_cents, currency, status, issued_at)
    values ('96000000-0000-4000-8000-000000000006', '96000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000005', 'dirty-cross-agency', 4999, 'EUR', 'paid', '${now}');
    insert into analytics_events (id, actor_user_id, event_name, occurred_at)
    values ('96000000-0000-4000-8000-000000000007', '96000000-0000-4000-8000-000000000001', 'tenant_account_created', '${now}');
  `);

  await applyMigrationFiles(client, 16, 23);
  const foreignKeys = await client.query<{ conname: string; confdeltype: string }>(`
    select conname, confdeltype::text from pg_constraint
    where conname in ('analytics_events_actor_user_id_users_id_fk', 'audit_events_actor_user_id_users_id_fk')
    order by conname
  `);
  expect(foreignKeys.rows).toEqual([
    { conname: "analytics_events_actor_user_id_users_id_fk", confdeltype: "c" },
    { conname: "audit_events_actor_user_id_users_id_fk", confdeltype: "n" },
  ]);
  const dueIndexes = await client.query<{ indexname: string }>(`
    select indexname from pg_indexes
    where indexname in ('sessions_expiry_idx', 'one_time_tokens_expiry_idx', 'one_time_tokens_used_idx')
    order by indexname
  `);
  expect(dueIndexes.rows.map((row) => row.indexname)).toEqual([
    "one_time_tokens_expiry_idx", "one_time_tokens_used_idx", "sessions_expiry_idx",
  ]);
  expect((await client.query<{ agency_id: string }>(`select agency_id from invoices where provider_invoice_ref = 'dirty-cross-agency'`)).rows[0]?.agency_id)
    .toBe("96000000-0000-4000-8000-000000000003");
  expect((await client.query<{ pending_billing_operation_id: string | null }>(`select pending_billing_operation_id from subscriptions where id = '96000000-0000-4000-8000-000000000005'`)).rows[0]?.pending_billing_operation_id)
    .toBeNull();
  expect((await client.query<{ id: string; plan: string }>(`select id, plan::text from subscriptions order by id`)).rows).toEqual([
    { id: "96000000-0000-4000-8000-000000000005", plan: "professional" },
    { id: "96000000-0000-4000-8000-000000000009", plan: "inmobiliaria" },
  ]);

  await client.exec(`delete from users where id = '96000000-0000-4000-8000-000000000001'`);
  expect((await client.query(`select 1 from analytics_events where id = '96000000-0000-4000-8000-000000000007'`)).rows).toHaveLength(0);
  await expect(client.exec(`
    insert into invoices (id, agency_id, subscription_id, provider_invoice_ref, amount_cents, currency, status, issued_at)
    values ('96000000-0000-4000-8000-000000000008', '96000000-0000-4000-8000-000000000002', '96000000-0000-4000-8000-000000000005', 'still-cross-agency', 4999, 'EUR', 'paid', '${now}')
  `)).rejects.toBeTruthy();
});

it("expires uncorrelated credential emails during incremental upgrades", async () => {
  client = new PGlite();
  await applyMigrationFiles(client, 0, 13);
  const now = "2026-08-08T10:00:00.000Z";
  await client.exec(`
    insert into email_outbox (id, recipient, template, variables, state, attempts, available_at, expires_at, created_at)
    values ('legacy-reset', 'legacy@example.es', 'reset_password', '{"token":"legacy-secret","returnPath":"/"}', 'pending', 0, '${now}', '2026-08-15T10:00:00.000Z', '${now}');
  `);
  await applyMigrationFiles(client, 14, 14);
  expect((await client.query<{ state: string; recipient: string; variables: Record<string, unknown> }>(`select state, recipient, variables from email_outbox where id = 'legacy-reset'`)).rows[0])
    .toEqual({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {} });

  await client.exec(`
    insert into email_outbox (id, user_id, agency_id, recipient, template, variables, state, attempts, available_at, expires_at, created_at)
    values ('legacy-invite', null, '97000000-0000-4000-8000-000000000001', 'invite@example.es', 'team_invitation', '{"token":"legacy-invite-secret","agencyName":"Legacy"}', 'pending', 0, '${now}', '2026-08-15T10:00:00.000Z', '${now}');
  `);
  await applyMigrationFiles(client, 15, 23);
  expect((await client.query<{ state: string; recipient: string; variables: Record<string, unknown> }>(`select state, recipient, variables from email_outbox where id = 'legacy-invite'`)).rows[0])
    .toEqual({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {} });
});

it("upgrades an in-flight legacy application retention claim without violating claim parity", async () => {
  client = new PGlite();
  await applyMigrationFiles(client, 0, 18);
  const old = "2025-01-01T00:00:00.000Z";
  await client.exec(`
    insert into users (id, kind, email, full_name, password_hash, email_verified_at, created_at, updated_at)
    values ('98000000-0000-4000-8000-000000000001', 'tenant', 'retention-upgrade@example.es', 'Retention Upgrade', 'hash', '${old}', '${old}', '${old}');
    insert into agencies (id, name, created_at, updated_at)
    values ('98000000-0000-4000-8000-000000000002', 'Retention Agency', '${old}', '${old}');
    insert into properties (id, agency_id, internal_reference, title, city, province, monthly_rent_cents, created_at, updated_at)
    values ('98000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000002', 'RET-UPGRADE', 'Legacy property', 'Madrid', 'Madrid', 100000, '${old}', '${old}');
    insert into applications (id, agency_id, property_id, tenant_user_id, status, submitted_at, created_at, updated_at)
    values ('98000000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000002', '98000000-0000-4000-8000-000000000003', '98000000-0000-4000-8000-000000000001', 'rejected', '${old}', '${old}', '${old}');
    update applications
    set retention_state = 'deleting', retention_claimed_at = '2026-08-08T10:00:00.000Z'
    where id = '98000000-0000-4000-8000-000000000004';
  `);

  await applyMigrationFiles(client, 19, 23);
  const upgraded = (await client.query<{
    retention_state: string;
    retention_claimed_at: string | null;
    retention_claim_token: string | null;
    retention_attempts: number;
  }>(`
    select retention_state, retention_claimed_at, retention_claim_token, retention_attempts
    from applications where id = '98000000-0000-4000-8000-000000000004'
  `)).rows[0];
  expect(upgraded).toMatchObject({
    retention_state: "deleting", retention_claimed_at: null, retention_claim_token: null, retention_attempts: 0,
  });
  await client.exec(`
    update applications set retention_attempts = retention_attempts + 1,
      retention_claimed_at = '2026-08-08T11:00:00.000Z', retention_claim_token = 'recovered-claim'
    where id = '98000000-0000-4000-8000-000000000004'
  `);
  await expect(client.exec(`
    update applications set status = 'selected'
    where id = '98000000-0000-4000-8000-000000000004'
  `)).rejects.toBeTruthy();
});
