import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agencies, agencyClosureCleanup, agencyMemberships, analyticsEvents, applicationDocuments, applicationNotes, applications, documentStorageCleanup, properties, users } from "../../db/schema.js";
import { createTestApp } from "../../test/test-app.js";
import { runDataLifecycle } from "./lifecycle.js";
import { MemoryPrivateDocumentStorage } from "./storage.js";
import type { PrivateDocumentStorage, StoredObject } from "./storage.js";
import { PROPERTY_COVER_STAGING_REASON } from "../property-images/storage-key.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
let storage: MemoryPrivateDocumentStorage;

class FailOnceStorage implements PrivateDocumentStorage {
  constructor(private readonly delegate: MemoryPrivateDocumentStorage, private readonly targetKey: string) {}
  failed = false;
  put(input: { key: string; body: Buffer; contentType: "application/pdf" | "image/jpeg" | "image/png" }): Promise<void> { return this.delegate.put(input); }
  get(key: string): Promise<StoredObject | null> { return this.delegate.get(key); }
  async delete(key: string): Promise<void> {
    if (!this.failed && key === this.targetKey) { this.failed = true; throw new Error("DELETE_FAILED_ONCE"); }
    await this.delegate.delete(key);
  }
}

class FailKeysStorage implements PrivateDocumentStorage {
  constructor(private readonly delegate: MemoryPrivateDocumentStorage, private readonly failedKeys: Set<string>) {}
  put(input: { key: string; body: Buffer; contentType: "application/pdf" | "image/jpeg" | "image/png" }): Promise<void> { return this.delegate.put(input); }
  get(key: string): Promise<StoredObject | null> { return this.delegate.get(key); }
  async delete(key: string): Promise<void> {
    if (this.failedKeys.has(key)) throw new Error("PERMANENT_DELETE_FAILURE");
    await this.delegate.delete(key);
  }
}

const ids = {
  agency: "91000000-0000-4000-8000-000000000001",
  tenant: "91000000-0000-4000-8000-000000000002",
  tenantSelected: "91000000-0000-4000-8000-000000000008",
  property: "91000000-0000-4000-8000-000000000003",
  rejected: "91000000-0000-4000-8000-000000000004",
  selected: "91000000-0000-4000-8000-000000000005",
  rejectedDocument: "91000000-0000-4000-8000-000000000006",
  pendingDocument: "91000000-0000-4000-8000-000000000007",
  scanRaceDocument: "91000000-0000-4000-8000-000000000010",
  ledgerRaceDocument: "91000000-0000-4000-8000-000000000011",
};

beforeEach(async () => {
  storage = new MemoryPrivateDocumentStorage();
  context = await createTestApp({}, undefined, { rentals: { storage } });
  const old = new Date("2025-01-01T00:00:00.000Z");
  const passwordHash = await argon2.hash("password");
  await context.db.insert(users).values([
    { id: ids.tenant, kind: "tenant", email: "retention@example.es", fullName: "Inés Mora", passwordHash, emailVerifiedAt: old, createdAt: old, updatedAt: old },
    { id: ids.tenantSelected, kind: "tenant", email: "selected@example.es", fullName: "Álvaro Navas", passwordHash, emailVerifiedAt: old, createdAt: old, updatedAt: old },
  ]);
  await context.db.insert(agencies).values({ id: ids.agency, name: "Agencia Retención", createdAt: old, updatedAt: old });
  await context.db.insert(properties).values({ id: ids.property, agencyId: ids.agency, internalReference: "RET-001", title: "Piso de prueba", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, requestedDocumentCategories: ["payslips"], createdAt: old, updatedAt: old });
  await context.db.insert(applications).values([
    { id: ids.rejected, agencyId: ids.agency, propertyId: ids.property, tenantUserId: ids.tenant, status: "rejected", submittedAt: old, createdAt: old, updatedAt: old },
    { id: ids.selected, agencyId: ids.agency, propertyId: ids.property, tenantUserId: ids.tenantSelected, status: "selected", submittedAt: old, createdAt: old, updatedAt: old },
  ]);
  await context.db.insert(applicationDocuments).values([
    { id: ids.rejectedDocument, applicationId: ids.rejected, agencyId: ids.agency, tenantUserId: ids.tenant, category: "payslips", storageKey: "retention/rejected", originalName: "nomina.pdf", contentType: "application/pdf", byteSize: 10, malwareScanState: "clean", deletionNextAttemptAt: old, createdAt: old, updatedAt: old },
    { id: ids.pendingDocument, applicationId: ids.selected, agencyId: ids.agency, tenantUserId: ids.tenantSelected, category: "payslips", storageKey: "retention/pending", originalName: "nomina.pdf", contentType: "application/pdf", byteSize: 10, malwareScanState: "clean", deletionState: "deleting", deletionNextAttemptAt: old, deleteRequestedAt: old, createdAt: old, updatedAt: old },
  ]);
  await storage.put({ key: "retention/rejected", body: Buffer.from("%PDF-old"), contentType: "application/pdf" });
  await storage.put({ key: "retention/pending", body: Buffer.from("%PDF-pending"), contentType: "application/pdf" });
});

