import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  agencies,
  agencyClosureCleanup,
  agencyInvitations,
  analyticsEvents,
  billingOperations,
  emailOutbox,
  invoices,
  subscriptions,
  users,
} from "./schema.js";
import { createTestApp } from "../test/test-app.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const now = new Date("2026-08-08T10:00:00.000Z");
const agencyId = "94000000-0000-4000-8000-000000000001";
const userId = "94000000-0000-4000-8000-000000000002";

beforeEach(async () => {
  context = await createTestApp();
  await context.db.insert(users).values({
    id: userId, kind: "agency", email: "invariants@example.es", fullName: "Invariantes",
    passwordHash: "test-only", emailVerifiedAt: now, createdAt: now, updatedAt: now,
  });
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia Invariantes", createdAt: now, updatedAt: now });
});
afterEach(async () => context.close());

it("rejects impossible invitation and billing operation states at the database boundary", async () => {
  await expect(context.db.insert(agencyInvitations).values({
    id: "94000000-0000-4000-8000-000000000011",
    agencyId,
    email: "invite@example.es",
    tokenHash: "a".repeat(64),
    invitedByUserId: userId,
    expiresAt: now,
    createdAt: now,
    updatedAt: now,
  })).rejects.toBeTruthy();

  await expect(context.db.insert(billingOperations).values({
    id: "94000000-0000-4000-8000-000000000012",
    agencyId,
    operation: "charge_arbitrary_amount",
    idempotencyKeyHash: "b".repeat(64),
    requestFingerprint: "c".repeat(64),
    state: "completed",
    response: null,
    createdAt: now,
    updatedAt: now,
  })).rejects.toBeTruthy();

  await expect(context.db.insert(agencyClosureCleanup).values({
    id: "94000000-0000-4000-8000-000000000013",
    agencyId,
    providerSubscriptionRef: "must-be-scrubbed-before-purge",
    state: "ready_for_purge",
    attempts: -1,
    createdAt: now,
    updatedAt: now,
  })).rejects.toBeTruthy();
});

it("rejects unsafe outbox terminal rows and arbitrary analytics dimensions", async () => {
  await expect(context.db.insert(emailOutbox).values({
    id: "94000000-0000-4000-8000-000000000021",
    userId,
    agencyId,
    recipient: "retained@example.es",
    template: "reset_password",
    variables: { token: "retained-secret" },
    state: "sent",
    sentAt: now,
    availableAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
  })).rejects.toBeTruthy();

  await expect(context.db.insert(emailOutbox).values({
    id: "94000000-0000-4000-8000-000000000022",
    recipient: "persona@example.es",
    template: "arbitrary_template",
    variables: {},
    state: "pending",
    attempts: -1,
    availableAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
  })).rejects.toBeTruthy();

  await expect(context.db.insert(analyticsEvents).values({
    id: "94000000-0000-4000-8000-000000000023",
    eventName: "free_text_with_pii",
    placement: "persona@example.es",
    occurredAt: now,
  })).rejects.toBeTruthy();
});

it("rejects cross-agency billing graph references", async () => {
  const otherAgencyId = "94000000-0000-4000-8000-000000000031";
  const otherSubscriptionId = "94000000-0000-4000-8000-000000000032";
  const operationId = "94000000-0000-4000-8000-000000000033";
  await context.db.insert(agencies).values({ id: otherAgencyId, name: "Otra agencia", createdAt: now, updatedAt: now });
  await context.db.insert(subscriptions).values({
    id: otherSubscriptionId, agencyId: otherAgencyId, plan: "professional", state: "active",
    currentPeriodEndsAt: new Date(now.getTime() + 86_400_000), createdAt: now, updatedAt: now,
  });
  await context.db.insert(billingOperations).values({
    id: operationId, agencyId, operation: "cancel", idempotencyKeyHash: "d".repeat(64), requestFingerprint: "e".repeat(64),
    state: "pending", createdAt: now, updatedAt: now,
  });

  await expect(context.db.update(subscriptions).set({ pendingBillingOperationId: operationId })
    .where(eq(subscriptions.id, otherSubscriptionId))).rejects.toBeTruthy();
  await expect(context.db.insert(invoices).values({
    id: "94000000-0000-4000-8000-000000000034",
    agencyId,
    subscriptionId: otherSubscriptionId,
    providerInvoiceRef: "cross-agency-invoice",
    amountCents: 4_999,
    currency: "EUR",
    status: "paid",
    issuedAt: now,
  })).rejects.toBeTruthy();
});
