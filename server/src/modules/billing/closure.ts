import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agencies, agencyClosureCleanup, billingOperations, subscriptions } from "../../db/schema.js";
import { billingProviderOperationKey, BillingProviderError, type BillingProvider } from "./provider.js";

const BILLING_OPERATION_LEASE_MS = 5 * 60_000;
const CLOSURE_LEASE_MS = 5 * 60_000;
type SettlementOutcome = "settled" | "in_flight" | "provider_failed";

function retryAt(now: Date, attempts: number, id: string): Date {
  const base = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
  const jitter = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % Math.max(1, Math.floor(base / 5));
  return new Date(now.getTime() + base + jitter);
}

export type AgencyClosureReconciliationResult = {
  inspected: number;
  providerApplied: number;
  readyForPurge: number;
  failed: number;
  deferred: number;
};

function closureFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    const code = error.code.replace(/[^A-Z0-9_]/gi, "_").slice(0, 80).toUpperCase();
    if (code === "BILLING_PROVIDER_UNAVAILABLE" || code === "BILLING_PROVIDER_DECLINED") return code;
  }
  return "AGENCY_CLOSURE_PROVIDER_FAILED";
}

/**
 * A closure cancellation must be ordered after any earlier renewal mutation.
 * Recent pending rows may still have a provider call in flight, so they are
 * deferred. Unknown or stale rows are retried with their durable provider key.
 */
async function settlePendingRenewalOperation(
  db: Database,
  billingProvider: BillingProvider,
  agencyId: string,
  now: Date,
): Promise<SettlementOutcome> {
  const subscriptionRows = await db.select().from(subscriptions).where(eq(subscriptions.agencyId, agencyId)).limit(1);
  const subscription = subscriptionRows[0];
  if (!subscription?.pendingBillingOperationId) return "settled";
  const operationRows = await db.select().from(billingOperations)
    .where(eq(billingOperations.id, subscription.pendingBillingOperationId)).limit(1);
  const operation = operationRows[0];
  if (!operation) return "provider_failed";
  if (operation.operation === "update_payment_method") {
    await db.transaction(async (tx) => {
      await tx.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, agencyId)).for("update").limit(1);
      await tx.update(subscriptions).set({ pendingBillingOperationId: null, updatedAt: now })
        .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.pendingBillingOperationId, operation.id)));
      await tx.update(billingOperations).set({ state: "abandoned", lastErrorCode: "AGENCY_CLOSURE_SUPERSEDED", updatedAt: now })
        .where(and(eq(billingOperations.id, operation.id), inArray(billingOperations.state, ["pending", "unknown"])));
    });
    return "settled";
  }
  if (!["cancel", "reactivate"].includes(operation.operation)) return "provider_failed";

  if (!operation.providerAppliedAt) {
    const mayStillBeInFlight = operation.state === "pending"
      && operation.updatedAt.getTime() > now.getTime() - BILLING_OPERATION_LEASE_MS;
    if (mayStillBeInFlight) return "in_flight";
    await db.update(billingOperations).set({
      state: "pending",
      attempts: sql`${billingOperations.attempts} + 1`,
      lastErrorCode: null,
      updatedAt: now,
    }).where(eq(billingOperations.id, operation.id));
    try {
      if (subscription.providerSubscriptionRef) {
        const input = { subscriptionRef: subscription.providerSubscriptionRef, idempotencyKey: billingProviderOperationKey(operation.id) };
        if (operation.operation === "cancel") await billingProvider.cancel(input);
        else await billingProvider.reactivate(input);
      }
    } catch (error) {
      if (error instanceof BillingProviderError && error.kind === "declined") {
        await db.transaction(async (tx) => {
          await tx.update(billingOperations).set({ state: "failed", lastErrorCode: "BILLING_CHANGE_REJECTED", updatedAt: now })
            .where(eq(billingOperations.id, operation.id));
          await tx.update(subscriptions).set({ pendingBillingOperationId: null, updatedAt: now })
            .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.pendingBillingOperationId, operation.id)));
        });
        return "settled";
      }
      await db.update(billingOperations).set({
        state: "unknown",
        lastErrorCode: "BILLING_PROVIDER_RESULT_UNKNOWN",
        updatedAt: now,
      }).where(eq(billingOperations.id, operation.id));
      return "provider_failed";
    }
    await db.update(billingOperations).set({ providerAppliedAt: now, updatedAt: now })
      .where(eq(billingOperations.id, operation.id));
  }

  const settled = await db.transaction(async (tx) => {
    await tx.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, agencyId)).for("update").limit(1);
    const currentSubscriptions = await tx.select().from(subscriptions).where(eq(subscriptions.id, subscription.id)).limit(1);
    const current = currentSubscriptions[0];
    if (!current) return true;
    if (current.pendingBillingOperationId && current.pendingBillingOperationId !== operation.id) return false;
    const cancelAtPeriodEnd = operation.operation === "cancel";
    const response = cancelAtPeriodEnd
      ? { data: { cancelAtPeriodEnd: true, effectiveAt: current.currentPeriodEndsAt } }
      : { data: { cancelAtPeriodEnd: false } };
    await tx.update(subscriptions).set({ cancelAtPeriodEnd, pendingBillingOperationId: null, updatedAt: now })
      .where(and(eq(subscriptions.id, current.id), eq(subscriptions.pendingBillingOperationId, operation.id)));
    await tx.update(billingOperations).set({ state: "completed", response, lastErrorCode: null, updatedAt: now })
      .where(eq(billingOperations.id, operation.id));
    return true;
  });
  return settled ? "settled" : "provider_failed";
}

