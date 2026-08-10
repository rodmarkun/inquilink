import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agencies, agencyClosureCleanup, agencyMemberships, billingOperations, emailOutbox, invoices, properties, sessions, subscriptions, users } from "../../db/schema.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { createTestApp } from "../../test/test-app.js";
import { BillingProviderError, type BillingFiscalProfile, type BillingProvider, type BillingProviderSubscriptionSnapshot, type CreatedSubscription } from "./provider.js";
import { reconcileAgencyClosures } from "./closure.js";
import { syncBillingProviderState } from "./sync.js";
import { enqueueScheduledNotifications } from "../email/scheduler.js";
import { OutboxEmailProvider } from "../email/provider.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const agencyId = "11111111-1111-4111-8111-111111111111";
const adminId = "11111111-1111-4111-8111-111111111112";
const collaboratorId = "11111111-1111-4111-8111-111111111113";

async function seedAgency(): Promise<void> {
  const now = new Date();
  const passwordHash = await argon2.hash("test-password");
  await context.db.insert(users).values([
    { id: adminId, kind: "agency", email: "admin@example.es", fullName: "Admin", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: collaboratorId, kind: "agency", email: "colaborador@example.es", fullName: "Colaborador", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
  ]);
  await context.db.insert(agencies).values({ id: agencyId, name: "Agency", fiscalId: "B12345678", billingName: "Agency SL", billingAddress: "Calle Mayor 1, Madrid", createdAt: now, updatedAt: now });
  await context.db.insert(agencyMemberships).values([
    { agencyId, userId: adminId, role: "admin", createdAt: now },
    { agencyId, userId: collaboratorId, role: "collaborator", createdAt: now },
  ]);
  await context.db.insert(sessions).values([
    { id: newId(), userId: adminId, tokenHash: hashSecret("admin-token"), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
    { id: newId(), userId: collaboratorId, tokenHash: hashSecret("collaborator-token"), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
  ]);
}

beforeEach(async () => {
  context = await createTestApp();
  await seedAgency();
});
afterEach(async () => context.close());

describe("billing safety", () => {
  it("stores normalized Spanish fiscal data and exposes it only to administrators", async () => {
    const denied = await context.app.inject({ method: "PATCH", url: "/api/v1/billing/fiscal-profile", headers: { cookie: "inquilink_session=collaborator-token", "idempotency-key": "fiscal-denied-0001" }, payload: { fiscalId: "B-12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, 28013 Madrid" } });
    expect(denied.statusCode).toBe(403);
    const updated = await context.app.inject({ method: "PATCH", url: "/api/v1/billing/fiscal-profile", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "fiscal-local-0001" }, payload: { fiscalId: "B-12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, 28013 Madrid" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.fiscalProfile).toEqual({ fiscalId: "B12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, 28013 Madrid" });
    const status = await context.app.inject({ method: "GET", url: "/api/v1/billing/status", headers: { cookie: "inquilink_session=admin-token" } });
    expect(status.json().data.fiscalProfile).toEqual(updated.json().data.fiscalProfile);
  });

  it("sends fiscal data on trial creation and synchronizes later updates idempotently", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    const trial = await context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-with-fiscal-0001" }, payload: { plan: "professional", paymentMethodToken: "pm_fiscal" } });
    expect(trial.statusCode).toBe(201);
    expect(provider.trialFiscalProfiles).toEqual([{ fiscalId: "B12345678", billingName: "Agency SL", billingAddress: "Calle Mayor 1, Madrid" }]);
    const request = { method: "PATCH" as const, url: "/api/v1/billing/fiscal-profile", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "fiscal-provider-update-0001" }, payload: { fiscalId: "B-87654321", billingName: "Agency Nueva SL", billingAddress: "Gran Vía 2, Madrid" } };
    const updated = await context.app.inject(request);
    expect(updated.statusCode).toBe(200);
    expect(provider.fiscalUpdates).toEqual([{ customerRef: "customer_test", fiscalProfile: { fiscalId: "B87654321", billingName: "Agency Nueva SL", billingAddress: "Gran Vía 2, Madrid" }, idempotencyKey: expect.stringMatching(/^billing-operation:/) }]);
    const replay = await context.app.inject(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(provider.fiscalUpdates).toHaveLength(1);
  });

  it("keeps the prior fiscal profile after an ambiguous provider result and retries with the same durable key", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    expect((await context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-before-fiscal-retry" }, payload: { plan: "professional", paymentMethodToken: "pm_fiscal_retry" } })).statusCode).toBe(201);
    provider.fiscalFailOnce = true;
    const request = { method: "PATCH" as const, url: "/api/v1/billing/fiscal-profile", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "fiscal-ambiguous-retry-1" }, payload: { fiscalId: "B-87654321", billingName: "Agency Retry SL", billingAddress: "Gran Vía 3, Madrid" } };
    expect((await context.app.inject(request)).statusCode).toBe(503);
    expect((await context.db.select().from(agencies).where(eq(agencies.id, agencyId)))[0]).toMatchObject({ fiscalId: "B12345678", billingName: "Agency SL" });
    expect((await context.app.inject(request)).statusCode).toBe(200);
    expect(provider.fiscalUpdates).toHaveLength(2);
    expect(new Set(provider.fiscalUpdates.map((call) => call.idempotencyKey)).size).toBe(1);
    expect((await context.db.select().from(agencies).where(eq(agencies.id, agencyId)))[0]).toMatchObject({ fiscalId: "B87654321", billingName: "Agency Retry SL" });
  });

  it("releases a definitively rejected fiscal update so corrected data can be synchronized", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    expect((await context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-before-fiscal-decline" }, payload: { plan: "professional", paymentMethodToken: "pm_fiscal_decline" } })).statusCode).toBe(201);
    provider.fiscalDeclineOnce = true;
    const base = { method: "PATCH" as const, url: "/api/v1/billing/fiscal-profile", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "fiscal-declined-0001" }, payload: { fiscalId: "B-87654321", billingName: "Agency Corrected SL", billingAddress: "Gran Vía 4, Madrid" } };
    expect((await context.app.inject(base)).statusCode).toBe(422);
    const corrected = await context.app.inject({ ...base, headers: { ...base.headers, "idempotency-key": "fiscal-corrected-0002" } });
    expect(corrected.statusCode).toBe(200);
    expect((await context.db.select().from(subscriptions))[0]?.pendingBillingOperationId).toBeNull();
  });

  it("keeps the provider-authoritative trial end across a delayed response, status, and reminders", async () => {
    await context.close();
    const activationAt = new Date("2026-08-08T10:00:00.000Z");
    let appClock = activationAt;
    const provider = new ControlledBillingProvider();
    provider.authoritativeTrialEndsAt = new Date("2026-09-07T10:00:00.000Z");
    let releaseTrial!: () => void;
    provider.trialBarrier = new Promise<void>((resolve) => { releaseTrial = resolve; });
    context = await createTestApp({}, () => appClock, { billingProvider: provider });
    await seedAgency();
    const request = context.app.inject({
      method: "POST", url: "/api/v1/billing/trial",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-authoritative-date-1" },
      payload: { plan: "professional", paymentMethodToken: "pm_authoritative" },
    });
    await provider.trialStarted;
    appClock = new Date(activationAt.getTime() + 6 * 60 * 60_000);
    releaseTrial();
    const created = await request;
    expect(created.statusCode).toBe(201);
    expect(created.json().data.subscription.trialEndsAt).toBe("2026-09-07T10:00:00.000Z");
    expect((await context.db.select().from(subscriptions))[0]?.trialEndsAt).toEqual(provider.authoritativeTrialEndsAt);

    const status = await context.app.inject({ method: "GET", url: "/api/v1/billing/status", headers: { cookie: "inquilink_session=admin-token" } });
    expect(status.json().data.subscription.trialEndsAt).toBe("2026-09-07T10:00:00.000Z");
    await enqueueScheduledNotifications(context.db, new OutboxEmailProvider(context.db, () => new Date("2026-09-05T10:00:00.000Z")), new Date("2026-09-05T10:00:00.000Z"));
    const reminder = (await context.db.select().from(emailOutbox).where(eq(emailOutbox.template, "trial_ending")))[0]!;
    expect(reminder.variables).toMatchObject({ trialEndsAt: "2026-09-07T10:00:00.000Z" });
  });

  it("attaches and cancels a trial that succeeds after agency closure starts", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    let releaseTrial!: () => void;
    provider.trialBarrier = new Promise<void>((resolve) => { releaseTrial = resolve; });
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    const inFlight = context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-before-close-race-1" }, payload: { plan: "professional", paymentMethodToken: "pm_trial_race" } });
    await provider.trialStarted;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: "inquilink_session=admin-token" }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    expect((await context.db.select().from(agencyClosureCleanup))[0]).toMatchObject({ state: "pending", providerSubscriptionRef: null });
    releaseTrial();
    expect((await inFlight).statusCode).toBe(201);
    expect((await context.db.select().from(agencyClosureCleanup))[0]).toMatchObject({ state: "pending", providerSubscriptionRef: "subscription_test" });
    expect(await reconcileAgencyClosures(context.db, provider, { now: new Date(Date.now() + 1_000) })).toMatchObject({ readyForPurge: 1 });
    expect(provider.cancelKeys).toHaveLength(1);
  });

  it("keeps one unresolved trial saga across an ambiguous provider acceptance", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    provider.trialAcceptThenTimeout = true;
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    const original = { method: "POST" as const, url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-ambiguous-original-1" }, payload: { plan: "professional", paymentMethodToken: "pm_trial_safe" } };
    const ambiguous = await context.app.inject(original);
    expect(ambiguous.statusCode).toBe(503);
    expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ state: "incomplete" });
    const differentKey = await context.app.inject({ ...original, headers: { ...original.headers, "idempotency-key": "trial-ambiguous-different-2" } });
    expect(differentKey.statusCode).toBe(409);
    expect(provider.trialCalls).toBe(1);
    const converged = await context.app.inject(original);
    expect(converged.statusCode).toBe(201);
    expect(provider.trialCalls).toBe(2);
    expect(new Set(provider.trialKeys).size).toBe(1);
    expect(await context.db.select().from(subscriptions)).toEqual([expect.objectContaining({ state: "trialing", pendingBillingOperationId: null })]);
  });

  it("removes a definitively declined trial placeholder so a new valid key can succeed", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    provider.trialError = new BillingProviderError("declined");
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    const declined = await context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-declined-first-1" }, payload: { plan: "professional", paymentMethodToken: "pm_declined" } });
    expect(declined.statusCode).toBe(422);
    expect(await context.db.select().from(subscriptions)).toHaveLength(0);
    provider.trialError = null;
    const accepted = await context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-valid-second-22" }, payload: { plan: "professional", paymentMethodToken: "pm_valid" } });
    expect(accepted.statusCode).toBe(201);
    expect(await context.db.select().from(subscriptions)).toEqual([expect.objectContaining({ state: "trialing" })]);
  });

  it("invalidates an in-flight provider sync before applying a newer payment method", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    provider.syncSnapshot = { state: "active", trialEndsAt: new Date("2026-09-01T10:00:00.000Z"), currentPeriodEndsAt: new Date("2026-10-01T10:00:00.000Z"), cancelAtPeriodEnd: false, paymentMethodDisplay: "Tarjeta terminada en 1111", invoices: [] };
    provider.paymentDisplay = "Tarjeta terminada en 9999";
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(false);
    const sync = syncBillingProviderState(context.db, provider, { now: new Date() });
    await provider.syncStarted;
    const payment = await context.app.inject({ method: "PATCH", url: "/api/v1/billing/payment-method", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "payment-invalidates-sync-1" }, payload: { paymentMethodToken: "pm_new_card" } });
    expect(payment.statusCode).toBe(200);
    provider.releaseSyncResolve();
    expect(await sync).toMatchObject({ updated: 0, deferred: 1 });
    expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ paymentMethodDisplay: "Tarjeta terminada en 9999", pendingBillingOperationId: null });
  });

  it("namespaces every provider mutation by its durable operation, not the client key", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    const secondAgencyId = "11111111-1111-4111-8111-111111111151";
    const secondAdminId = "11111111-1111-4111-8111-111111111152";
    const createdAt = new Date();
    await context.db.insert(users).values({ id: secondAdminId, kind: "agency", email: "second@example.es", fullName: "Second", passwordHash: "test", emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt });
    await context.db.insert(agencies).values({ id: secondAgencyId, name: "Second Agency", fiscalId: "B87654321", billingName: "Second Agency SL", billingAddress: "Calle Segunda 2, Madrid", createdAt, updatedAt: createdAt });
    await context.db.insert(agencyMemberships).values({ agencyId: secondAgencyId, userId: secondAdminId, role: "admin", createdAt });
    await context.db.insert(sessions).values({ id: newId(), userId: secondAdminId, tokenHash: hashSecret("second-token"), createdAt, lastSeenAt: createdAt, expiresAt: new Date(createdAt.getTime() + 86_400_000) });
    for (const token of ["admin-token", "second-token"]) {
      expect((await context.app.inject({ method: "POST", url: "/api/v1/billing/trial", headers: { cookie: `inquilink_session=${token}`, "idempotency-key": "same-client-key-across-agencies" }, payload: { plan: "professional", paymentMethodToken: "pm_nonce_safe" } })).statusCode).toBe(201);
      expect((await context.app.inject({ method: "PATCH", url: "/api/v1/billing/payment-method", headers: { cookie: `inquilink_session=${token}`, "idempotency-key": "same-client-key-across-agencies" }, payload: { paymentMethodToken: "pm_replacement_safe" } })).statusCode).toBe(200);
    }
    const allKeys = [...provider.trialKeys, ...provider.paymentKeys];
    expect(allKeys).toHaveLength(4);
    expect(new Set(allKeys).size).toBe(4);
    expect(allKeys.every((key) => /^billing-operation:[0-9a-f-]{36}$/.test(key))).toBe(true);
    expect(allKeys).not.toContain("same-client-key-across-agencies");
  });

  it("never creates an external trial after agency closure has started", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    const closureAt = new Date();
    await context.db.update(agencies).set({ accountState: "closure_requested", closureRequestedAt: closureAt, updatedAt: closureAt })
      .where(eq(agencies.id, agencyId));
    const response = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-after-closure-0001" },
      payload: { plan: "professional", paymentMethodToken: "pm_provider_nonce" },
    });
    expect([401, 403, 409]).toContain(response.statusCode);
    expect(provider.trialCalls).toBe(0);
    expect(await context.db.select().from(subscriptions)).toHaveLength(0);
  });

  it("lists only invoices whose subscription belongs to the authenticated agency", async () => {
    await insertSubscription(false);
    const ownSubscription = (await context.db.select().from(subscriptions).where(eq(subscriptions.agencyId, agencyId)))[0]!;
    const otherAgencyId = "11111111-1111-4111-8111-111111111121";
    const otherSubscriptionId = "11111111-1111-4111-8111-111111111122";
    const issuedAt = new Date();
    await context.db.insert(agencies).values({ id: otherAgencyId, name: "Other Agency", createdAt: issuedAt, updatedAt: issuedAt });
    await context.db.insert(subscriptions).values({ id: otherSubscriptionId, agencyId: otherAgencyId, plan: "inmobiliaria", state: "active", currentPeriodEndsAt: issuedAt, createdAt: issuedAt, updatedAt: issuedAt });
    await context.db.insert(invoices).values([
      { id: "11111111-1111-4111-8111-111111111123", agencyId, subscriptionId: ownSubscription.id, providerInvoiceRef: "invoice-own", amountCents: 4_999, status: "paid", issuedAt },
      { id: "11111111-1111-4111-8111-111111111124", agencyId: otherAgencyId, subscriptionId: otherSubscriptionId, providerInvoiceRef: "invoice-other", amountCents: 9_999, status: "paid", issuedAt },
    ]);
    const response = await context.app.inject({ method: "GET", url: "/api/v1/billing/invoices", headers: { cookie: "inquilink_session=admin-token" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.invoices).toEqual([expect.objectContaining({ id: "11111111-1111-4111-8111-111111111123", amountCents: 4_999 })]);
    expect(JSON.stringify(response.json())).not.toContain("invoice-other");
  });

  it("requires an administrator and does not persist the provider payment token", async () => {
    const denied = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=collaborator-token", "idempotency-key": "trial-collaborator-1" },
      payload: { plan: "professional", paymentMethodToken: "pm_sensitive_nonce" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("ADMIN_REQUIRED");

    const activated = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-admin-1" },
      payload: { plan: "professional", paymentMethodToken: "pm_sensitive_nonce" },
    });
    expect(activated.statusCode).toBe(201);
    expect(activated.json().data).toMatchObject({ firstChargeCents: 4999, currency: "EUR", taxTreatment: "pending_commercial_decision" });
    const records = await context.db.select().from(subscriptions).where(eq(subscriptions.agencyId, agencyId));
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0])).not.toContain("pm_sensitive_nonce");
    expect(records[0]?.trialEndsAt?.getTime()).toBe(records[0]?.createdAt.getTime() + 30 * 86_400_000);

    const replay = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-admin-1" },
      payload: { plan: "professional", paymentMethodToken: "pm_sensitive_nonce" },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(await context.db.select().from(subscriptions).where(eq(subscriptions.agencyId, agencyId))).toHaveLength(1);
    expect(await context.db.select().from(billingOperations).where(eq(billingOperations.agencyId, agencyId))).toHaveLength(1);

    const reusedKey = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-admin-1" },
      payload: { plan: "inmobiliaria", paymentMethodToken: "pm_other_sensitive_nonce" },
    });
    expect(reusedKey.statusCode).toBe(409);
    expect(reusedKey.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const status = await context.app.inject({ method: "GET", url: "/api/v1/billing/status", headers: { cookie: "inquilink_session=admin-token" } });
    expect(status.json().data.subscription).not.toHaveProperty("providerCustomerRef");
    expect(status.json().data.subscription).not.toHaveProperty("providerSubscriptionRef");
    expect(status.json().data.prices).toEqual({ particular: 999, professional: 4_999, inmobiliaria: 9_999 });
    expect(status.json().data.allowances).toEqual({
      particular: { name: "Particular", priceCents: 999, listingLimit: 2, accountLimit: 1 },
      professional: { name: "Profesional", priceCents: 4_999, listingLimit: 15, accountLimit: 3 },
      inmobiliaria: { name: "Inmobiliaria", priceCents: 9_999, listingLimit: 100, accountLimit: null },
    });

    const paymentMethod = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/payment-method", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "payment-admin-1" },
      payload: { paymentMethodToken: "pm_replacement_sensitive_nonce" },
    });
    expect(paymentMethod.statusCode).toBe(200);
    const afterUpdate = await context.db.select().from(subscriptions).where(eq(subscriptions.agencyId, agencyId));
    expect(JSON.stringify(afterUpdate[0])).not.toContain("pm_replacement_sensitive_nonce");

    const paymentReplay = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/payment-method", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "payment-admin-1" },
      payload: { paymentMethodToken: "pm_replacement_sensitive_nonce" },
    });
    expect(paymentReplay.statusCode).toBe(200);
    expect(paymentReplay.headers["idempotency-replayed"]).toBe("true");
    const operations = await context.db.select().from(billingOperations).where(eq(billingOperations.agencyId, agencyId));
    expect(operations).toHaveLength(2);
    expect(JSON.stringify(operations)).not.toContain("pm_sensitive_nonce");
    expect(JSON.stringify(operations)).not.toContain("pm_replacement_sensitive_nonce");

    const rawCard = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/payment-method", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "payment-admin-2" },
      payload: { paymentMethodToken: "pm_safe_nonce", cardNumber: "4242424242424242", cvc: "123" },
    });
    expect(rawCard.statusCode).toBe(400);
    expect(JSON.stringify(await context.db.select().from(billingOperations))).not.toContain("4242424242424242");
  });

  it("retains an ambiguous cancellation reservation until same-key reconciliation completes", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    provider.failCancel = true;
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(false);

    const failed = await context.app.inject({
      method: "POST", url: "/api/v1/billing/cancel",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-reconcile-0001" },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("BILLING_PROVIDER_UNAVAILABLE");
    const ambiguousOperation = (await context.db.select().from(billingOperations))[0]!;
    expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ cancelAtPeriodEnd: false, pendingBillingOperationId: ambiguousOperation.id });
    expect(ambiguousOperation).toMatchObject({ operation: "cancel", state: "unknown", lastErrorCode: "BILLING_PROVIDER_RESULT_UNKNOWN" });

    const oppositeIntent = await context.app.inject({
      method: "POST", url: "/api/v1/billing/reactivate",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "reactivate-during-unknown-0001" },
    });
    expect(oppositeIntent.statusCode).toBe(409);
    expect(oppositeIntent.json().error.code).toBe("BILLING_TRANSITION_IN_PROGRESS");
    expect(provider.reactivateKeys).toHaveLength(0);

    provider.failCancel = false;
    const reconciled = await context.app.inject({
      method: "POST", url: "/api/v1/billing/cancel",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-reconcile-0001" },
    });
    expect(reconciled.statusCode).toBe(200);
    expect((await context.db.select().from(subscriptions))[0]?.cancelAtPeriodEnd).toBe(true);
    expect((await context.db.select().from(billingOperations).where(eq(billingOperations.id, ambiguousOperation.id)))[0]?.state).toBe("completed");
    expect(provider.cancelKeys).toEqual([
      `billing-operation:${ambiguousOperation.id}`,
      `billing-operation:${ambiguousOperation.id}`,
    ]);

    const replay = await context.app.inject({
      method: "POST", url: "/api/v1/billing/cancel",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-reconcile-0001" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(provider.cancelKeys).toHaveLength(2);
  });

  it("releases the reservation only when the provider definitively rejects the change", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    provider.cancelError = new BillingProviderError("declined");
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(false);
    const rejected = await context.app.inject({
      method: "POST", url: "/api/v1/billing/cancel",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-declined-000001" },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("BILLING_CHANGE_REJECTED");
    expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ cancelAtPeriodEnd: false, pendingBillingOperationId: null });
    expect((await context.db.select().from(billingOperations))[0]).toMatchObject({ state: "failed", lastErrorCode: "BILLING_CHANGE_REJECTED" });
  });

  it("returns 422 only for an explicit decline and 503 for retryable provider failures", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    provider.trialError = new BillingProviderError("declined");
    const declined = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-provider-error-0001" },
      payload: { plan: "professional", paymentMethodToken: "pm_provider_nonce" },
    });
    expect(declined.statusCode).toBe(422);
    expect(declined.json().error.code).toBe("PAYMENT_METHOD_REJECTED");
    expect((await context.db.select().from(billingOperations))[0]).toMatchObject({ state: "failed", lastErrorCode: "PAYMENT_METHOD_REJECTED" });

    provider.trialError = new BillingProviderError("unavailable");
    const unavailable = await context.app.inject({
      method: "POST", url: "/api/v1/billing/trial",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "trial-provider-error-0001" },
      payload: { plan: "professional", paymentMethodToken: "pm_provider_nonce" },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("BILLING_PROVIDER_UNAVAILABLE");
    expect((await context.db.select().from(billingOperations))[0]).toMatchObject({ state: "unknown", lastErrorCode: "BILLING_PROVIDER_RESULT_UNKNOWN" });
  });

  it("blocks concurrent cancel/reactivate operations behind one persisted subscription reservation", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(false);
    let releaseProvider!: () => void;
    provider.cancelBarrier = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const firstCancel = context.app.inject({ method: "POST", url: "/api/v1/billing/cancel", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-concurrent-0001" } });
    await provider.cancelStarted;
    const secondCancel = await context.app.inject({ method: "POST", url: "/api/v1/billing/cancel", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-concurrent-0002" } });
    const conflictingReactivate = await context.app.inject({ method: "POST", url: "/api/v1/billing/reactivate", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "reactivate-concurrent-0001" } });
    expect(secondCancel.statusCode).toBe(409);
    expect(secondCancel.json().error.code).toBe("BILLING_TRANSITION_IN_PROGRESS");
    expect(conflictingReactivate.statusCode).toBe(409);
    expect(conflictingReactivate.json().error.code).toBe("BILLING_TRANSITION_IN_PROGRESS");
    releaseProvider();
    expect((await firstCancel).statusCode).toBe(200);
    expect(provider.cancelKeys).toHaveLength(1);
    expect((await context.db.select().from(subscriptions))[0]?.cancelAtPeriodEnd).toBe(true);

    const retrySecond = await context.app.inject({ method: "POST", url: "/api/v1/billing/cancel", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-concurrent-0002" } });
    expect(retrySecond.statusCode).toBe(200);
    expect(provider.cancelKeys).toHaveLength(1);
    const reactivate = await context.app.inject({ method: "POST", url: "/api/v1/billing/reactivate", headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "reactivate-after-cancel-0001" } });
    expect(reactivate.statusCode).toBe(200);
    expect(provider.reactivateKeys).toHaveLength(1);
    expect((await context.db.select().from(subscriptions))[0]?.cancelAtPeriodEnd).toBe(false);
    expect(await context.db.select().from(billingOperations)).toHaveLength(4);
  });

  it("orders final closure cancellation after an in-flight reactivation", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(true);
    let releaseReactivate!: () => void;
    provider.reactivateBarrier = new Promise<void>((resolve) => { releaseReactivate = resolve; });
    const inFlight = context.app.inject({
      method: "POST", url: "/api/v1/billing/reactivate",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "reactivate-before-close-0001" },
    });
    await provider.reactivateStarted;
    const closed = await context.app.inject({
      method: "POST", url: "/api/v1/account/close", headers: { cookie: "inquilink_session=admin-token" },
      payload: { confirmation: "CERRAR MI CUENTA" },
    });
    expect(closed.statusCode).toBe(202);

    const whileInFlight = await reconcileAgencyClosures(context.db, provider, { now: new Date() });
    expect(whileInFlight).toMatchObject({ inspected: 1, deferred: 1, readyForPurge: 0 });
    expect(provider.cancelKeys).toHaveLength(0);

    releaseReactivate();
    const lateResult = await inFlight;
    expect(lateResult.statusCode).toBe(200);
    const afterLateResult = (await context.db.select().from(billingOperations).where(eq(billingOperations.operation, "reactivate")))[0]!;
    expect(afterLateResult).toMatchObject({ state: "completed" });
    expect(afterLateResult.providerAppliedAt).not.toBeNull();
    expect((await context.db.select().from(subscriptions))[0]?.pendingBillingOperationId).toBeNull();

    const reconciled = await reconcileAgencyClosures(context.db, provider, { now: new Date(Date.now() + 16_000) });
    expect(reconciled).toMatchObject({ inspected: 1, deferred: 0, readyForPurge: 1 });
    expect(provider.reactivateKeys).toEqual([`billing-operation:${afterLateResult.id}`]);
    expect(provider.cancelKeys).toHaveLength(1);
    expect(provider.cancelKeys[0]).toMatch(/^agency-closure:/);
    expect((await context.db.select().from(agencyClosureCleanup))[0]).toMatchObject({ state: "ready_for_purge", providerSubscriptionRef: null });
  });

  it("reconciles a persisted provider-success marker without calling the provider twice", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(false);
    const operationId = newId();
    const markerAt = new Date();
    await context.db.insert(billingOperations).values({
      id: operationId, agencyId, operation: "cancel",
      idempotencyKeyHash: hashSecret("cancel-provider-applied-0001"), requestFingerprint: hashSecret("cancel"),
      state: "failed", providerAppliedAt: markerAt, attempts: 1,
      lastErrorCode: "LOCAL_COMMIT_FAILED", createdAt: markerAt, updatedAt: markerAt,
    });
    await context.db.update(subscriptions).set({ pendingBillingOperationId: operationId }).where(eq(subscriptions.agencyId, agencyId));
    const reconciled = await context.app.inject({
      method: "POST", url: "/api/v1/billing/cancel",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "cancel-provider-applied-0001" },
    });
    expect(reconciled.statusCode).toBe(200);
    expect(provider.cancelKeys).toHaveLength(0);
    expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ cancelAtPeriodEnd: true, pendingBillingOperationId: null });
    expect((await context.db.select().from(billingOperations))[0]).toMatchObject({ state: "completed", providerAppliedAt: markerAt, attempts: 1, lastErrorCode: null });
  });

  it("changes plan idempotently and rejects a downgrade that cannot hold current usage", async () => {
    await context.close();
    const provider = new ControlledBillingProvider();
    context = await createTestApp({}, undefined, { billingProvider: provider });
    await seedAgency();
    await insertSubscription(false);

    const upgraded = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/plan",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "change-plan-upgrade-0001" },
      payload: { plan: "inmobiliaria" },
    });
    expect(upgraded.statusCode).toBe(200);
    expect(upgraded.json().data).toEqual({ previousPlan: "professional", plan: "inmobiliaria", priceCents: 9_999, currency: "EUR" });
    expect((await context.db.select().from(subscriptions))[0]).toMatchObject({ plan: "inmobiliaria", pendingBillingOperationId: null });
    expect(provider.planChanges).toEqual([{ plan: "inmobiliaria", idempotencyKey: expect.stringMatching(/^billing-operation:/) }]);

    const replay = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/plan",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "change-plan-upgrade-0001" },
      payload: { plan: "inmobiliaria" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(provider.planChanges).toHaveLength(1);

    const createdAt = new Date();
    await context.db.insert(properties).values(Array.from({ length: 3 }, (_, index) => ({
      id: `11111111-1111-4111-8111-1111111112${index + 5}`,
      agencyId, internalReference: `DOWN-${index}`, title: `Piso ${index}`, address: "Calle Mayor 1", city: "Madrid", province: "Madrid", postalCode: "28001",
      propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 40, availableFrom: "2026-09-01", description: "Descripción", publicLocation: "Madrid",
      monthlyRentCents: 100_000, state: "published" as const, createdAt, updatedAt: createdAt,
    })));
    const downgrade = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/plan",
      headers: { cookie: "inquilink_session=admin-token", "idempotency-key": "change-plan-downgrade-001" },
      payload: { plan: "particular" },
    });
    expect(downgrade.statusCode).toBe(409);
    expect(downgrade.json().error).toMatchObject({ code: "PLAN_DOWNGRADE_LIMIT_EXCEEDED", details: { usage: { listings: 3 }, limits: { listings: 2 } } });
    expect((await context.db.select().from(subscriptions))[0]?.plan).toBe("inmobiliaria");
    expect(provider.planChanges).toHaveLength(1);

    const denied = await context.app.inject({
      method: "PATCH", url: "/api/v1/billing/plan",
      headers: { cookie: "inquilink_session=collaborator-token", "idempotency-key": "change-plan-denied-00001" },
      payload: { plan: "professional" },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("blocks capacity increases while a downgrade is waiting for the provider", async () => {
    await insertSubscription(false);
    const createdAt = new Date();
    const operationId = newId();
    await context.db.insert(billingOperations).values({
      id: operationId, agencyId, operation: "change_plan", idempotencyKeyHash: hashSecret("change-plan-race-00001"),
      requestFingerprint: hashSecret("particular"), state: "pending", createdAt, updatedAt: createdAt,
    });
    await context.db.update(subscriptions).set({ pendingBillingOperationId: operationId }).where(eq(subscriptions.agencyId, agencyId));
    await context.db.insert(properties).values(Array.from({ length: 3 }, (_, index) => ({
      id: `11111111-1111-4111-8111-11111111113${index + 1}`,
      agencyId, internalReference: `RACE-${index}`, title: `Piso ${index}`, address: "Calle Mayor 1", city: "Madrid", province: "Madrid", postalCode: "28001",
      propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 40, availableFrom: "2026-09-01", description: "Descripción", publicLocation: "Madrid",
      monthlyRentCents: 100_000, state: index < 2 ? "published" as const : "draft" as const, createdAt, updatedAt: createdAt,
    })));

    const publish = await context.app.inject({
      method: "POST", url: "/api/v1/agency/properties/11111111-1111-4111-8111-111111111133/publish",
      headers: { cookie: "inquilink_session=collaborator-token", "idempotency-key": "publish-during-downgrade-1" }, payload: { expectedVersion: 1 },
    });
    expect(publish.statusCode).toBe(409);
    expect(publish.json().error.code).toBe("BILLING_TRANSITION_IN_PROGRESS");
  });
});

