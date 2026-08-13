import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  agencyMemberships,
  applications,
  appointments,
  emailOutbox,
  properties,
  subscriptions,
  users,
} from "../../db/schema.js";
import { newId } from "../../lib/ids.js";
import { createTestApp } from "../../test/test-app.js";
import { OutboxEmailProvider, emailTemplateNames, validateEmailMessage, type EmailMessage } from "./provider.js";
import { enqueueScheduledNotifications } from "./scheduler.js";
import { renderEmail } from "./templates.js";
import { dispatchEmailBatch, safeOperationalErrorCode, type EmailDelivery, type EmailTransport } from "./worker.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const fixedNow = new Date("2026-08-08T10:00:00.000Z");

beforeEach(async () => { context = await createTestApp({}, () => fixedNow); });
afterEach(async () => context.close());

class RecordingTransport implements EmailTransport {
  deliveries: EmailDelivery[] = [];
  constructor(private failures = 0) {}
  async deliver(delivery: EmailDelivery): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw Object.assign(new Error("provider detail that must not be persisted"), { code: "TEMPORARY_PROVIDER_ERROR" });
    }
    this.deliveries.push(delivery);
  }
}

class AcceptThenCrashTransport implements EmailTransport {
  readonly acceptedKeys: string[] = [];
  private crashes = 1;
  async deliver(delivery: EmailDelivery): Promise<void> {
    this.acceptedKeys.push(delivery.idempotencyKey);
    if (this.crashes > 0) { this.crashes -= 1; throw new Error("worker crashed after provider acceptance"); }
  }
}

const variables: Record<(typeof emailTemplateNames)[number], Record<string, string>> = {
  new_applicant: { propertyTitle: "Piso de Lucía" },
  viewing_reminder: { startsAt: "2026-08-09T10:00:00.000Z", propertyTitle: "Piso de Lucía" },
  trial_ending: { trialEndsAt: "2026-08-11T10:00:00.000Z", plan: "inmobiliaria" },
  payment_failure: { billingPath: "/app/facturacion" },
  team_invitation: { token: "token-super-seguro-de-invitacion", agencyName: "Agencia Centro" },
  verify_email: { token: "token-super-seguro-de-verificacion", returnPath: "/solicitud/abc" },
  reset_password: { token: "token-super-seguro-de-recuperacion", returnPath: "/solicitud/abc" },
  guest_application_otp: { code: "012345", propertyTitle: "Piso de Lucía" },
  application_received: { propertyTitle: "Piso de Lucía", agencyName: "Agencia Centro" },
  viewing_created: { startsAt: "2026-08-09T10:00:00.000Z" },
  viewing_rescheduled: { startsAt: "2026-08-10T10:00:00.000Z" },
  viewing_cancelled: { startsAt: "2026-08-09T10:00:00.000Z" },
};

describe("email templates", () => {
  it("renders every essential Spanish template without sensitive subject or preview data", () => {
    for (const template of emailTemplateNames) {
      const rendered = renderEmail({ recipient: "persona@example.es", template, variables: variables[template]! }, "https://inquilink.example");
      expect(rendered.subject.length, template).toBeGreaterThan(5);
      expect(rendered.preview.length, template).toBeGreaterThan(5);
      expect(`${rendered.subject} ${rendered.preview}`, template).not.toMatch(/Lucía|2500|\.pdf|persona@example\.es/i);
    }
  });

  it("rejects unknown variables before they can enter the outbox", () => {
    expect(() => validateEmailMessage({
      recipient: "persona@example.es", template: "application_received",
      variables: { propertyTitle: "Piso", agencyName: "Agencia", income: "2500" },
    })).toThrow();
  });
});

