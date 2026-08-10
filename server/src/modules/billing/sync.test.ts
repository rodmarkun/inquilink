import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agencies, agencyMemberships, emailOutbox, invoices, subscriptions, users } from "../../db/schema.js";
import { createTestApp } from "../../test/test-app.js";
import { enqueueScheduledNotifications } from "../email/scheduler.js";
import { OutboxEmailProvider } from "../email/provider.js";
import type { BillingProvider, BillingProviderSubscriptionSnapshot, CreatedSubscription } from "./provider.js";
import { syncBillingProviderState } from "./sync.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const now = new Date("2026-08-08T10:00:00.000Z");
const agencyId = "95000000-0000-4000-8000-000000000001";
const userId = "95000000-0000-4000-8000-000000000002";
const subscriptionId = "95000000-0000-4000-8000-000000000003";

class SnapshotProvider implements BillingProvider {
  snapshot: BillingProviderSubscriptionSnapshot | null = null;
  failures = 0;
  readonly syncedRefs: string[] = [];
  async createTrial(): Promise<CreatedSubscription> { throw new Error("NOT_USED"); }
  async updateCustomerFiscalProfile(): Promise<void> { throw new Error("NOT_USED"); }
  async cancel(): Promise<void> { throw new Error("NOT_USED"); }
  async reactivate(): Promise<void> { throw new Error("NOT_USED"); }
  async changePlan(): Promise<void> { throw new Error("NOT_USED"); }
  async updatePaymentMethod(): Promise<{ paymentMethodDisplay: string }> { throw new Error("NOT_USED"); }
  async syncSubscription(input: { subscriptionRef: string }): Promise<BillingProviderSubscriptionSnapshot | null> {
    this.syncedRefs.push(input.subscriptionRef);
    if (this.failures > 0) { this.failures -= 1; throw new Error("provider response with private detail"); }
    return this.snapshot;
  }
}

class ReorderedSnapshotProvider extends SnapshotProvider {
  firstStartedResolve!: () => void;
  readonly firstStarted = new Promise<void>((resolve) => { this.firstStartedResolve = resolve; });
  releaseFirstResolve!: () => void;
  readonly releaseFirst = new Promise<void>((resolve) => { this.releaseFirstResolve = resolve; });
  override async syncSubscription(input: { subscriptionRef: string }): Promise<BillingProviderSubscriptionSnapshot> {
    this.syncedRefs.push(input.subscriptionRef);
    if (this.syncedRefs.length === 1) {
      this.firstStartedResolve();
      await this.releaseFirst;
      return { state: "past_due", trialEndsAt: new Date("2026-09-01T10:00:00.000Z"), currentPeriodEndsAt: new Date("2026-09-01T10:00:00.000Z"), cancelAtPeriodEnd: false, paymentMethodDisplay: "Tarjeta terminada en 1111", invoices: [] };
    }
    return { state: "active", trialEndsAt: new Date("2026-09-01T10:00:00.000Z"), currentPeriodEndsAt: new Date("2026-10-01T10:00:00.000Z"), cancelAtPeriodEnd: false, paymentMethodDisplay: "Tarjeta terminada en 2222", invoices: [] };
  }
}

class PoisonThenValidProvider extends SnapshotProvider {
  override async syncSubscription(input: { subscriptionRef: string }): Promise<BillingProviderSubscriptionSnapshot> {
    this.syncedRefs.push(input.subscriptionRef);
    return {
      state: "active",
      trialEndsAt: new Date("2026-09-01T10:00:00.000Z"),
      currentPeriodEndsAt: new Date("2026-10-01T10:00:00.000Z"),
      cancelAtPeriodEnd: false,
      paymentMethodDisplay: "Tarjeta terminada en 4242",
      invoices: input.subscriptionRef === "provider_subscription_sync" ? [{
        providerInvoiceRef: "poison-overflow", amountCents: 2_147_483_648, currency: "EUR", status: "paid", issuedAt: now, hostedUrl: null,
      }] : [],
    };
  }
}