afterEach(async () => context.close());

it("always retries tombstones but does not invent a retention period", async () => {
  const result = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T00:00:00.000Z") });
  expect(result).toMatchObject({ pendingDeleted: 1, retentionEnabled: false, applicationsDeleted: 0 });
  expect(await storage.get("retention/pending")).toBeNull();
  expect((await context.db.select().from(applications)).map((application) => application.id)).toContain(ids.rejected);
});

it("does not tombstone a staged document that becomes clean after candidate selection", async () => {
  const old = new Date("2025-01-01T00:00:00.000Z");
  await context.db.insert(applicationDocuments).values({
    id: ids.scanRaceDocument, applicationId: ids.selected, agencyId: ids.agency, tenantUserId: ids.tenantSelected,
    category: "employment_contract", storageKey: "retention/scan-race", originalName: "contrato.pdf",
    contentType: "application/pdf", byteSize: 10, malwareScanState: "pending", deletionState: "active",
    deletionNextAttemptAt: old, createdAt: old, updatedAt: old,
  });
  await storage.put({ key: "retention/scan-race", body: Buffer.from("%PDF-clean"), contentType: "application/pdf" });

  const result = await runDataLifecycle(context.db, storage, {
    now: new Date("2098-08-08T00:00:00.000Z"),
    beforeDocumentClaim: async (documentId) => {
      if (documentId === ids.scanRaceDocument) {
        await context.db.update(applicationDocuments).set({ malwareScanState: "clean", updatedAt: new Date("2098-08-08T00:00:00.000Z") })
          .where(eq(applicationDocuments.id, documentId));
      }
    },
  });

  expect(result.orphanDeleted).toBe(0);
  expect((await context.db.select().from(applicationDocuments).where(eq(applicationDocuments.id, ids.scanRaceDocument)))[0]).toMatchObject({
    malwareScanState: "clean", deletionState: "active", deletionClaimToken: null,
  });
  expect(await storage.get("retention/scan-race")).not.toBeNull();
  expect(await context.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, "retention/scan-race"))).toHaveLength(0);
});

