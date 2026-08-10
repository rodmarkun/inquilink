import { and, asc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agencies, agencyClosureCleanup, agencyMemberships, applicationDocuments, applications, documentStorageCleanup, properties, users } from "../../db/schema.js";
import type { PrivateDocumentStorage } from "./storage.js";
import { hashSecret, newId, newSecret } from "../../lib/ids.js";
import { lockAgencyForSystem } from "../agency-lock.js";
import { PROPERTY_COVER_STAGING_CLEANUP_REASON, PROPERTY_COVER_STAGING_LEASE_MS, PROPERTY_COVER_STAGING_REASON, propertyImageStorageKeyFromUrl } from "../property-images/storage-key.js";

const CLAIM_LEASE_MS = 5 * 60_000;
const INITIAL_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;

function retryAt(now: Date, attempts: number, id: string): Date {
  const base = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = Number.parseInt(hashSecret(id).slice(0, 6), 16) % Math.max(1, Math.floor(base / 10));
  return new Date(now.getTime() + base + jitter);
}

type LifecycleResult = {
  pendingDeleted: number;
  pendingFailed: number;
  orphanDeleted: number;
  orphanFailed: number;
  applicationsDeleted: number;
  applicationsDeferred: number;
  retentionEnabled: boolean;
  accountClosureEnabled: boolean;
  tenantAccountsDeleted: number;
  agenciesDeleted: number;
  accountClosuresDeferred: number;
};

async function recomputeDocumentStateLocked(db: Database, applicationId: string, agencyId: string, now: Date): Promise<void> {
  const applicationRows = await db.select({ propertyId: applications.propertyId, retentionState: applications.retentionState })
    .from(applications).where(and(eq(applications.id, applicationId), eq(applications.agencyId, agencyId))).for("update").limit(1);
  const application = applicationRows[0];
  if (!application || application.retentionState !== "active") return;
  const propertyRows = await db.select({ requested: properties.requestedDocumentCategories }).from(properties)
    .where(and(eq(properties.id, application.propertyId), eq(properties.agencyId, agencyId))).for("update").limit(1);
  const requested = propertyRows[0]?.requested ?? [];
  const documents = await db.select({ category: applicationDocuments.category }).from(applicationDocuments).where(and(
    eq(applicationDocuments.applicationId, applicationId),
    eq(applicationDocuments.agencyId, agencyId),
    eq(applicationDocuments.malwareScanState, "clean"),
    eq(applicationDocuments.deletionState, "active"),
  ));
  const present = new Set(documents.map((document) => document.category));
  const documentState = requested.length === 0 ? "not_requested"
    : requested.every((category) => present.has(category)) ? "complete" : "missing";
  await db.update(applications).set({ documentState, updatedAt: now }).where(and(
    eq(applications.id, applicationId), eq(applications.retentionState, "active"),
  ));
}

async function enqueueDocumentDeletion(
  db: Database,
  document: typeof applicationDocuments.$inferSelect,
  now: Date,
  reason = "DOCUMENT_TOMBSTONE",
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(applicationDocuments).set({
      deletionState: "deleting", deleteRequestedAt: document.deleteRequestedAt ?? now,
      deletionClaimedAt: null, deletionClaimToken: null, lastDeleteErrorCode: null, updatedAt: now,
    }).where(eq(applicationDocuments.id, document.id));
    await tx.insert(documentStorageCleanup).values({
      id: newId(), storageKey: document.storageKey, agencyId: document.agencyId,
      applicationId: document.applicationId, reason, attempts: 0,
      nextAttemptAt: now, createdAt: document.deleteRequestedAt ?? now, updatedAt: now,
    }).onConflictDoNothing({ target: documentStorageCleanup.storageKey });
  });
}

/**
 * Retries tombstoned private-file deletion on every run. Application retention
 * is deliberately disabled until APPLICATION_RETENTION_DAYS is configured from
 * the approved legal policy; no default retention period is invented here.
 */