describe("durable email delivery", () => {
  it("claims, retries with a safe error code, then marks a message as sent", async () => {
    const provider = new OutboxEmailProvider(context.db, () => fixedNow);
    await provider.send({ recipient: "persona@example.es", template: "application_received", variables: variables.application_received });
    const transport = new RecordingTransport(1);
    const first = await dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => fixedNow });
    expect(first).toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0 });
    let rows = await context.db.select().from(emailOutbox);
    expect(rows[0]).toMatchObject({ state: "pending", attempts: 1, lastErrorCode: "TEMPORARY_PROVIDER_ERROR" });
    expect(JSON.stringify(rows[0])).not.toContain("provider detail");

    const retryAt = new Date(fixedNow.getTime() + 31_000);
    const second = await dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => retryAt });
    expect(second).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    rows = await context.db.select().from(emailOutbox);
    expect(rows[0]).toMatchObject({ state: "sent", attempts: 2, lastErrorCode: null });
    expect(rows[0]).toMatchObject({ recipient: "eliminado@inquilink.invalid", variables: {} });
    expect(rows[0]?.sentAt).toEqual(retryAt);
    expect(transport.deliveries).toHaveLength(1);
  });

  it("delivers a row only once when two workers race and deduplicates enqueue requests", async () => {
    const provider = new OutboxEmailProvider(context.db, () => fixedNow);
    const message: EmailMessage = {
      recipient: "persona@example.es", template: "viewing_created", variables: variables.viewing_created,
      dedupeKey: "viewing-created:appointment-1:2026-08-09T10:00:00.000Z",
    };
    await Promise.all([provider.send(message), provider.send(message)]);
    expect(await context.db.select().from(emailOutbox)).toHaveLength(1);
    const transport = new RecordingTransport();
    const results = await Promise.all([
      dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => fixedNow }),
      dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => fixedNow }),
    ]);
    expect(results.reduce((sum, item) => sum + item.sent, 0)).toBe(1);
    expect(transport.deliveries).toHaveLength(1);
  });

  it("reuses one provider idempotency key after acceptance followed by a local crash", async () => {
    const provider = new OutboxEmailProvider(context.db, () => fixedNow);
    await provider.send({ recipient: "persona@example.es", template: "application_received", variables: variables.application_received });
    const transport = new AcceptThenCrashTransport();
    await dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => fixedNow });
    await dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => new Date(fixedNow.getTime() + 31_000) });
    expect(transport.acceptedKeys).toHaveLength(2);
    expect(new Set(transport.acceptedKeys).size).toBe(1);
    expect(transport.acceptedKeys[0]).toMatch(/^email-outbox:/);
    expect((await context.db.select().from(emailOutbox))[0]?.state).toBe("sent");
  });

  it("marks repeated failures terminal without leaking provider messages", async () => {
    const provider = new OutboxEmailProvider(context.db, () => fixedNow);
    await provider.send({ recipient: "persona@example.es", template: "payment_failure", variables: variables.payment_failure });
    const transport = new RecordingTransport(10);
    let clock = fixedNow;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await dispatchEmailBatch(context.db, transport, "https://inquilink.example", { maxAttempts: 3, now: () => clock });
      clock = new Date(clock.getTime() + 2 * 60 * 60_000);
    }
    const rows = await context.db.select().from(emailOutbox);
    expect(rows[0]).toMatchObject({ state: "failed", attempts: 3, lastErrorCode: "TEMPORARY_PROVIDER_ERROR" });
    expect(rows[0]).toMatchObject({ recipient: "eliminado@inquilink.invalid", variables: {} });
    expect(JSON.stringify(rows[0])).not.toContain("provider detail");
  });

  it("expires undelivered links and scrubs the recipient and token variables", async () => {
    const provider = new OutboxEmailProvider(context.db, () => fixedNow);
    const rawToken = "token-super-seguro-que-no-debe-quedar";
    await provider.send({
      recipient: "secreto@example.es",
      template: "reset_password",
      variables: { token: rawToken, returnPath: "/solicitud/abc" },
      expiresAt: new Date(fixedNow.getTime() + 60_000),
    });
    const transport = new RecordingTransport();
    const result = await dispatchEmailBatch(context.db, transport, "https://inquilink.example", {
      now: () => new Date(fixedNow.getTime() + 60_001),
    });
    expect(result).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 });
    expect(transport.deliveries).toHaveLength(0);
    const row = (await context.db.select().from(emailOutbox))[0]!;
    expect(row).toMatchObject({
      state: "expired",
      recipient: "eliminado@inquilink.invalid",
      variables: {},
      lastErrorCode: "EMAIL_EXPIRED",
    });
    expect(JSON.stringify(row)).not.toContain(rawToken);
    expect(JSON.stringify(row)).not.toContain("secreto@example.es");
  });

  it("persists only a stable operational error code", () => {
    const sensitive = Object.assign(new Error("select * from users where email = persona@example.es"), {
      code: "token-de-recuperacion persona@example.es",
    });
    expect(safeOperationalErrorCode(sensitive)).toBe("EMAIL_DELIVERY_FAILED");
    expect(safeOperationalErrorCode(Object.assign(new Error("ignored"), { code: "ETIMEDOUT" }))).toBe("ETIMEDOUT");
  });
});