it("does not claim a document after another worker creates its cleanup ledger entry", async () => {
  const old = new Date("2025-01-01T00:00:00.000Z");
  await context.db.insert(applicationDocuments).values({
    id: ids.ledgerRaceDocument, applicationId: ids.selected, agencyId: ids.agency, tenantUserId: ids.tenantSelected,
    category: "employment_contract", storageKey: "retention/ledger-race", originalName: "contrato.pdf",
    contentType: "application/pdf", byteSize: 10, malwareScanState: "pending", deletionState: "active",
    deletionNextAttemptAt: old, createdAt: old, updatedAt: old,
  });
  await storage.put({ key: "retention/ledger-race", body: Buffer.from("%PDF-ledger"), contentType: "application/pdf" });
  const now = new Date("2098-08-08T00:00:00.000Z");
  await runDataLifecycle(context.db, storage, {
    now,
    beforeDocumentClaim: async (documentId) => {
      if (documentId === ids.ledgerRaceDocument) {
        await context.db.insert(documentStorageCleanup).values({
          id: "91000000-0000-4000-8000-000000000012", storageKey: "retention/ledger-race",
          agencyId: ids.agency, applicationId: ids.selected, reason: "COMPETING_WORKER",
          nextAttemptAt: new Date("2099-01-01T00:00:00.000Z"), createdAt: now, updatedAt: now,
        });
      }
    },
  });
  expect((await context.db.select().from(applicationDocuments).where(eq(applicationDocuments.id, ids.ledgerRaceDocument)))[0]).toMatchObject({
    deletionState: "active", deletionClaimToken: null, deletionAttempts: 0,
  });
  expect(await storage.get("retention/ledger-race")).not.toBeNull();
});

it("purges only terminal unsuccessful applications after an explicit retention period", async () => {
  const first = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T00:00:00.000Z"), retentionDays: 365 });
  expect(first).toMatchObject({ retentionEnabled: true, applicationsDeleted: 0, applicationsDeferred: 1 });
  const result = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T00:01:00.000Z"), retentionDays: 365 });
  expect(result.applicationsDeleted).toBe(1);
  expect((await context.db.select().from(applications).where(eq(applications.id, ids.rejected)))).toHaveLength(0);
  expect((await context.db.select().from(applications).where(eq(applications.id, ids.selected)))).toHaveLength(1);
  expect(await storage.get("retention/rejected")).toBeNull();
});

it("does not claim an active application whose retention age is reset after discovery", async () => {
  await context.db.delete(applicationDocuments).where(eq(applicationDocuments.id, ids.rejectedDocument));
  const refreshedAt = new Date("2098-08-08T00:00:00.000Z");
  const result = await runDataLifecycle(context.db, storage, {
    now: refreshedAt,
    retentionDays: 365,
    beforeApplicationRetentionClaim: async (applicationId) => {
      if (applicationId === ids.rejected) {
        await context.db.update(applications).set({ updatedAt: refreshedAt }).where(eq(applications.id, applicationId));
      }
    },
  });
  expect(result.applicationsDeleted).toBe(0);
  expect((await context.db.select().from(applications).where(eq(applications.id, ids.rejected)))[0]).toMatchObject({
    retentionState: "active", retentionClaimToken: null, updatedAt: refreshedAt,
  });
});

it("retries retention deletion without recomputing a deleting parent", async () => {
  const failOnce = new FailOnceStorage(storage, "retention/rejected");
  const first = await runDataLifecycle(context.db, failOnce, { now: new Date("2098-08-08T00:00:00.000Z"), retentionDays: 365 });
  expect(first).toMatchObject({ applicationsDeleted: 0, applicationsDeferred: 1, pendingFailed: 0 });
  expect((await context.db.select().from(applications).where(eq(applications.id, ids.rejected)))[0]?.retentionState).toBe("deleting");
  const second = await runDataLifecycle(context.db, failOnce, { now: new Date("2098-08-08T00:01:00.000Z"), retentionDays: 365 });
  expect(second).toMatchObject({ applicationsDeleted: 0, pendingFailed: 1 });
  const third = await runDataLifecycle(context.db, failOnce, { now: new Date("2098-08-08T00:03:00.000Z"), retentionDays: 365 });
  expect(third.applicationsDeleted).toBe(1);
  expect(await storage.get("retention/rejected")).toBeNull();
});