class ControlledBillingProvider implements BillingProvider {
  failCancel = false;
  cancelError: Error | null = null;
  cancelKeys: string[] = [];
  reactivateKeys: string[] = [];
  cancelBarrier: Promise<void> | null = null;
  reactivateBarrier: Promise<void> | null = null;
  private cancelStartedResolve!: () => void;
  readonly cancelStarted = new Promise<void>((resolve) => { this.cancelStartedResolve = resolve; });
  private reactivateStartedResolve!: () => void;
  readonly reactivateStarted = new Promise<void>((resolve) => { this.reactivateStartedResolve = resolve; });
  trialError: Error | null = null;
  trialCalls = 0;
  trialAcceptThenTimeout = false;
  trialBarrier: Promise<void> | null = null;
  private trialStartedResolve!: () => void;
  readonly trialStarted = new Promise<void>((resolve) => { this.trialStartedResolve = resolve; });
  private readonly acceptedTrialKeys = new Set<string>();
  paymentDisplay = "Tarjeta terminada en 4242";
  syncSnapshot: BillingProviderSubscriptionSnapshot | null = null;
  private syncStartedResolve!: () => void;
  readonly syncStarted = new Promise<void>((resolve) => { this.syncStartedResolve = resolve; });
  releaseSyncResolve!: () => void;
  readonly releaseSync = new Promise<void>((resolve) => { this.releaseSyncResolve = resolve; });
  trialKeys: string[] = [];
  trialFiscalProfiles: BillingFiscalProfile[] = [];
  fiscalUpdates: Array<{ customerRef: string; fiscalProfile: BillingFiscalProfile; idempotencyKey: string }> = [];
  fiscalFailOnce = false;
  fiscalDeclineOnce = false;
  paymentKeys: string[] = [];
  planChanges: Array<{ plan: "particular" | "professional" | "inmobiliaria"; idempotencyKey: string }> = [];
  authoritativeTrialEndsAt = new Date("2026-09-07T10:00:00.000Z");
  async createTrial(input: { agencyId: string; plan: "professional" | "inmobiliaria"; paymentMethodToken: string; activationRequestedAt: Date; fiscalProfile: BillingFiscalProfile; idempotencyKey: string }): Promise<CreatedSubscription> {
    this.trialCalls += 1;
    this.trialKeys.push(input.idempotencyKey);
    this.trialFiscalProfiles.push(input.fiscalProfile);
    this.trialStartedResolve();
    if (this.trialBarrier) await this.trialBarrier;
    if (this.trialAcceptThenTimeout && !this.acceptedTrialKeys.has(input.idempotencyKey)) {
      this.acceptedTrialKeys.add(input.idempotencyKey);
      throw new BillingProviderError("unavailable");
    }
    if (this.trialError) throw this.trialError;
    return { customerRef: "customer_test", subscriptionRef: "subscription_test", paymentMethodDisplay: "Tarjeta terminada en 4242", trialEndsAt: this.authoritativeTrialEndsAt };
  }
  async updateCustomerFiscalProfile(input: { customerRef: string; fiscalProfile: BillingFiscalProfile; idempotencyKey: string }): Promise<void> {
    this.fiscalUpdates.push(input);
    if (this.fiscalFailOnce) { this.fiscalFailOnce = false; throw new BillingProviderError("unavailable"); }
    if (this.fiscalDeclineOnce) { this.fiscalDeclineOnce = false; throw new BillingProviderError("declined"); }
  }
  async cancel(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {
    this.cancelKeys.push(input.idempotencyKey);
    this.cancelStartedResolve();
    if (this.cancelBarrier) await this.cancelBarrier;
    if (this.cancelError) throw this.cancelError;
    if (this.failCancel) throw Object.assign(new Error("provider unavailable"), { code: "PROVIDER_UNAVAILABLE" });
  }
  async reactivate(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {
    this.reactivateKeys.push(input.idempotencyKey);
    this.reactivateStartedResolve();
    if (this.reactivateBarrier) await this.reactivateBarrier;
  }
  async updatePaymentMethod(input: { customerRef: string; paymentMethodToken: string; idempotencyKey: string }): Promise<{ paymentMethodDisplay: string }> {
    this.paymentKeys.push(input.idempotencyKey);
    return { paymentMethodDisplay: this.paymentDisplay };
  }
  async changePlan(input: { subscriptionRef: string; plan: "particular" | "professional" | "inmobiliaria"; idempotencyKey: string }): Promise<void> {
    this.planChanges.push({ plan: input.plan, idempotencyKey: input.idempotencyKey });
  }
  async syncSubscription(): Promise<BillingProviderSubscriptionSnapshot | null> {
    this.syncStartedResolve();
    await this.releaseSync;
    return this.syncSnapshot;
  }
}

async function insertSubscription(cancelAtPeriodEnd: boolean): Promise<void> {
  const now = new Date();
  await context.db.insert(subscriptions).values({
    id: newId(), agencyId, plan: "professional", state: "trialing",
    trialEndsAt: new Date(now.getTime() + 30 * 86_400_000), currentPeriodEndsAt: new Date(now.getTime() + 30 * 86_400_000),
    cancelAtPeriodEnd, providerCustomerRef: "customer_test", providerSubscriptionRef: "subscription_test",
    paymentMethodDisplay: "Tarjeta terminada en 4242", createdAt: now, updatedAt: now,
  });
}