beforeEach(async () => {
  context = await createTestApp();
  await context.db.insert(users).values({
    id: userId, kind: "agency", email: "billing-sync@example.es", fullName: "Admin Sync",
    passwordHash: "test-only", emailVerifiedAt: now, createdAt: now, updatedAt: now,
  });
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia Sync", createdAt: now, updatedAt: now });
  await context.db.insert(agencyMemberships).values({ agencyId, userId, role: "admin", createdAt: now });
  await context.db.insert(subscriptions).values({
    id: subscriptionId, agencyId, plan: "professional", state: "trialing",
    trialEndsAt: new Date("2026-09-01T10:00:00.000Z"), currentPeriodEndsAt: new Date("2026-09-01T10:00:00.000Z"),
    providerSubscriptionRef: "provider_subscription_sync", paymentMethodDisplay: "Tarjeta terminada en 4242",
    createdAt: now, updatedAt: now,
  });
});

it("does not let an earlier batch starve later subscriptions", async () => {
  const provider = new SnapshotProvider();
  for (let index = 4; index <= 5; index += 1) {
    const suffix = String(index).padStart(12, "0");
    const extraAgencyId = `95000000-0000-4000-8000-${suffix}`;
    const extraUserId = `95100000-0000-4000-8000-${suffix}`;
    const extraSubscriptionId = `95200000-0000-4000-8000-${suffix}`;
    await context.db.insert(users).values({ id: extraUserId, kind: "agency", email: `sync-${index}@example.es`, fullName: `Sync ${index}`, passwordHash: "test", emailVerifiedAt: now, createdAt: now, updatedAt: now });
    await context.db.insert(agencies).values({ id: extraAgencyId, name: `Agency ${index}`, createdAt: now, updatedAt: now });
    await context.db.insert(agencyMemberships).values({ agencyId: extraAgencyId, userId: extraUserId, role: "admin", createdAt: now });
    await context.db.insert(subscriptions).values({ id: extraSubscriptionId, agencyId: extraAgencyId, plan: "professional", state: "active", providerSubscriptionRef: `provider_${index}`, createdAt: now, updatedAt: now });
  }
  expect(await syncBillingProviderState(context.db, provider, { now, batchSize: 2 })).toMatchObject({ inspected: 2 });
  expect(await syncBillingProviderState(context.db, provider, { now, batchSize: 2 })).toMatchObject({ inspected: 1 });
  expect(new Set(provider.syncedRefs).size).toBe(3);
});

it("backs off a projection poison row and continues with later subscriptions", async () => {
  const laterAgencyId = "96000000-0000-4000-8000-000000000001";
  const laterUserId = "96000000-0000-4000-8000-000000000002";
  const laterSubscriptionId = "96000000-0000-4000-8000-000000000003";
  await context.db.insert(users).values({ id: laterUserId, kind: "agency", email: "later-sync@example.es", fullName: "Later", passwordHash: "test", emailVerifiedAt: now, createdAt: now, updatedAt: now });
  await context.db.insert(agencies).values({ id: laterAgencyId, name: "Later agency", createdAt: now, updatedAt: now });
  await context.db.insert(agencyMemberships).values({ agencyId: laterAgencyId, userId: laterUserId, role: "admin", createdAt: now });
  await context.db.insert(subscriptions).values({ id: laterSubscriptionId, agencyId: laterAgencyId, plan: "professional", state: "trialing", providerSubscriptionRef: "provider_later", createdAt: now, updatedAt: now });

  const provider = new PoisonThenValidProvider();
  expect(await syncBillingProviderState(context.db, provider, { now })).toMatchObject({ inspected: 2, updated: 1, failed: 1 });
  expect(provider.syncedRefs).toEqual(["provider_subscription_sync", "provider_later"]);
  expect((await context.db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]).toMatchObject({ billingSyncAttempts: 1, billingSyncLastErrorCode: "BILLING_SYNC_PROJECTION_FAILED", billingSyncClaimToken: null });
  expect((await context.db.select().from(subscriptions).where(eq(subscriptions.id, laterSubscriptionId)))[0]).toMatchObject({ state: "active", billingSyncClaimToken: null });
});