/** Recovers a trial accepted by the provider before the local transaction crashed. */
async function settlePendingTrialOperation(
  db: Database,
  billingProvider: BillingProvider,
  agencyId: string,
  now: Date,
): Promise<SettlementOutcome> {
  const subscriptionRows = await db.select({ pendingId: subscriptions.pendingBillingOperationId }).from(subscriptions)
    .where(eq(subscriptions.agencyId, agencyId)).limit(1);
  const pendingId = subscriptionRows[0]?.pendingId;
  const rows = pendingId
    ? await db.select().from(billingOperations).where(and(
      eq(billingOperations.id, pendingId), eq(billingOperations.operation, "create_trial"),
      inArray(billingOperations.state, ["pending", "unknown", "failed"]),
    )).limit(1)
    : await db.select().from(billingOperations).where(and(
      eq(billingOperations.agencyId, agencyId), eq(billingOperations.operation, "create_trial"),
      inArray(billingOperations.state, ["pending", "unknown", "failed"]),
    )).limit(1);
  const operation = rows[0];
  if (!operation) return "settled";
  if (operation.state === "pending" && operation.updatedAt.getTime() > now.getTime() - BILLING_OPERATION_LEASE_MS) return "in_flight";
  if (!billingProvider.reconcileTrial) return "provider_failed";
  let recovered;
  try {
    recovered = await billingProvider.reconcileTrial({ agencyId, idempotencyKey: billingProviderOperationKey(operation.id) });
  } catch {
    return "provider_failed";
  }
  await db.transaction(async (tx) => {
    await tx.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, agencyId)).for("update").limit(1);
    await tx.update(billingOperations).set({
      state: "abandoned", providerAppliedAt: recovered ? now : operation.providerAppliedAt,
      lastErrorCode: recovered ? "AGENCY_CLOSURE_SUPERSEDED" : "AGENCY_CLOSURE_NO_PROVIDER_TRIAL", updatedAt: now,
    }).where(eq(billingOperations.id, operation.id));
    await tx.update(subscriptions).set({ pendingBillingOperationId: null, updatedAt: now })
      .where(eq(subscriptions.pendingBillingOperationId, operation.id));
    if (recovered) {
      await tx.update(agencyClosureCleanup).set({ providerSubscriptionRef: recovered.subscriptionRef, updatedAt: now })
        .where(eq(agencyClosureCleanup.agencyId, agencyId));
    }
  });
  return "settled";
}

/**
 * Reconciles external subscription cancellation before the lifecycle worker may
 * delete an agency. The provider key is derived from the durable cleanup row,
 * so a crash after the provider call can safely repeat that call.
 */
