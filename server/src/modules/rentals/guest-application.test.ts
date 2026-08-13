import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  agencyMemberships,
  applications,
  authRateLimits,
  guestApplicationOtps,
  properties,
  sessions,
  users,
} from "../../db/schema.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { cookieFrom, createTestApp } from "../../test/test-app.js";
import { MemoryPrivateDocumentStorage } from "./storage.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
let clock: Date;

const ids = {
  agency: "81000000-0000-4000-8000-000000000001",
  admin: "81000000-0000-4000-8000-000000000002",
  property: "81000000-0000-4000-8000-000000000003",
};
const publicToken = "guest-application-public-link";
const adminCookie = "inquilink_session=guest-flow-admin";

const applicationFor = (email: string, phone = "+34612144309") => ({
  fullName: "Lucía Martín",
  email,
  phone,
  preferredContactChannel: "email",
  adultOccupants: 1,
  additionalAdults: [],
  minorOccupants: 0,
  intendedMoveInDate: "2026-10-01",
  pets: "no",
  petDetails: null,
  message: "Me interesa la vivienda.",
  employmentStatus: "Trabajo por cuenta ajena",
  employerOrActivity: "Cobalto Studio",
  contractType: "Indefinido",
  individualNetMonthlyIncomeCents: 250_000,
  householdNetMonthlyIncomeCents: 250_000,
  guarantorAvailability: "no",
  viewingAvailability: ["Entre semana por la tarde"],
  availabilityNote: null,
  marketingConsent: false,
});

function advance(milliseconds: number): void {
  clock = new Date(clock.getTime() + milliseconds);
}

async function requestOtp(email: string, payload: Record<string, unknown> = {}) {
  return context.app.inject({
    method: "POST",
    url: `/api/v1/public/applications/by-link/${publicToken}/request-otp`,
    payload: { email, formElapsedMs: 2_500, ...payload },
  });
}

async function submitGuest(email: string, otp: string, options: { phone?: string; submissionKey?: string; website?: string } = {}) {
  return context.app.inject({
    method: "POST",
    url: `/api/v1/public/applications/by-link/${publicToken}/submit`,
    payload: {
      email,
      otp,
      application: applicationFor(email, options.phone),
      consentVersion: "privacy-2026-08-v1",
      privacyConsent: true,
      submissionKey: options.submissionKey ?? `guest-submit-${email}-0001`,
      ...(options.website === undefined ? {} : { website: options.website }),
    },
  });
}

async function freshOtp(email: string): Promise<string> {
  const response = await requestOtp(email);
  expect(response.statusCode).toBe(200);
  const otp = response.json().data.debugOtp as string;
  expect(otp).toMatch(/^\d{6}$/);
  advance(2_001);
  return otp;
}

beforeEach(async () => {
  clock = new Date("2026-08-12T10:00:00.000Z");
  context = await createTestApp({}, () => clock, { rentals: { storage: new MemoryPrivateDocumentStorage() } });
  const passwordHash = await argon2.hash("admin-password");
  await context.db.insert(users).values({
    id: ids.admin,
    kind: "agency",
    email: "admin@example.es",
    fullName: "Administradora",
    passwordHash,
    emailVerifiedAt: clock,
    createdAt: clock,
    updatedAt: clock,
  });
  await context.db.insert(agencies).values({ id: ids.agency, name: "Agencia Centro", createdAt: clock, updatedAt: clock });
  await context.db.insert(agencyMemberships).values({ agencyId: ids.agency, userId: ids.admin, role: "admin", createdAt: clock });
  await context.db.insert(properties).values({
    id: ids.property,
    agencyId: ids.agency,
    internalReference: "GUEST-1",
    title: "Piso para solicitud invitada",
    city: "Madrid",
    province: "Madrid",
    monthlyRentCents: 125_000,
    state: "published",
    publicLinkTokenHash: hashSecret(publicToken),
    createdAt: clock,
    updatedAt: clock,
  });
  await context.db.insert(sessions).values({
    id: newId(), userId: ids.admin, tokenHash: hashSecret("guest-flow-admin"),
    expiresAt: new Date("2099-01-01T00:00:00.000Z"), lastSeenAt: clock, createdAt: clock,
  });
});

afterEach(async () => context.close());

