import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agencies, invoices, subscriptions } from "../../db/schema.js";
import { newId } from "../../lib/ids.js";
import type { BillingProvider } from "./provider.js";
import { expireScheduledSubjectEmails } from "../email/subjects.js";

export type BillingSyncResult = {
  inspected: number;
  updated: number;
  invoicesUpserted: number;
  failed: number;
  deferred: number;
};

/** Polls the provider and idempotently projects authoritative billing state. */
export async function syncBillingProviderState(
  db: Database,
  provider: BillingProvider,
  options: { now?: Date; batchSize?: number; leaseMs?: number } = {},
): Promise<BillingSyncResult> {
  const result: BillingSyncResult = { inspected: 0, updated: 0, invoicesUpserted: 0, failed: 0, deferred: 0 };
  if (!provider.syncSubscription) return result;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - (options.leaseMs ?? 5 * 60_000));
  const claimEligible = or(isNull(subscriptions.billingSyncClaimToken), lte(subscriptions.billingSyncClaimedAt, staleBefore));
  const rows = await db.select({ subscription: subscriptions }).from(subscriptions)
    .innerJoin(agencies, and(eq(agencies.id, subscriptions.agencyId), eq(agencies.accountState, "active")))
    .where(and(
      isNotNull(subscriptions.providerSubscriptionRef),
      isNull(subscriptions.pendingBillingOperationId),
      or(isNull(subscriptions.billingNextSyncAt), lte(subscriptions.billingNextSyncAt, now)),
      claimEligible,
    ))
    .orderBy(asc(subscriptions.billingNextSyncAt), asc(subscriptions.id))
    .limit(options.batchSize ?? 50);

  for (const row of rows) {
    const claimToken = randomUUID();
    const claimedRows = await db.update(subscriptions).set({ billingSyncClaimedAt: now, billingSyncClaimToken: claimToken })
      .where(and(
        eq(subscriptions.id, row.subscription.id), eq(subscriptions.agencyId, row.subscription.agencyId),
        isNull(subscriptions.pendingBillingOperationId),
        or(isNull(subscriptions.billingNextSyncAt), lte(subscriptions.billingNextSyncAt, now)),
        or(isNull(subscriptions.billingSyncClaimToken), lte(subscriptions.billingSyncClaimedAt, staleBefore)),
      )).returning();
    const subscription = claimedRows[0];
    if (!subscription) { result.deferred += 1; continue; }
    result.inspected += 1;
    let snapshot;
    try {
      snapshot = await provider.syncSubscription({ subscriptionRef: subscription.providerSubscriptionRef! });
    } catch {
      const attempts = subscription.billingSyncAttempts + 1;
      const backoffMs = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
      const failed = await db.update(subscriptions).set({
        billingSyncAttempts: attempts,
        billingSyncLastErrorCode: "BILLING_SYNC_FAILED",
        billingNextSyncAt: new Date(now.getTime() + backoffMs),
        billingSyncClaimedAt: null,
        billingSyncClaimToken: null,
        updatedAt: now,
      }).where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.agencyId, subscription.agencyId), eq(subscriptions.billingSyncClaimToken, claimToken), isNull(subscriptions.pendingBillingOperationId))).returning({ id: subscriptions.id });
      if (failed[0]) result.failed += 1;
      else result.deferred += 1;
      continue;
    }
    if (!snapshot) {
      const released = await db.update(subscriptions).set({
        billingLastSyncedAt: now,
        billingNextSyncAt: new Date(now.getTime() + 15 * 60_000),
        billingSyncAttempts: 0,
        billingSyncLastErrorCode: null,
        billingSyncClaimedAt: null,
        billingSyncClaimToken: null,
        updatedAt: now,
      }).where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.agencyId, subscription.agencyId), eq(subscriptions.billingSyncClaimToken, claimToken), isNull(subscriptions.pendingBillingOperationId))).returning({ id: subscriptions.id });
      if (!released[0]) result.deferred += 1;
      continue;
    }
    let applied: boolean;
    try {
      applied = await db.transaction(async (tx) => {
      const agencyRows = await tx.select({ state: agencies.accountState }).from(agencies)
        .where(eq(agencies.id, subscription.agencyId)).for("update").limit(1);
      if (agencyRows[0]?.state !== "active") return false;
      const currentRows = await tx.select().from(subscriptions).where(and(
        eq(subscriptions.id, subscription.id),
        eq(subscriptions.agencyId, subscription.agencyId),
      )).for("update").limit(1);
      const current = currentRows[0];
      if (!current || current.pendingBillingOperationId || current.providerSubscriptionRef !== subscription.providerSubscriptionRef || current.billingSyncClaimToken !== claimToken) return false;
      if (current.state !== snapshot.state || current.trialEndsAt?.toISOString() !== snapshot.trialEndsAt?.toISOString()) {
        await expireScheduledSubjectEmails(tx as unknown as Database, "subscription", current.id, "SUBSCRIPTION_CHANGED");
      }
      await tx.update(subscriptions).set({
        state: snapshot.state,
        trialEndsAt: snapshot.trialEndsAt,
        currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
        paymentMethodDisplay: snapshot.paymentMethodDisplay,
        billingLastSyncedAt: now,
        billingNextSyncAt: new Date(now.getTime() + 15 * 60_000),
        billingSyncAttempts: 0,
        billingSyncLastErrorCode: null,
        billingSyncClaimedAt: null,
        billingSyncClaimToken: null,
        updatedAt: now,
      }).where(and(eq(subscriptions.id, current.id), eq(subscriptions.agencyId, current.agencyId), isNull(subscriptions.pendingBillingOperationId)));
      for (const invoice of snapshot.invoices) {
        await tx.insert(invoices).values({
          id: newId(),
          agencyId: current.agencyId,
          subscriptionId: current.id,
          ...invoice,
        }).onConflictDoUpdate({
          target: [invoices.agencyId, invoices.providerInvoiceRef],
          set: {
            subscriptionId: current.id,
            amountCents: invoice.amountCents,
            currency: invoice.currency,
            status: invoice.status,
            issuedAt: invoice.issuedAt,
            hostedUrl: invoice.hostedUrl,
          },
        });
      }
        return true;
      });
    } catch {
      const attempts = subscription.billingSyncAttempts + 1;
      const backoffMs = Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));
      const failed = await db.update(subscriptions).set({
        billingSyncAttempts: attempts,
        billingSyncLastErrorCode: "BILLING_SYNC_PROJECTION_FAILED",
        billingNextSyncAt: new Date(now.getTime() + backoffMs),
        billingSyncClaimedAt: null,
        billingSyncClaimToken: null,
        updatedAt: now,
      }).where(and(
        eq(subscriptions.id, subscription.id), eq(subscriptions.agencyId, subscription.agencyId),
        eq(subscriptions.billingSyncClaimToken, claimToken), isNull(subscriptions.pendingBillingOperationId),
      )).returning({ id: subscriptions.id });
      if (failed[0]) result.failed += 1;
      else result.deferred += 1;
      continue;
    }
    if (applied) {
      result.updated += 1;
      result.invoicesUpserted += snapshot.invoices.length;
    } else result.deferred += 1;
  }
  return result;
}