export async function runDataLifecycle(
  db: Database,
  storage: PrivateDocumentStorage,
  options: {
    now?: Date;
    retentionDays?: number;
    accountRetentionDays?: number;
    batchSize?: number;
    beforeDocumentClaim?: (documentId: string) => Promise<void>;
    beforeApplicationRetentionClaim?: (applicationId: string) => Promise<void>;
    beforeAgencyPurgeCommit?: (agencyId: string) => Promise<void>;
  } = {},
): Promise<LifecycleResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 50;
  const result: LifecycleResult = {
    pendingDeleted: 0, pendingFailed: 0, orphanDeleted: 0, orphanFailed: 0,
    applicationsDeleted: 0, applicationsDeferred: 0, retentionEnabled: options.retentionDays !== undefined,
    accountClosureEnabled: options.accountRetentionDays !== undefined,
    tenantAccountsDeleted: 0, agenciesDeleted: 0, accountClosuresDeferred: 0,
  };

  const staleClaimBefore = new Date(now.getTime() - CLAIM_LEASE_MS);
  const availableDocumentClaim = or(isNull(applicationDocuments.deletionClaimToken), lte(applicationDocuments.deletionClaimedAt, staleClaimBefore));
  // Atomically hand all external blob work to one durable queue. Stale upload
  // reconciliation therefore cannot compete with a duplicate deletion loop.
  const stagingCutoff = new Date(now.getTime() - 15 * 60_000);
  const documentCandidates = await db.select().from(applicationDocuments).where(and(
    lte(applicationDocuments.deletionNextAttemptAt, now), availableDocumentClaim,
    sql`not exists (select 1 from ${documentStorageCleanup} cleanup where cleanup.storage_key = ${applicationDocuments.storageKey})`,
    or(
      eq(applicationDocuments.deletionState, "deleting"),
      and(eq(applicationDocuments.deletionState, "active"), eq(applicationDocuments.malwareScanState, "pending"), lte(applicationDocuments.updatedAt, stagingCutoff)),
    ),
  )).orderBy(asc(applicationDocuments.deletionNextAttemptAt), asc(applicationDocuments.createdAt), asc(applicationDocuments.id)).limit(batchSize);
  for (const document of documentCandidates) {
    await options.beforeDocumentClaim?.(document.id);
    const claimToken = newSecret();
    const claimed = await db.update(applicationDocuments).set({
      deletionAttempts: document.deletionAttempts + 1, deletionClaimedAt: now, deletionClaimToken: claimToken,
    }).where(and(
      eq(applicationDocuments.id, document.id), lte(applicationDocuments.deletionNextAttemptAt, now),
      or(isNull(applicationDocuments.deletionClaimToken), lte(applicationDocuments.deletionClaimedAt, staleClaimBefore)),
      sql`not exists (select 1 from ${documentStorageCleanup} cleanup where cleanup.storage_key = ${applicationDocuments.storageKey})`,
      or(
        eq(applicationDocuments.deletionState, "deleting"),
        and(
          eq(applicationDocuments.deletionState, "active"),
          eq(applicationDocuments.malwareScanState, "pending"),
          lte(applicationDocuments.updatedAt, stagingCutoff),
        ),
      ),
    )).returning();
    if (!claimed[0]) continue;
    await enqueueDocumentDeletion(db, claimed[0], now, claimed[0].malwareScanState === "pending" ? "DOCUMENT_STAGING_CLEANUP" : "DOCUMENT_TOMBSTONE");
  }

  // A live cover upload renews this explicit lease and is excluded from the
  // generic cleanup queue. A crashed uploader stops renewing and is promoted.
  const abandonedCoverStagingBefore = new Date(now.getTime() - PROPERTY_COVER_STAGING_LEASE_MS);
  await db.update(documentStorageCleanup).set({
    reason: PROPERTY_COVER_STAGING_CLEANUP_REASON, nextAttemptAt: now,
    claimedAt: null, claimToken: null, updatedAt: now,
  }).where(and(eq(documentStorageCleanup.reason, PROPERTY_COVER_STAGING_REASON), lte(documentStorageCleanup.updatedAt, abandonedCoverStagingBefore)));

  const cleanupCandidates = await db.select().from(documentStorageCleanup).where(and(
    ne(documentStorageCleanup.reason, PROPERTY_COVER_STAGING_REASON),
    lte(documentStorageCleanup.nextAttemptAt, now),
    or(isNull(documentStorageCleanup.claimToken), lte(documentStorageCleanup.claimedAt, staleClaimBefore)),
  )).orderBy(asc(documentStorageCleanup.nextAttemptAt), asc(documentStorageCleanup.createdAt), asc(documentStorageCleanup.id)).limit(batchSize);
  for (const candidate of cleanupCandidates) {
    const claimToken = newSecret();
    const claimedRows = await db.update(documentStorageCleanup).set({
      attempts: candidate.attempts + 1, claimedAt: now, claimToken, updatedAt: now,
    }).where(and(
      ne(documentStorageCleanup.reason, PROPERTY_COVER_STAGING_REASON),
      eq(documentStorageCleanup.id, candidate.id), lte(documentStorageCleanup.nextAttemptAt, now),
      or(isNull(documentStorageCleanup.claimToken), lte(documentStorageCleanup.claimedAt, staleClaimBefore)),
    )).returning();
    const claimed = claimedRows[0];
    if (!claimed) continue;
    const documentRows = await db.select().from(applicationDocuments).where(eq(applicationDocuments.storageKey, claimed.storageKey)).limit(1);
    const document = documentRows[0];
    try {
      await storage.delete(claimed.storageKey);
      await db.transaction(async (tx) => {
        if (document) {
          await lockAgencyForSystem(tx as unknown as Database, document.agencyId);
          await tx.delete(applicationDocuments).where(eq(applicationDocuments.id, document.id));
        }
        await tx.delete(documentStorageCleanup).where(and(eq(documentStorageCleanup.id, claimed.id), eq(documentStorageCleanup.claimToken, claimToken)));
        if (document) await recomputeDocumentStateLocked(tx as unknown as Database, document.applicationId, document.agencyId, now);
      });
      if (document) {
        if (claimed.reason === "DOCUMENT_STAGING_CLEANUP") result.orphanDeleted += 1;
        else result.pendingDeleted += 1;
      } else result.orphanDeleted += 1;
    } catch {
      const nextAttemptAt = retryAt(now, claimed.attempts, claimed.id);
      await db.update(documentStorageCleanup).set({
        claimedAt: null, claimToken: null, nextAttemptAt, lastErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED", updatedAt: now,
      }).where(and(eq(documentStorageCleanup.id, claimed.id), eq(documentStorageCleanup.claimToken, claimToken)));
      if (document) {
        await db.update(applicationDocuments).set({ deletionNextAttemptAt: nextAttemptAt, lastDeleteErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED", updatedAt: now }).where(eq(applicationDocuments.id, document.id));
        if (claimed.reason === "DOCUMENT_STAGING_CLEANUP") result.orphanFailed += 1;
        else result.pendingFailed += 1;
      } else result.orphanFailed += 1;
    }
  }

  if (options.retentionDays !== undefined) {
    const cutoff = new Date(now.getTime() - options.retentionDays * 86_400_000);
    const candidates = await db.select().from(applications).where(and(
      sql`${applications.status} in ('rejected', 'withdrawn')`,
      lte(applications.retentionNextAttemptAt, now),
      or(isNull(applications.retentionClaimToken), lte(applications.retentionClaimedAt, staleClaimBefore)),
      or(and(
        eq(applications.retentionState, "active"), lte(applications.updatedAt, cutoff),
        sql`not exists (select 1 from ${applicationDocuments} staging where staging.application_id = ${applications.id} and staging.malware_scan_state = 'pending' and staging.deletion_state = 'active')`,
      ), eq(applications.retentionState, "deleting")),
    )).orderBy(asc(applications.retentionNextAttemptAt), asc(applications.createdAt), asc(applications.id)).limit(batchSize);
    for (const candidate of candidates) {
      await options.beforeApplicationRetentionClaim?.(candidate.id);
      const claimToken = newSecret();
      const claimedRows = await db.update(applications).set({
        retentionState: "deleting", retentionAttempts: candidate.retentionAttempts + 1,
        retentionClaimedAt: now, retentionClaimToken: claimToken,
      }).where(and(
        eq(applications.id, candidate.id), eq(applications.status, candidate.status), lte(applications.retentionNextAttemptAt, now),
        or(isNull(applications.retentionClaimToken), lte(applications.retentionClaimedAt, staleClaimBefore)),
        or(and(
          eq(applications.retentionState, "active"), lte(applications.updatedAt, cutoff),
          sql`not exists (select 1 from ${applicationDocuments} staging where staging.application_id = ${applications.id} and staging.malware_scan_state = 'pending' and staging.deletion_state = 'active')`,
        ), eq(applications.retentionState, "deleting")),
      )).returning();
      const application = claimedRows[0];
      if (!application) continue;
      const documents = await db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, application.id));
      if (documents.length) {
        for (const document of documents) await enqueueDocumentDeletion(db, document, now);
        await db.update(applications).set({
          retentionClaimedAt: null, retentionClaimToken: null,
          retentionNextAttemptAt: new Date(now.getTime() + 15_000),
        }).where(and(eq(applications.id, application.id), eq(applications.retentionClaimToken, claimToken)));
        result.applicationsDeferred += 1;
        continue;
      }
      const deleted = await db.delete(applications).where(and(
        eq(applications.id, application.id), eq(applications.status, application.status),
        eq(applications.retentionState, "deleting"), eq(applications.retentionClaimToken, claimToken),
      )).returning({ id: applications.id });
      if (deleted[0]) result.applicationsDeleted += 1;
      else result.applicationsDeferred += 1;
    }
  }

  if (options.accountRetentionDays === undefined) return result;
  const accountCutoff = new Date(now.getTime() - options.accountRetentionDays * 86_400_000);
  const userCandidates = await db.select().from(users).where(and(
    eq(users.accountState, "closure_requested"), lte(users.closureRequestedAt, accountCutoff), lte(users.accountPurgeNextAttemptAt, now),
    or(isNull(users.accountPurgeClaimToken), lte(users.accountPurgeClaimedAt, staleClaimBefore)),
    sql`not exists (select 1 from ${agencyMemberships} membership where membership.user_id = ${users.id})`,
  )).orderBy(asc(users.accountPurgeNextAttemptAt), asc(users.createdAt), asc(users.id)).limit(batchSize);
  for (const candidate of userCandidates) {
    const claimToken = newSecret();
    const claimedRows = await db.update(users).set({
      accountPurgeAttempts: candidate.accountPurgeAttempts + 1, accountPurgeClaimedAt: now, accountPurgeClaimToken: claimToken,
    }).where(and(
      eq(users.id, candidate.id), eq(users.accountState, "closure_requested"), eq(users.closureRequestedAt, candidate.closureRequestedAt!),
      lte(users.accountPurgeNextAttemptAt, now), or(isNull(users.accountPurgeClaimToken), lte(users.accountPurgeClaimedAt, staleClaimBefore)),
      sql`not exists (select 1 from ${agencyMemberships} membership where membership.user_id = ${users.id})`,
    )).returning();
    const account = claimedRows[0];
    if (!account) continue;
    const documents = await db.select({ document: applicationDocuments }).from(applicationDocuments)
      .innerJoin(applications, eq(applications.id, applicationDocuments.applicationId))
      .where(eq(applications.tenantUserId, account.id));
    if (documents.length) {
      for (const row of documents) await enqueueDocumentDeletion(db, row.document, now);
      await db.update(users).set({
        accountPurgeClaimedAt: null, accountPurgeClaimToken: null,
        accountPurgeNextAttemptAt: new Date(now.getTime() + 15_000),
      }).where(and(eq(users.id, account.id), eq(users.accountPurgeClaimToken, claimToken)));
      result.accountClosuresDeferred += 1;
      continue;
    }
    const deleted = await db.delete(users).where(and(
      eq(users.id, account.id), eq(users.accountState, "closure_requested"),
      eq(users.closureRequestedAt, account.closureRequestedAt!), eq(users.accountPurgeClaimToken, claimToken),
      sql`not exists (select 1 from ${agencyMemberships} membership where membership.user_id = ${users.id})`,
    )).returning({ id: users.id });
    if (deleted[0]) result.tenantAccountsDeleted += 1;
    else result.accountClosuresDeferred += 1;
  }

  const agencyCandidates = await db.select({ agency: agencies }).from(agencies)
    .innerJoin(agencyClosureCleanup, eq(agencyClosureCleanup.agencyId, agencies.id)).where(and(
    eq(agencies.accountState, "closure_requested"), lte(agencies.closureRequestedAt, accountCutoff), lte(agencies.accountPurgeNextAttemptAt, now),
    or(isNull(agencies.accountPurgeClaimToken), lte(agencies.accountPurgeClaimedAt, staleClaimBefore)),
    eq(agencyClosureCleanup.state, "ready_for_purge"),
  )).orderBy(asc(agencies.accountPurgeNextAttemptAt), asc(agencies.createdAt), asc(agencies.id)).limit(batchSize);
  for (const candidate of agencyCandidates) {
    const agencyCandidate = candidate.agency;
    const claimToken = newSecret();
    const claimedAgency = await db.transaction(async (tx) => {
      const rows = await tx.select().from(agencies).where(eq(agencies.id, agencyCandidate.id)).for("update").limit(1);
      const row = rows[0];
      if (!row || row.accountState !== "closure_requested" || !row.closureRequestedAt || row.closureRequestedAt > accountCutoff || row.accountPurgeNextAttemptAt > now) return null;
      if (row.accountPurgeClaimToken && (!row.accountPurgeClaimedAt || row.accountPurgeClaimedAt > staleClaimBefore)) return null;
      const updated = await tx.update(agencies).set({
        accountPurgeAttempts: row.accountPurgeAttempts + 1, accountPurgeClaimedAt: now, accountPurgeClaimToken: claimToken,
      }).where(eq(agencies.id, row.id)).returning();
      return updated[0] ?? null;
    });
    if (!claimedAgency) continue;
    const closureRows = await db.select().from(agencyClosureCleanup).where(eq(agencyClosureCleanup.agencyId, claimedAgency.id)).limit(1);
    if (!closureRows[0] || closureRows[0].state !== "ready_for_purge") {
      await db.update(agencies).set({ accountPurgeClaimedAt: null, accountPurgeClaimToken: null, accountPurgeNextAttemptAt: new Date(now.getTime() + 15_000) })
        .where(and(eq(agencies.id, claimedAgency.id), eq(agencies.accountPurgeClaimToken, claimToken)));
      result.accountClosuresDeferred += 1;
      continue;
    }
    const coverProperties = await db.select({ id: properties.id, coverImageUrl: properties.coverImageUrl, version: properties.version })
      .from(properties).where(eq(properties.agencyId, claimedAgency.id));
    const internalCovers = coverProperties.flatMap((property) => {
      const storageKey = propertyImageStorageKeyFromUrl(property.coverImageUrl, property.id);
      return storageKey ? [{ ...property, storageKey }] : [];
    });
    if (internalCovers.length) {
      await db.transaction(async (tx) => {
        const agencyRows = await tx.select({ accountPurgeClaimToken: agencies.accountPurgeClaimToken }).from(agencies)
          .where(eq(agencies.id, claimedAgency.id)).for("update").limit(1);
        if (agencyRows[0]?.accountPurgeClaimToken !== claimToken) return;
        for (const cover of internalCovers) {
          await tx.insert(documentStorageCleanup).values({
            id: newId(), storageKey: cover.storageKey, agencyId: claimedAgency.id, applicationId: cover.id,
            reason: "PROPERTY_COVER_ACCOUNT_CLOSURE", attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
          }).onConflictDoNothing({ target: documentStorageCleanup.storageKey });
          await tx.update(properties).set({ coverImageUrl: null, version: cover.version + 1, updatedAt: now })
            .where(and(eq(properties.id, cover.id), eq(properties.agencyId, claimedAgency.id), eq(properties.version, cover.version)));
        }
      });
      await db.update(agencies).set({ accountPurgeClaimedAt: null, accountPurgeClaimToken: null, accountPurgeNextAttemptAt: new Date(now.getTime() + 15_000) })
        .where(and(eq(agencies.id, claimedAgency.id), eq(agencies.accountPurgeClaimToken, claimToken)));
      result.accountClosuresDeferred += 1;
      continue;
    }
    const documents = await db.select().from(applicationDocuments).where(eq(applicationDocuments.agencyId, claimedAgency.id));
    if (documents.length) {
      for (const document of documents) await enqueueDocumentDeletion(db, document, now);
      await db.update(agencies).set({ accountPurgeClaimedAt: null, accountPurgeClaimToken: null, accountPurgeNextAttemptAt: new Date(now.getTime() + 15_000) })
        .where(and(eq(agencies.id, claimedAgency.id), eq(agencies.accountPurgeClaimToken, claimToken)));
      result.accountClosuresDeferred += 1;
      continue;
    }
    const pendingStorageCleanup = await db.select({ id: documentStorageCleanup.id }).from(documentStorageCleanup)
      .where(eq(documentStorageCleanup.agencyId, claimedAgency.id)).limit(1);
    if (pendingStorageCleanup[0]) {
      await db.update(agencies).set({ accountPurgeClaimedAt: null, accountPurgeClaimToken: null, accountPurgeNextAttemptAt: new Date(now.getTime() + 15_000) })
        .where(and(eq(agencies.id, claimedAgency.id), eq(agencies.accountPurgeClaimToken, claimToken)));
      result.accountClosuresDeferred += 1;
      continue;
    }
    const purged = await db.transaction(async (tx) => {
      // The agency row is always the first database lock. This fences every
      // rental/operations mutation and makes the local graph purge atomic.
      const agencyRows = await tx.select().from(agencies).where(eq(agencies.id, claimedAgency.id)).for("update").limit(1);
      const lockedAgency = agencyRows[0];
      if (!lockedAgency || lockedAgency.accountState !== "closure_requested" || lockedAgency.accountPurgeClaimToken !== claimToken) return false;
      const closureRows = await tx.select().from(agencyClosureCleanup).where(eq(agencyClosureCleanup.agencyId, claimedAgency.id)).for("update").limit(1);
      const lockedClosure = closureRows[0];
      if (!lockedClosure || lockedClosure.state !== "ready_for_purge") return false;
      const remainingDocuments = await tx.select({ id: applicationDocuments.id }).from(applicationDocuments).where(eq(applicationDocuments.agencyId, claimedAgency.id)).limit(1);
      if (remainingDocuments[0]) return false;
      const members = await tx.select({ userId: agencyMemberships.userId }).from(agencyMemberships).where(eq(agencyMemberships.agencyId, claimedAgency.id));
      const deleted = await tx.delete(agencies).where(and(
        eq(agencies.id, claimedAgency.id), eq(agencies.accountState, "closure_requested"), eq(agencies.accountPurgeClaimToken, claimToken),
      )).returning({ id: agencies.id });
      if (!deleted[0]) return false;
      await options.beforeAgencyPurgeCommit?.(claimedAgency.id);
      for (const member of members) await tx.delete(users).where(and(eq(users.id, member.userId), eq(users.accountState, "closure_requested")));
      const completed = await tx.update(agencyClosureCleanup).set({
        state: "completed", providerSubscriptionRef: null, lastErrorCode: null,
        claimedAt: null, claimToken: null, updatedAt: now,
      }).where(and(eq(agencyClosureCleanup.id, lockedClosure.id), eq(agencyClosureCleanup.state, "ready_for_purge"))).returning({ id: agencyClosureCleanup.id });
      return Boolean(completed[0]);
    });
    if (purged) result.agenciesDeleted += 1;
    else {
      await db.update(agencies).set({
        accountPurgeClaimedAt: null, accountPurgeClaimToken: null,
        accountPurgeNextAttemptAt: retryAt(now, claimedAgency.accountPurgeAttempts, claimedAgency.id),
      }).where(and(eq(agencies.id, claimedAgency.id), eq(agencies.accountPurgeClaimToken, claimToken)));
      result.accountClosuresDeferred += 1;
    }
  }
  return result;
}