describe("guest application flow", () => {
  it("requires an OTP and applies silent/request and rejecting/submit bot defenses", async () => {
    const withoutOtp = await context.app.inject({
      method: "POST",
      url: `/api/v1/public/applications/by-link/${publicToken}/submit`,
      payload: { email: "guest@example.es", application: applicationFor("guest@example.es") },
    });
    expect(withoutOtp.statusCode).toBe(400);

    const honeypot = await requestOtp("bot@example.es", { website: "https://spam.invalid" });
    expect(honeypot.statusCode).toBe(200);
    expect(honeypot.json().data).not.toHaveProperty("debugOtp");
    expect(context.emailProvider.messages).toHaveLength(0);

    const tooFastRequest = await requestOtp("fast-bot@example.es", { formElapsedMs: 1_999 });
    expect(tooFastRequest.statusCode).toBe(200);
    expect(tooFastRequest.json().data).toEqual(honeypot.json().data);

    const otp = (await requestOtp("guest@example.es")).json().data.debugOtp as string;
    const tooFastSubmit = await submitGuest("guest@example.es", otp);
    expect(tooFastSubmit.statusCode).toBe(400);
    expect(tooFastSubmit.json().error.code).toBe("INVALID_SUBMISSION");
    advance(2_001);
    const filled = await submitGuest("guest@example.es", otp, { website: "spam" });
    expect(filled.statusCode).toBe(400);
    expect(filled.json().error.code).toBe("INVALID_SUBMISSION");
    expect(await context.db.select().from(applications)).toHaveLength(0);
  });

  it("provisions a passwordless tenant, submits, establishes a session, and upgrades the account once", async () => {
    const email = "new-guest@example.es";
    const otp = await freshOtp(email);
    const response = await submitGuest(email, otp);
    expect(response.statusCode).toBe(201);
    expect(response.headers["set-cookie"]).toContain("inquilink_session=");
    expect(response.json().data).toMatchObject({ accountUpgradeAvailable: true, documentsRequired: false, idempotentReplay: false });
    expect(response.json().data.application).not.toHaveProperty("duplicatePhoneFlaggedAt");
    const tenant = (await context.db.select().from(users).where(and(eq(users.email, email), eq(users.kind, "tenant"))))[0]!;
    expect(tenant.passwordHash).toBeNull();
    expect(tenant.emailVerifiedAt).toEqual(clock);
    expect((await context.db.select().from(applications))[0]).toMatchObject({ tenantUserId: tenant.id, submittedAt: clock });

    const cookie = cookieFrom(response);
    const upgraded = await context.app.inject({
      method: "POST", url: "/api/v1/tenant/account/set-password", headers: { cookie },
      payload: { password: "new-guest-password", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    expect(upgraded.statusCode).toBe(200);
    const upgradedUser = (await context.db.select().from(users).where(eq(users.id, tenant.id)))[0]!;
    expect(await argon2.verify(upgradedUser.passwordHash!, "new-guest-password")).toBe(true);
    expect(upgradedUser.termsAcceptedAt).toEqual(clock);
    const repeated = await context.app.inject({
      method: "POST", url: "/api/v1/tenant/account/set-password", headers: { cookie },
      payload: { password: "another-password", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    expect(repeated.statusCode).toBe(409);
    expect(repeated.json().error.code).toBe("PASSWORD_ALREADY_SET");
  });

  it("decrements wrong-code attempts and invalidates the OTP after five failures", async () => {
    const email = "wrong-code@example.es";
    const otp = await freshOtp(email);
    const wrongOtp = otp === "999999" ? "000000" : "999999";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await submitGuest(email, wrongOtp);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({ code: "OTP_INVALID", details: { attemptsRemaining: 5 - attempt } });
    }
    const record = (await context.db.select().from(guestApplicationOtps))[0]!;
    expect(record).toMatchObject({ attempts: 5, usedAt: clock });
    const correctAfterLockout = await submitGuest(email, otp);
    expect(correctAfterLockout.statusCode).toBe(400);
    expect(correctAfterLockout.json().error.code).toBe("OTP_INVALID");
  });

  it("rejects expired OTPs and consumes a successful OTP exactly once", async () => {
    const expiredEmail = "expired@example.es";
    const expiredOtp = (await requestOtp(expiredEmail)).json().data.debugOtp as string;
    advance(10 * 60_000 + 1);
    const expired = await submitGuest(expiredEmail, expiredOtp);
    expect(expired.statusCode).toBe(400);
    expect(expired.json().error.code).toBe("OTP_INVALID");

    const email = "single-use@example.es";
    const otp = await freshOtp(email);
    const first = await submitGuest(email, otp);
    expect(first.statusCode).toBe(201);
    const second = await submitGuest(email, otp);
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe("OTP_INVALID");
  });

  it("rate-limits the sixth hourly OTP request per email while keeping successful replies generic", async () => {
    const email = "rate-limited@example.es";
    const messages: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await requestOtp(email);
      expect(response.statusCode).toBe(200);
      messages.push(response.json().data.message);
    }
    expect(new Set(messages).size).toBe(1);
    const sixth = await requestOtp(email);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json().error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("enforces the daily per-IP guest application cap", async () => {
    const email = "daily-cap@example.es";
    const otp = await freshOtp(email);
    const windowMs = 24 * 60 * 60_000;
    const windowStartedAt = new Date(Math.floor(clock.getTime() / windowMs) * windowMs);
    await context.db.insert(authRateLimits).values({
      keyHash: hashSecret("auth-rate:guest_application:ip:127.0.0.1"),
      scope: "guest_application:ip",
      windowStartedAt,
      count: 20,
      updatedAt: clock,
    });
    const response = await submitGuest(email, otp);
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe("AUTH_RATE_LIMITED");
    expect(await context.db.select().from(applications)).toHaveLength(0);
  });

  it("returns an idempotent replay for the same verified email and submission key", async () => {
    const email = "replay@example.es";
    const submissionKey = "guest-idempotent-replay-0001";
    const first = await submitGuest(email, await freshOtp(email), { submissionKey });
    expect(first.statusCode).toBe(201);
    const second = await submitGuest(email, await freshOtp(email), { submissionKey });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.idempotentReplay).toBe(true);
    expect(second.json().data.application.id).toBe(first.json().data.application.id);
    expect(await context.db.select().from(applications)).toHaveLength(1);
  });

  it("soft-flags a duplicate phone only for agency-visible application payloads", async () => {
    const phone = "+34699888777";
    expect((await submitGuest("first@example.es", await freshOtp("first@example.es"), { phone })).statusCode).toBe(201);
    const second = await submitGuest("second@example.es", await freshOtp("second@example.es"), { phone });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.application).not.toHaveProperty("duplicatePhoneFlaggedAt");
    const stored = await context.db.select().from(applications).orderBy(applications.createdAt);
    expect(stored[0]!.duplicatePhoneFlaggedAt).toBeNull();
    expect(stored[1]!.duplicatePhoneFlaggedAt).toEqual(clock);

    const agencyList = await context.app.inject({
      method: "GET", url: `/api/v1/agency/properties/${ids.property}/applications`, headers: { cookie: adminCookie },
    });
    expect(agencyList.statusCode).toBe(200);
    const flagged = agencyList.json().data.applications.find((item: { application: { id: string } }) => item.application.id === stored[1]!.id);
    expect(flagged.application.duplicatePhoneFlaggedAt).toBe(clock.toISOString());
  });

  it("creates an authenticated draft for requested documents and completes through the tenant route", async () => {
    await context.db.update(properties).set({ requestedDocumentCategories: ["payslips"], updatedAt: clock }).where(eq(properties.id, ids.property));
    const email = "documents@example.es";
    const submissionKey = "guest-documents-submit-0001";
    const guest = await submitGuest(email, await freshOtp(email), { submissionKey });
    expect(guest.statusCode).toBe(200);
    expect(guest.headers["set-cookie"]).toContain("inquilink_session=");
    expect(guest.json().data).toMatchObject({ documentsRequired: true, accountUpgradeAvailable: true, idempotentReplay: false });
    expect(guest.json().data.missingCategories).toEqual(["payslips"]);
    const applicationId = guest.json().data.applicationId as string;
    expect((await context.db.select().from(applications).where(eq(applications.id, applicationId)))[0]!.submittedAt).toBeNull();

    const cookie = cookieFrom(guest);
    const upload = await context.app.inject({
      method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie },
      payload: { category: "payslips", originalName: "nomina.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-guest").toString("base64") },
    });
    expect(upload.statusCode).toBe(201);
    const completed = await context.app.inject({
      method: "POST", url: `/api/v1/tenant/applications/by-link/${publicToken}/submit`, headers: { cookie },
      payload: { application: applicationFor(email), consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().data.application).toMatchObject({ id: applicationId, documentState: "complete" });
  });

  it("reuses an existing password tenant without replacing their password", async () => {
    const email = "existing@example.es";
    const passwordHash = await argon2.hash("existing-password");
    await context.db.insert(users).values({
      id: "81000000-0000-4000-8000-000000000010", kind: "tenant", email, fullName: "Nombre anterior",
      passwordHash, emailVerifiedAt: null, createdAt: clock, updatedAt: clock,
    });
    const response = await submitGuest(email, await freshOtp(email));
    expect(response.statusCode).toBe(201);
    expect(response.json().data.accountUpgradeAvailable).toBe(false);
    const tenant = (await context.db.select().from(users).where(and(eq(users.email, email), eq(users.kind, "tenant"))))[0]!;
    expect(tenant.passwordHash).toBe(passwordHash);
    expect(tenant.emailVerifiedAt).toEqual(clock);
    expect(tenant.fullName).toBe("Nombre anterior");
  });
});