describe("scheduled essential notifications", () => {
  it("enqueues viewing, trial-ending, and payment-failure emails idempotently", async () => {
    const passwordHash = await argon2.hash("test-password");
    const agencyIds = ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"];
    const adminIds = [
      "40000000-0000-4000-8000-000000000011", "40000000-0000-4000-8000-000000000012",
      "40000000-0000-4000-8000-000000000013", "40000000-0000-4000-8000-000000000014",
    ];
    const tenantId = "40000000-0000-4000-8000-000000000021";
    await context.db.insert(users).values([
      { id: adminIds[0]!, kind: "agency", email: "trial@example.es", fullName: "Admin Trial", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
      { id: adminIds[1]!, kind: "agency", email: "pago@example.es", fullName: "Admin Pago", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
      { id: adminIds[2]!, kind: "agency", email: "trial-dos@example.es", fullName: "Admin Trial Dos", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
      { id: adminIds[3]!, kind: "agency", email: "pago-dos@example.es", fullName: "Admin Pago Dos", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
      { id: tenantId, kind: "tenant", email: "tenant@example.es", fullName: "Tenant", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
    ]);
    await context.db.insert(agencies).values(agencyIds.map((id, index) => ({ id, name: `Agencia ${index}`, createdAt: fixedNow, updatedAt: fixedNow })));
    await context.db.insert(agencyMemberships).values([
      { agencyId: agencyIds[0]!, userId: adminIds[0]!, role: "admin", createdAt: fixedNow },
      { agencyId: agencyIds[1]!, userId: adminIds[1]!, role: "admin", createdAt: fixedNow },
      { agencyId: agencyIds[0]!, userId: adminIds[2]!, role: "admin", createdAt: fixedNow },
      { agencyId: agencyIds[1]!, userId: adminIds[3]!, role: "admin", createdAt: fixedNow },
    ]);
    await context.db.insert(subscriptions).values([
      { id: "40000000-0000-4000-8000-000000000031", agencyId: agencyIds[0]!, plan: "inmobiliaria", state: "trialing", trialEndsAt: new Date(fixedNow.getTime() + 2 * 86_400_000), currentPeriodEndsAt: new Date(fixedNow.getTime() + 2 * 86_400_000), createdAt: fixedNow, updatedAt: fixedNow },
      { id: "40000000-0000-4000-8000-000000000032", agencyId: agencyIds[1]!, plan: "professional", state: "past_due", currentPeriodEndsAt: new Date(fixedNow.getTime() + 20 * 86_400_000), createdAt: fixedNow, updatedAt: fixedNow },
    ]);
    const propertyId = "40000000-0000-4000-8000-000000000041";
    const applicationId = "40000000-0000-4000-8000-000000000042";
    await context.db.insert(properties).values({ id: propertyId, agencyId: agencyIds[0]!, internalReference: "MAIL-1", title: "Piso Centro", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, state: "published", createdAt: fixedNow, updatedAt: fixedNow });
    await context.db.insert(applications).values({ id: applicationId, agencyId: agencyIds[0]!, propertyId, tenantUserId: tenantId, status: "new", submittedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow });
    await context.db.insert(appointments).values({ id: newId(), agencyId: agencyIds[0]!, propertyId, applicationId, responsibleUserId: adminIds[0]!, startsAt: new Date(fixedNow.getTime() + 6 * 60 * 60_000), durationMinutes: 30, state: "scheduled", createdAt: fixedNow, updatedAt: fixedNow });

    const provider = new OutboxEmailProvider(context.db, () => fixedNow);
    const first = await enqueueScheduledNotifications(context.db, provider, fixedNow);
    const second = await enqueueScheduledNotifications(context.db, provider, fixedNow);
    expect(first).toEqual({ viewingReminders: 1, trialEnding: 2, paymentFailures: 2, failed: 0 });
    expect(second).toEqual(first);
    const rows = await context.db.select().from(emailOutbox);
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.template).sort()).toEqual(["payment_failure", "payment_failure", "trial_ending", "trial_ending", "viewing_reminder"]);
    expect(rows.filter((row) => row.template === "trial_ending").map((row) => row.recipient).sort()).toEqual(["trial-dos@example.es", "trial@example.es"]);
    expect(rows.filter((row) => row.template === "payment_failure").map((row) => row.recipient).sort()).toEqual(["pago-dos@example.es", "pago@example.es"]);
    expect(rows.every((row) => row.state === "pending" && row.dedupeKey !== null)).toBe(true);
    expect(rows.find((row) => row.template === "viewing_reminder")?.expiresAt).toEqual(new Date(fixedNow.getTime() + 6 * 60 * 60_000));
    expect(rows.filter((row) => row.template === "trial_ending").every((row) => row.expiresAt.getTime() === fixedNow.getTime() + 2 * 86_400_000)).toBe(true);
    expect(rows.filter((row) => row.template === "payment_failure").every((row) => row.expiresAt.getTime() === fixedNow.getTime() + 24 * 60 * 60_000)).toBe(true);

    const laterRecipients: string[] = [];
    const isolatedProvider: EmailProvider = {
      send: async (message) => {
        if (message.recipient === "trial@example.es") throw new Error("legacy poison row");
        laterRecipients.push(message.recipient);
      },
    };
    const isolated = await enqueueScheduledNotifications(context.db, isolatedProvider, fixedNow);
    expect(isolated).toEqual({ viewingReminders: 0, trialEnding: 1, paymentFailures: 2, failed: 2 });
    expect(laterRecipients).toContain("trial-dos@example.es");

    await context.db.update(agencies).set({ accountState: "closure_requested", closureRequestedAt: fixedNow, updatedAt: fixedNow }).where(eq(agencies.id, agencyIds[0]!));
    await context.db.update(users).set({ accountState: "closure_requested", closureRequestedAt: fixedNow, updatedAt: fixedNow }).where(eq(users.id, adminIds[1]!));
    const afterClosure = await enqueueScheduledNotifications(context.db, provider, fixedNow);
    expect(afterClosure).toEqual({ viewingReminders: 0, trialEnding: 0, paymentFailures: 1, failed: 0 });
    await context.db.update(appointments).set({ state: "cancelled", updatedAt: fixedNow });
    await context.db.update(subscriptions).set({ state: "active", updatedAt: fixedNow });
    const transport = new RecordingTransport();
    await dispatchEmailBatch(context.db, transport, "https://inquilink.example", { now: () => fixedNow });
    expect(transport.deliveries).toHaveLength(0);
    const expiredScheduled = await context.db.select().from(emailOutbox);
    expect(expiredScheduled.every((row) => row.state === "expired" && row.recipient === "eliminado@inquilink.invalid")).toBe(true);
  });
});