export async function reconcileAgencyClosures(
  db: Database,
  billingProvider: BillingProvider,
  options: { now?: Date; batchSize?: number } = {},
): Promise<AgencyClosureReconciliationResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 25;
  const result: AgencyClosureReconciliationResult = { inspected: 0, providerApplied: 0, readyForPurge: 0, failed: 0, deferred: 0 };
  const staleBefore = new Date(now.getTime() - CLOSURE_LEASE_MS);
  const candidates = await db.select().from(agencyClosureCleanup).where(or(
    eq(agencyClosureCleanup.state, "provider_applied"),
    and(inArray(agencyClosureCleanup.state, ["pending", "failed"]), lte(agencyClosureCleanup.nextAttemptAt, now)),
    and(eq(agencyClosureCleanup.state, "processing"), lte(agencyClosureCleanup.claimedAt, staleBefore)),
  )).orderBy(asc(agencyClosureCleanup.nextAttemptAt), asc(agencyClosureCleanup.createdAt), asc(agencyClosureCleanup.id)).limit(batchSize);

  for (const candidate of candidates) {
    result.inspected += 1;
    if (candidate.state === "provider_applied" || candidate.providerAppliedAt) {
      const ready = await db.update(agencyClosureCleanup).set({
        state: "ready_for_purge", providerSubscriptionRef: null, claimedAt: null, claimToken: null,
        lastErrorCode: null, updatedAt: now,
      }).where(and(eq(agencyClosureCleanup.id, candidate.id), eq(agencyClosureCleanup.state, "provider_applied"))).returning({ id: agencyClosureCleanup.id });
      if (ready[0]) result.readyForPurge += 1;
      continue;
    }

    const claimToken = randomUUID();
    const claimedRows = await db.update(agencyClosureCleanup).set({
      state: "processing", attempts: candidate.attempts + 1, claimedAt: now, claimToken,
      lastErrorCode: null, updatedAt: now,
    }).where(and(
      eq(agencyClosureCleanup.id, candidate.id),
      isNull(agencyClosureCleanup.providerAppliedAt),
      or(
        and(inArray(agencyClosureCleanup.state, ["pending", "failed"]), lte(agencyClosureCleanup.nextAttemptAt, now)),
        and(eq(agencyClosureCleanup.state, "processing"), lte(agencyClosureCleanup.claimedAt, staleBefore)),
      ),
    )).returning();
    const claimed = claimedRows[0];
    if (!claimed) continue;

    const trialSettlement = await settlePendingTrialOperation(db, billingProvider, candidate.agencyId, now);
    const renewalSettlement = trialSettlement === "settled"
      ? await settlePendingRenewalOperation(db, billingProvider, candidate.agencyId, now)
      : "settled";
    const settlement = trialSettlement !== "settled" ? trialSettlement : renewalSettlement;
    if (settlement !== "settled") {
      const providerFailed = settlement === "provider_failed";
      await db.update(agencyClosureCleanup).set({
        state: providerFailed ? "failed" : "pending",
        nextAttemptAt: providerFailed ? retryAt(now, claimed.attempts, claimed.id) : new Date(now.getTime() + 15_000),
        claimedAt: null, claimToken: null,
        lastErrorCode: providerFailed ? "BILLING_OPERATION_RECONCILIATION_FAILED" : "BILLING_OPERATION_IN_FLIGHT", updatedAt: now,
      }).where(and(eq(agencyClosureCleanup.id, claimed.id), eq(agencyClosureCleanup.state, "processing"), eq(agencyClosureCleanup.claimToken, claimToken)));
      if (providerFailed) result.failed += 1;
      else result.deferred += 1;
      continue;
    }
    const refreshedRows = await db.select().from(agencyClosureCleanup).where(eq(agencyClosureCleanup.id, claimed.id)).limit(1);
    const refreshed = refreshedRows[0];
    if (!refreshed) continue;
    if (!refreshed.providerSubscriptionRef) {
      const ready = await db.update(agencyClosureCleanup).set({
        state: "ready_for_purge",
        providerSubscriptionRef: null,
        claimedAt: null,
        claimToken: null,
        lastErrorCode: null,
        updatedAt: now,
      }).where(and(
        eq(agencyClosureCleanup.id, claimed.id),
        eq(agencyClosureCleanup.state, "processing"),
        eq(agencyClosureCleanup.claimToken, claimToken),
      )).returning({ id: agencyClosureCleanup.id });
      if (ready[0]) result.readyForPurge += 1;
      continue;
    }

    try {
      await billingProvider.cancel({
        subscriptionRef: refreshed.providerSubscriptionRef,
        idempotencyKey: `agency-closure:${claimed.id}`,
      });
    } catch (error) {
      const failed = await db.update(agencyClosureCleanup).set({
        state: "failed",
        nextAttemptAt: retryAt(now, claimed.attempts, claimed.id),
        claimedAt: null,
        claimToken: null,
        lastErrorCode: closureFailureCode(error),
        updatedAt: now,
      }).where(and(
        eq(agencyClosureCleanup.id, claimed.id),
        eq(agencyClosureCleanup.state, "processing"),
        eq(agencyClosureCleanup.claimToken, claimToken),
        isNull(agencyClosureCleanup.providerAppliedAt),
      )).returning({ id: agencyClosureCleanup.id });
      if (failed[0]) result.failed += 1;
      continue;
    }

    const applied = await db.update(agencyClosureCleanup).set({
      state: "provider_applied",
      providerAppliedAt: now,
      claimedAt: null,
      claimToken: null,
      lastErrorCode: null,
      updatedAt: now,
    }).where(and(
      eq(agencyClosureCleanup.id, claimed.id),
      eq(agencyClosureCleanup.state, "processing"),
      eq(agencyClosureCleanup.claimToken, claimToken),
      isNull(agencyClosureCleanup.providerAppliedAt),
    )).returning({ id: agencyClosureCleanup.id });
    if (applied[0]) result.providerApplied += 1;

    const ready = await db.update(agencyClosureCleanup).set({
      state: "ready_for_purge",
      providerSubscriptionRef: null,
      lastErrorCode: null,
      updatedAt: now,
    }).where(and(
      eq(agencyClosureCleanup.id, claimed.id),
      eq(agencyClosureCleanup.state, "provider_applied"),
    )).returning({ id: agencyClosureCleanup.id });
    if (ready[0]) result.readyForPurge += 1;
  }

  return result;
}