it("discards an old provider response after its sync lease is taken over", async () => {
  const provider = new ReorderedSnapshotProvider();
  const older = syncBillingProviderState(context.db, provider, { now, leaseMs: 5 * 60_000 });
  await provider.firstStarted;
  const newer = await syncBillingProviderState(context.db, provider, { now: new Date(now.getTime() + 6 * 60_000), leaseMs: 5 * 60_000 });
  expect(newer).toMatchObject({ updated: 1 });
  provider.releaseFirstResolve();
  expect(await older).toMatchObject({ updated: 0, deferred: 1 });
  expect((await context.db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0]).toMatchObject({
    state: "active", paymentMethodDisplay: "Tarjeta terminada en 2222", billingSyncClaimToken: null,
  });
});
afterEach(async () => context.close());

it("idempotently projects active state and provider invoices", async () => {
  const provider = new SnapshotProvider();
  provider.snapshot = {
    state: "active",
    trialEndsAt: new Date("2026-09-01T10:00:00.000Z"),
    currentPeriodEndsAt: new Date("2026-10-01T10:00:00.000Z"),
    cancelAtPeriodEnd: false,
    paymentMethodDisplay: "Tarjeta terminada en 1234",
    invoices: [{
      providerInvoiceRef: "invoice_provider_1", amountCents: 4_999, currency: "EUR", status: "paid",
      issuedAt: new Date("2026-09-01T10:00:00.000Z"), hostedUrl: "https://billing.example/invoices/1",
    }],
  };
  expect(await syncBillingProviderState(context.db, provider, { now })).toMatchObject({ inspected: 1, updated: 1, invoicesUpserted: 1, failed: 0 });
  provider.snapshot.invoices[0]!.hostedUrl = "https://billing.example/invoices/1-updated";
  expect(await syncBillingProviderState(context.db, provider, { now: new Date(now.getTime() + 15 * 60_000 + 1_000) })).toMatchObject({ updated: 1, invoicesUpserted: 1 });
  expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ state: "active", paymentMethodDisplay: "Tarjeta terminada en 1234" });
  const invoiceRows = await context.db.select().from(invoices);
  expect(invoiceRows).toHaveLength(1);
  expect(invoiceRows[0]).toMatchObject({ agencyId, subscriptionId, status: "paid", hostedUrl: "https://billing.example/invoices/1-updated" });
});

it("recovers after provider outage and makes past-due notification schedulable", async () => {
  const provider = new SnapshotProvider();
  provider.failures = 1;
  provider.snapshot = {
    state: "past_due", trialEndsAt: new Date("2026-09-01T10:00:00.000Z"), currentPeriodEndsAt: new Date("2026-09-01T10:00:00.000Z"), cancelAtPeriodEnd: false,
    paymentMethodDisplay: "Tarjeta terminada en 4242",
    invoices: [{ providerInvoiceRef: "invoice_provider_due", amountCents: 4_999, currency: "EUR", status: "past_due", issuedAt: now, hostedUrl: null }],
  };
  expect(await syncBillingProviderState(context.db, provider, { now })).toMatchObject({ inspected: 1, updated: 0, failed: 1 });
  expect((await context.db.select().from(subscriptions))[0]?.state).toBe("trialing");
  expect(await context.db.select().from(invoices)).toHaveLength(0);

  expect(await syncBillingProviderState(context.db, provider, { now: new Date(now.getTime() + 61_000) })).toMatchObject({ updated: 1, failed: 0 });
  await enqueueScheduledNotifications(context.db, new OutboxEmailProvider(context.db, () => now), now);
  expect((await context.db.select().from(subscriptions))[0]?.state).toBe("past_due");
  expect(await context.db.select().from(invoices).where(eq(invoices.providerInvoiceRef, "invoice_provider_due"))).toHaveLength(1);
  expect(await context.db.select().from(emailOutbox).where(eq(emailOutbox.template, "payment_failure"))).toHaveLength(1);
});