it("keeps closed accounts disabled indefinitely unless purge is configured, then removes blobs first", async () => {
  const requestedAt = new Date("2025-01-01T00:00:00.000Z");
  await context.db.insert(analyticsEvents).values({
    id: "91000000-0000-4000-8000-000000000009",
    actorUserId: ids.tenantSelected,
    eventName: "tenant_account_created",
    occurredAt: requestedAt,
  });
  await context.db.update(users).set({ accountState: "closure_requested", closureRequestedAt: requestedAt, accountPurgeNextAttemptAt: requestedAt, updatedAt: requestedAt }).where(eq(users.id, ids.tenantSelected));
  const disabledPolicy = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T00:00:00.000Z") });
  expect(disabledPolicy.accountClosureEnabled).toBe(false);
  expect((await context.db.select().from(users).where(eq(users.id, ids.tenantSelected)))).toHaveLength(1);
  const purged = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T00:01:00.000Z"), accountRetentionDays: 0 });
  expect(purged.tenantAccountsDeleted).toBe(1);
  expect(await storage.get("retention/pending")).toBeNull();
  expect((await context.db.select().from(users).where(eq(users.id, ids.tenantSelected)))).toHaveLength(0);
  expect(await context.db.select().from(analyticsEvents).where(eq(analyticsEvents.actorUserId, ids.tenantSelected))).toHaveLength(0);
});

it("orders due cleanup deterministically, backs off failures, and lets later rows progress past a full batch", async () => {
  const due = new Date("2098-01-01T00:00:00.000Z");
  await context.db.delete(applicationDocuments);
  await context.db.delete(documentStorageCleanup);
  for (const [index, key] of ["cleanup/fails", "cleanup/second", "cleanup/third"].entries()) {
    await storage.put({ key, body: Buffer.from("blob"), contentType: "application/pdf" });
    await context.db.insert(documentStorageCleanup).values({
      id: `92000000-0000-4000-8000-00000000000${index + 1}`, storageKey: key,
      agencyId: ids.agency, applicationId: ids.rejected, reason: "TEST", nextAttemptAt: due,
      createdAt: new Date(due.getTime() + index), updatedAt: due,
    });
  }
  const failing = new FailKeysStorage(storage, new Set(["cleanup/fails"]));
  const first = await runDataLifecycle(context.db, failing, { now: due, batchSize: 2 });
  expect(first).toMatchObject({ orphanFailed: 1, orphanDeleted: 1 });
  expect(await storage.get("cleanup/second")).toBeNull();
  const failedAfterFirst = (await context.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, "cleanup/fails")))[0]!;
  expect(failedAfterFirst).toMatchObject({ attempts: 1, claimToken: null, claimedAt: null });
  expect(failedAfterFirst.nextAttemptAt).toBeInstanceOf(Date);
  expect(failedAfterFirst.nextAttemptAt.getTime()).toBeGreaterThan(due.getTime());

  const immediate = await runDataLifecycle(context.db, failing, { now: due, batchSize: 2 });
  expect(immediate).toMatchObject({ orphanFailed: 0, orphanDeleted: 1 });
  expect(await storage.get("cleanup/third")).toBeNull();
  expect((await context.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, "cleanup/fails")))[0]?.attempts).toBe(1);
  const retried = await runDataLifecycle(context.db, failing, { now: new Date(due.getTime() + 2 * 60_000), batchSize: 2 });
  expect(retried.orphanFailed).toBe(1);
  expect((await context.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, "cleanup/fails")))[0]?.attempts).toBe(2);
});

it("recovers an expired cleanup claim lease", async () => {
  const now = new Date("2098-01-01T01:00:00.000Z");
  await storage.put({ key: "cleanup/stale", body: Buffer.from("blob"), contentType: "application/pdf" });
  await context.db.insert(documentStorageCleanup).values({
    id: "92000000-0000-4000-8000-000000000010", storageKey: "cleanup/stale", agencyId: ids.agency,
    applicationId: ids.rejected, reason: "TEST", attempts: 1, nextAttemptAt: new Date(now.getTime() - 60_000),
    claimedAt: new Date(now.getTime() - 6 * 60_000), claimToken: "stale-claim", createdAt: new Date(now.getTime() - 10 * 60_000), updatedAt: now,
  });
  const result = await runDataLifecycle(context.db, storage, { now, batchSize: 1 });
  expect(result.orphanDeleted).toBe(1);
  expect(await storage.get("cleanup/stale")).toBeNull();
});

