import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agencies, agencyClosureCleanup, agencyMemberships, analyticsEvents, billingOperations, subscriptions, users } from "../../db/schema.js";
import { createTestApp } from "../../test/test-app.js";
import { runDataLifecycle } from "../rentals/lifecycle.js";
import { MemoryPrivateDocumentStorage } from "../rentals/storage.js";
import type { BillingProvider, CreatedSubscription } from "./provider.js";
import { reconcileAgencyClosures } from "./closure.js";

let context: Awaited<ReturnType<typeof createTestApp>>;

class FailOnceBillingProvider implements BillingProvider {
  readonly cancelCalls: Array<{ subscriptionRef: string; idempotencyKey: string }> = [];
  private shouldFail = true;
  async createTrial(): Promise<CreatedSubscription> { throw new Error("NOT_USED"); }
  async updatePaymentMethod(): Promise<{ paymentMethodDisplay: string }> { throw new Error("NOT_USED"); }
  async reactivate(): Promise<void> { throw new Error("NOT_USED"); }
  async cancel(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {
    this.cancelCalls.push(input);
    if (this.shouldFail) {
      this.shouldFail = false;
      throw Object.assign(new Error("raw provider detail: customer@example.es"), { code: "ETIMEDOUT" });
    }
  }
}

class SelectiveFailureProvider implements BillingProvider {
  readonly calls: string[] = [];
  recoveredTrial: CreatedSubscription | null = null;
  async createTrial(): Promise<CreatedSubscription> { throw new Error("NOT_USED"); }
  async updatePaymentMethod(): Promise<{ paymentMethodDisplay: string }> { throw new Error("NOT_USED"); }
  async reactivate(): Promise<void> { throw new Error("NOT_USED"); }
  async cancel(input: { subscriptionRef: string }): Promise<void> {
    this.calls.push(input.subscriptionRef);
    if (input.subscriptionRef === "always-fails") throw new Error("provider down");
  }
  async reconcileTrial(): Promise<CreatedSubscription | null> { return this.recoveredTrial; }
}

beforeEach(async () => { context = await createTestApp(); });
afterEach(async () => context.close());

it("backs off failed closure work so later rows are not starved", async () => {
  const due = new Date("2026-08-08T09:00:00.000Z");
  await context.db.insert(agencyClosureCleanup).values([
    { id: "92000000-0000-4000-8000-000000000001", agencyId: "92000000-0000-4000-8000-000000000011", providerSubscriptionRef: "always-fails", state: "pending", nextAttemptAt: due, createdAt: due, updatedAt: due },
    { id: "92000000-0000-4000-8000-000000000002", agencyId: "92000000-0000-4000-8000-000000000012", providerSubscriptionRef: "works-2", state: "pending", nextAttemptAt: due, createdAt: due, updatedAt: due },
    { id: "92000000-0000-4000-8000-000000000003", agencyId: "92000000-0000-4000-8000-000000000013", providerSubscriptionRef: "works-3", state: "pending", nextAttemptAt: due, createdAt: due, updatedAt: due },
  ]);
  const provider = new SelectiveFailureProvider();
  const clock = new Date("2026-08-08T10:00:00.000Z");
  expect(await reconcileAgencyClosures(context.db, provider, { now: clock, batchSize: 2 })).toMatchObject({ inspected: 2, failed: 1, readyForPurge: 1 });
  expect(await reconcileAgencyClosures(context.db, provider, { now: clock, batchSize: 2 })).toMatchObject({ inspected: 1, failed: 0, readyForPurge: 1 });
  expect(provider.calls).toEqual(["always-fails", "works-2", "works-3"]);
});

it("abandons a crash-stranded payment update before final subscription cancellation", async () => {
  const clock = new Date("2026-08-08T10:00:00.000Z");
  const agencyId = "92500000-0000-4000-8000-000000000001";
  const operationId = "92500000-0000-4000-8000-000000000002";
  const subscriptionId = "92500000-0000-4000-8000-000000000003";
  await context.db.insert(agencies).values({ id: agencyId, name: "Closing", accountState: "closure_requested", closureRequestedAt: clock, createdAt: clock, updatedAt: clock });
  await context.db.insert(billingOperations).values({ id: operationId, agencyId, operation: "update_payment_method", idempotencyKeyHash: "a".repeat(64), requestFingerprint: "b".repeat(64), state: "pending", providerAppliedAt: clock, createdAt: clock, updatedAt: clock });
  await context.db.insert(subscriptions).values({ id: subscriptionId, agencyId, plan: "professional", state: "active", providerSubscriptionRef: "subscription-after-payment-crash", pendingBillingOperationId: operationId, createdAt: clock, updatedAt: clock });
  await context.db.insert(agencyClosureCleanup).values({ id: "92500000-0000-4000-8000-000000000004", agencyId, providerSubscriptionRef: "subscription-after-payment-crash", state: "pending", nextAttemptAt: clock, createdAt: clock, updatedAt: clock });
  const provider = new SelectiveFailureProvider();
  expect(await reconcileAgencyClosures(context.db, provider, { now: clock })).toMatchObject({ readyForPurge: 1, failed: 0 });
  expect((await context.db.select().from(subscriptions))[0]?.pendingBillingOperationId).toBeNull();
  expect((await context.db.select().from(billingOperations))[0]).toMatchObject({ state: "abandoned", lastErrorCode: "AGENCY_CLOSURE_SUPERSEDED" });
  expect(provider.calls).toEqual(["subscription-after-payment-crash"]);
});

it("recovers and cancels a provider trial created before the local transaction crashed", async () => {
  const createdAt = new Date("2026-08-08T09:00:00.000Z");
  const clock = new Date("2026-08-08T10:00:00.000Z");
  const agencyId = "92600000-0000-4000-8000-000000000001";
  const operationId = "92600000-0000-4000-8000-000000000002";
  await context.db.insert(agencies).values({ id: agencyId, name: "Closing trial", accountState: "closure_requested", closureRequestedAt: clock, createdAt, updatedAt: clock });
  await context.db.insert(billingOperations).values({ id: operationId, agencyId, operation: "create_trial", idempotencyKeyHash: "c".repeat(64), requestFingerprint: "d".repeat(64), state: "pending", createdAt, updatedAt: createdAt });
  await context.db.insert(agencyClosureCleanup).values({ id: "92600000-0000-4000-8000-000000000003", agencyId, providerSubscriptionRef: null, state: "pending", nextAttemptAt: createdAt, createdAt, updatedAt: createdAt });
  const provider = new SelectiveFailureProvider();
  provider.recoveredTrial = { customerRef: "customer-recovered", subscriptionRef: "trial-recovered", paymentMethodDisplay: "Tarjeta terminada en 4242", trialEndsAt: new Date("2026-09-07T10:00:00.000Z") };
  expect(await reconcileAgencyClosures(context.db, provider, { now: clock })).toMatchObject({ readyForPurge: 1, failed: 0 });
  expect(provider.calls).toEqual(["trial-recovered"]);
  expect((await context.db.select().from(billingOperations))[0]).toMatchObject({ state: "abandoned", providerAppliedAt: clock, lastErrorCode: "AGENCY_CLOSURE_SUPERSEDED" });
});

it("retries agency billing cleanup durably and never purges before provider confirmation", async () => {
  const requestedAt = new Date("2026-08-01T10:00:00.000Z");
  const agencyId = "93000000-0000-4000-8000-000000000001";
  const cleanupId = "93000000-0000-4000-8000-000000000002";
  const memberId = "93000000-0000-4000-8000-000000000004";
  await context.db.insert(users).values({
    id: memberId,
    kind: "agency",
    email: "cierre-agencia@example.es",
    fullName: "Miembro en cierre",
    passwordHash: "test-only",
    emailVerifiedAt: requestedAt,
    accountState: "closure_requested",
    closureRequestedAt: requestedAt,
    accountPurgeNextAttemptAt: requestedAt,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  });
  await context.db.insert(agencies).values({
    id: agencyId,
    name: "Agencia en cierre",
    accountState: "closure_requested",
    closureRequestedAt: requestedAt,
    accountPurgeNextAttemptAt: requestedAt,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  });
  await context.db.insert(agencyMemberships).values({ agencyId, userId: memberId, role: "admin", createdAt: requestedAt });
  await context.db.insert(analyticsEvents).values({
    id: "93000000-0000-4000-8000-000000000005",
    agencyId,
    actorUserId: memberId,
    eventName: "agency_registration_completed",
    occurredAt: requestedAt,
  });
  await context.db.insert(subscriptions).values({
    id: "93000000-0000-4000-8000-000000000003",
    agencyId,
    plan: "professional",
    state: "active",
    currentPeriodEndsAt: new Date("2026-09-01T10:00:00.000Z"),
    providerSubscriptionRef: "provider-subscription-sensitive",
    createdAt: requestedAt,
    updatedAt: requestedAt,
  });
  await context.db.insert(agencyClosureCleanup).values({
    id: cleanupId,
    agencyId,
    providerSubscriptionRef: "provider-subscription-sensitive",
    state: "pending",
    nextAttemptAt: requestedAt,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  });

  const provider = new FailOnceBillingProvider();
  const first = await reconcileAgencyClosures(context.db, provider, { now: new Date("2026-08-08T10:00:00.000Z") });
  expect(first).toEqual({ inspected: 1, providerApplied: 0, readyForPurge: 0, failed: 1, deferred: 0 });
  let cleanup = (await context.db.select().from(agencyClosureCleanup))[0]!;
  expect(cleanup).toMatchObject({ state: "failed", attempts: 1, lastErrorCode: "AGENCY_CLOSURE_PROVIDER_FAILED" });
  expect(JSON.stringify(cleanup)).not.toContain("customer@example.es");

  const deferred = await runDataLifecycle(context.db, new MemoryPrivateDocumentStorage(), {
    now: new Date("2026-08-08T10:01:00.000Z"),
    accountRetentionDays: 0,
  });
  expect(deferred).toMatchObject({ agenciesDeleted: 0 });
  expect(await context.db.select().from(agencies).where(eq(agencies.id, agencyId))).toHaveLength(1);

  const second = await reconcileAgencyClosures(context.db, provider, { now: new Date("2026-08-08T10:02:00.000Z") });
  expect(second).toEqual({ inspected: 1, providerApplied: 1, readyForPurge: 1, failed: 0, deferred: 0 });
  cleanup = (await context.db.select().from(agencyClosureCleanup))[0]!;
  expect(cleanup).toMatchObject({ state: "ready_for_purge", attempts: 2, lastErrorCode: null, providerSubscriptionRef: null });
  expect(provider.cancelCalls).toEqual([
    { subscriptionRef: "provider-subscription-sensitive", idempotencyKey: `agency-closure:${cleanupId}` },
    { subscriptionRef: "provider-subscription-sensitive", idempotencyKey: `agency-closure:${cleanupId}` },
  ]);

  const purged = await runDataLifecycle(context.db, new MemoryPrivateDocumentStorage(), {
    now: new Date("2026-08-08T10:03:00.000Z"),
    accountRetentionDays: 0,
  });
  expect(purged.agenciesDeleted).toBe(1);
  expect(await context.db.select().from(agencies).where(eq(agencies.id, agencyId))).toHaveLength(0);
  expect(await context.db.select().from(users).where(eq(users.id, memberId))).toHaveLength(0);
  expect(await context.db.select().from(analyticsEvents).where(eq(analyticsEvents.actorUserId, memberId))).toHaveLength(0);
  cleanup = (await context.db.select().from(agencyClosureCleanup))[0]!;
  expect(cleanup).toMatchObject({ state: "completed", providerSubscriptionRef: null });
});