it("never cleans a live cover staging lease and recovers one abandoned by a crash", async () => {
  const now = new Date("2098-01-01T01:00:00.000Z");
  await storage.put({ key: "covers/live", body: Buffer.from("live"), contentType: "image/png" });
  await storage.put({ key: "covers/abandoned", body: Buffer.from("abandoned"), contentType: "image/png" });
  await context.db.insert(documentStorageCleanup).values([
    {
      id: "92000000-0000-4000-8000-000000000012", storageKey: "covers/live", agencyId: ids.agency,
      applicationId: ids.property, reason: PROPERTY_COVER_STAGING_REASON, attempts: 0, nextAttemptAt: new Date(now.getTime() - 60_000),
      createdAt: new Date(now.getTime() - 60_000), updatedAt: new Date(now.getTime() - 60_000),
    },
    {
      id: "92000000-0000-4000-8000-000000000013", storageKey: "covers/abandoned", agencyId: ids.agency,
      applicationId: ids.property, reason: PROPERTY_COVER_STAGING_REASON, attempts: 0, nextAttemptAt: new Date(now.getTime() - 10 * 60_000),
      createdAt: new Date(now.getTime() - 10 * 60_000), updatedAt: new Date(now.getTime() - 6 * 60_000),
    },
  ]);

  const result = await runDataLifecycle(context.db, storage, { now });
  expect(result.orphanDeleted).toBe(1);
  expect(await storage.get("covers/live")).not.toBeNull();
  expect((await context.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, "covers/live")))[0]?.reason).toBe(PROPERTY_COVER_STAGING_REASON);
  expect(await storage.get("covers/abandoned")).toBeNull();
});

it("purges a closed former agency member while preserving the active agency and anonymizing history", async () => {
  const old = new Date("2025-01-01T00:00:00.000Z");
  const formerId = "92000000-0000-4000-8000-000000000020";
  await context.db.insert(users).values({
    id: formerId, kind: "agency", email: "former@example.es", fullName: "Antigua Colaboradora", passwordHash: "scrubbed",
    accountState: "closure_requested", closureRequestedAt: old, accountPurgeNextAttemptAt: old, createdAt: old, updatedAt: old,
  });
  await context.db.insert(agencyMemberships).values({ agencyId: ids.agency, userId: formerId, role: "collaborator", createdAt: old });
  await context.db.insert(applicationNotes).values({ id: "92000000-0000-4000-8000-000000000021", agencyId: ids.agency, applicationId: ids.rejected, authorUserId: formerId, body: "Histórico", createdAt: old });
  await context.db.delete(agencyMemberships).where(eq(agencyMemberships.userId, formerId));
  const result = await runDataLifecycle(context.db, storage, { now: new Date("2098-01-01T00:00:00.000Z"), accountRetentionDays: 0 });
  expect(result.tenantAccountsDeleted).toBe(1);
  expect(await context.db.select().from(users).where(eq(users.id, formerId))).toHaveLength(0);
  expect((await context.db.select().from(applicationNotes).where(eq(applicationNotes.id, "92000000-0000-4000-8000-000000000021")))[0]?.authorUserId).toBeNull();
  expect(await context.db.select().from(agencies).where(eq(agencies.id, ids.agency))).toHaveLength(1);
});

it("rolls back the entire local agency purge graph on a crash and converges after the stale lease", async () => {
  const old = new Date("2025-01-01T00:00:00.000Z");
  const agencyId = "92000000-0000-4000-8000-000000000030";
  const memberId = "92000000-0000-4000-8000-000000000031";
  await context.db.insert(users).values({ id: memberId, kind: "agency", email: "purge@example.es", fullName: "Purge", passwordHash: "scrubbed", accountState: "closure_requested", closureRequestedAt: old, accountPurgeNextAttemptAt: old, createdAt: old, updatedAt: old });
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia a purgar", accountState: "closure_requested", closureRequestedAt: old, accountPurgeNextAttemptAt: old, createdAt: old, updatedAt: old });
  await context.db.insert(agencyMemberships).values({ agencyId, userId: memberId, role: "admin", createdAt: old });
  await context.db.insert(agencyClosureCleanup).values({ id: "92000000-0000-4000-8000-000000000032", agencyId, state: "ready_for_purge", nextAttemptAt: old, createdAt: old, updatedAt: old });
  await expect(runDataLifecycle(context.db, storage, { now: new Date("2098-01-01T00:00:00.000Z"), accountRetentionDays: 0, beforeAgencyPurgeCommit: async () => { throw new Error("CRASH"); } })).rejects.toThrow("CRASH");
  expect(await context.db.select().from(agencies).where(eq(agencies.id, agencyId))).toHaveLength(1);
  expect(await context.db.select().from(users).where(eq(users.id, memberId))).toHaveLength(1);
  expect((await context.db.select().from(agencyClosureCleanup).where(eq(agencyClosureCleanup.agencyId, agencyId)))[0]?.state).toBe("ready_for_purge");
  const retried = await runDataLifecycle(context.db, storage, { now: new Date("2098-01-01T00:06:00.000Z"), accountRetentionDays: 0 });
  expect(retried.agenciesDeleted).toBe(1);
  expect(await context.db.select().from(agencies).where(eq(agencies.id, agencyId))).toHaveLength(0);
  expect(await context.db.select().from(users).where(eq(users.id, memberId))).toHaveLength(0);
  expect((await context.db.select().from(agencyClosureCleanup).where(eq(agencyClosureCleanup.agencyId, agencyId)))[0]?.state).toBe("completed");
});

it("queues property covers durably and deletes them before purging a closed agency", async () => {
  const old = new Date("2025-01-01T00:00:00.000Z");
  const agencyId = "92000000-0000-4000-8000-000000000040";
  const memberId = "92000000-0000-4000-8000-000000000041";
  const propertyId = "92000000-0000-4000-8000-000000000042";
  const version = "92000000-0000-4000-8000-000000000043";
  const storageKey = `properties/${propertyId}/cover/${version}`;
  await storage.put({ key: storageKey, body: Buffer.from("cover"), contentType: "image/png" });
  await context.db.insert(users).values({ id: memberId, kind: "agency", email: "cover-purge@example.es", fullName: "Purge Cover", passwordHash: "scrubbed", accountState: "closure_requested", closureRequestedAt: old, accountPurgeNextAttemptAt: old, createdAt: old, updatedAt: old });
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia con portada", accountState: "closure_requested", closureRequestedAt: old, accountPurgeNextAttemptAt: old, createdAt: old, updatedAt: old });
  await context.db.insert(agencyMemberships).values({ agencyId, userId: memberId, role: "admin", createdAt: old });
  await context.db.insert(properties).values({ id: propertyId, agencyId, internalReference: "COVER-1", title: "Piso con portada", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, coverImageUrl: `http://localhost:3000/api/v1/property-images/${propertyId}/${version}`, createdAt: old, updatedAt: old });
  await context.db.insert(agencyClosureCleanup).values({ id: "92000000-0000-4000-8000-000000000044", agencyId, state: "ready_for_purge", nextAttemptAt: old, createdAt: old, updatedAt: old });

  const queued = await runDataLifecycle(context.db, storage, { now: new Date("2098-01-01T00:00:00.000Z"), accountRetentionDays: 0 });
  expect(queued).toMatchObject({ agenciesDeleted: 0, accountClosuresDeferred: 1 });
  expect((await context.db.select().from(properties).where(eq(properties.id, propertyId)))[0]?.coverImageUrl).toBeNull();
  expect((await context.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, storageKey)))[0]?.reason).toBe("PROPERTY_COVER_ACCOUNT_CLOSURE");

  const purged = await runDataLifecycle(context.db, storage, { now: new Date("2098-01-01T00:01:00.000Z"), accountRetentionDays: 0 });
  expect(purged.agenciesDeleted).toBe(1);
  expect(await storage.get(storageKey)).toBeNull();
  expect(await context.db.select().from(agencies).where(eq(agencies.id, agencyId))).toHaveLength(0);
});
