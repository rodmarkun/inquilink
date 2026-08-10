import argon2 from "argon2";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agencies,
  agencyInvitations,
  agencyMemberships,
  applications,
  appointments,
  emailOutbox,
  properties,
  sessions,
  subscriptions,
  users,
} from "../../db/schema.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { createTestApp } from "../../test/test-app.js";
import { enqueueEmail } from "../email/provider.js";
import { dispatchEmailBatch } from "../email/worker.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const agencyA = "30000000-0000-4000-8000-000000000001";
const agencyB = "30000000-0000-4000-8000-000000000002";
const adminA = "30000000-0000-4000-8000-000000000011";
const collaboratorA = "30000000-0000-4000-8000-000000000012";
const adminB = "30000000-0000-4000-8000-000000000013";
const tenantA = "30000000-0000-4000-8000-000000000021";
const tenantB = "30000000-0000-4000-8000-000000000022";
const propertyA = "30000000-0000-4000-8000-000000000031";
const propertyB = "30000000-0000-4000-8000-000000000032";
const applicationA = "30000000-0000-4000-8000-000000000041";
const applicationB = "30000000-0000-4000-8000-000000000042";
const fixedNow = new Date("2026-08-08T10:00:00.000Z");

const cookie = (token: string) => ({ cookie: `inquilink_session=${token}` });

beforeEach(async () => {
  context = await createTestApp({}, () => fixedNow);
  const passwordHash = await argon2.hash("test-password");
  await context.db.insert(users).values([
    { id: adminA, kind: "agency", email: "admin-a@example.es", fullName: "Admin A", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
    { id: collaboratorA, kind: "agency", email: "colaborador-a@example.es", fullName: "Colaborador A", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
    { id: adminB, kind: "agency", email: "admin-b@example.es", fullName: "Admin B", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
    { id: tenantA, kind: "tenant", email: "tenant-a@example.es", fullName: "Inquilino A", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
    { id: tenantB, kind: "tenant", email: "tenant-b@example.es", fullName: "Inquilino B", passwordHash, emailVerifiedAt: fixedNow, createdAt: fixedNow, updatedAt: fixedNow },
  ]);
  await context.db.insert(agencies).values([
    { id: agencyA, name: "Agencia A", contactEmail: "hola-a@example.es", createdAt: fixedNow, updatedAt: fixedNow },
    { id: agencyB, name: "Agencia B", contactEmail: "hola-b@example.es", createdAt: fixedNow, updatedAt: fixedNow },
  ]);
  await context.db.insert(agencyMemberships).values([
    { agencyId: agencyA, userId: adminA, role: "admin", createdAt: fixedNow },
    { agencyId: agencyA, userId: collaboratorA, role: "collaborator", createdAt: fixedNow },
    { agencyId: agencyB, userId: adminB, role: "admin", createdAt: fixedNow },
  ]);
  await context.db.insert(sessions).values([
    { id: newId(), userId: adminA, tokenHash: hashSecret("admin-a-token"), createdAt: fixedNow, lastSeenAt: fixedNow, expiresAt: new Date("2027-01-01T00:00:00.000Z") },
    { id: newId(), userId: collaboratorA, tokenHash: hashSecret("collaborator-a-token"), createdAt: fixedNow, lastSeenAt: fixedNow, expiresAt: new Date("2027-01-01T00:00:00.000Z") },
    { id: newId(), userId: adminB, tokenHash: hashSecret("admin-b-token"), createdAt: fixedNow, lastSeenAt: fixedNow, expiresAt: new Date("2027-01-01T00:00:00.000Z") },
    { id: newId(), userId: tenantA, tokenHash: hashSecret("tenant-a-token"), createdAt: fixedNow, lastSeenAt: fixedNow, expiresAt: new Date("2027-01-01T00:00:00.000Z") },
  ]);
  await context.db.insert(properties).values([
    { id: propertyA, agencyId: agencyA, internalReference: "A-1", title: "Piso A", city: "Madrid", province: "Madrid", monthlyRentCents: 120_000, state: "published", createdAt: fixedNow, updatedAt: fixedNow },
    { id: propertyB, agencyId: agencyB, internalReference: "B-1", title: "Piso B", city: "Madrid", province: "Madrid", monthlyRentCents: 130_000, state: "published", createdAt: fixedNow, updatedAt: fixedNow },
  ]);
  await context.db.insert(subscriptions).values([
    { id: "30000000-0000-4000-8000-000000000091", agencyId: agencyA, plan: "inmobiliaria", state: "active", createdAt: fixedNow, updatedAt: fixedNow },
    { id: "30000000-0000-4000-8000-000000000092", agencyId: agencyB, plan: "inmobiliaria", state: "active", createdAt: fixedNow, updatedAt: fixedNow },
  ]);
  await context.db.insert(applications).values([
    { id: applicationA, agencyId: agencyA, propertyId: propertyA, tenantUserId: tenantA, status: "new", submittedAt: new Date("2026-08-07T12:00:00.000Z"), createdAt: fixedNow, updatedAt: fixedNow },
    { id: applicationB, agencyId: agencyB, propertyId: propertyB, tenantUserId: tenantB, status: "new", submittedAt: new Date("2026-08-07T13:00:00.000Z"), createdAt: fixedNow, updatedAt: fixedNow },
  ]);
  await context.db.insert(appointments).values([
    { id: "30000000-0000-4000-8000-000000000051", agencyId: agencyA, propertyId: propertyA, applicationId: applicationA, responsibleUserId: adminA, startsAt: new Date("2026-08-10T16:00:00.000Z"), durationMinutes: 30, state: "scheduled", createdAt: fixedNow, updatedAt: fixedNow },
    { id: "30000000-0000-4000-8000-000000000052", agencyId: agencyB, propertyId: propertyB, applicationId: applicationB, responsibleUserId: adminB, startsAt: new Date("2026-08-10T17:00:00.000Z"), durationMinutes: 30, state: "scheduled", createdAt: fixedNow, updatedAt: fixedNow },
  ]);
});

afterEach(async () => context.close());

describe("agency operations", () => {
  it("paginates team members and pending invitations", async () => {
    await context.db.insert(agencyInvitations).values([
      { id: "30000000-0000-4000-8000-000000000081", agencyId: agencyA, email: "uno@example.es", tokenHash: hashSecret("pagination-invitation-one"), expiresAt: new Date("2026-08-20T10:00:00.000Z"), createdAt: new Date("2026-08-08T09:00:00.000Z"), updatedAt: fixedNow },
      { id: "30000000-0000-4000-8000-000000000082", agencyId: agencyA, email: "dos@example.es", tokenHash: hashSecret("pagination-invitation-two"), expiresAt: new Date("2026-08-20T10:00:00.000Z"), createdAt: new Date("2026-08-08T09:00:00.000Z"), updatedAt: fixedNow },
    ]);
    const members = await context.app.inject({ method: "GET", url: "/api/v1/agency/team?page=2&pageSize=1", headers: cookie("admin-a-token") });
    expect(members.statusCode).toBe(200);
    expect(members.json().data.members).toHaveLength(1);
    expect(members.json().data.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2, hasMore: false });
    const invitations = await context.app.inject({ method: "GET", url: "/api/v1/agency/team/invitations?page=1&pageSize=1", headers: cookie("admin-a-token") });
    expect(invitations.statusCode).toBe(200);
    expect(invitations.json().data.invitations).toHaveLength(1);
    expect(invitations.json().data.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2, hasMore: true });
  });

  it("returns the dashboard blocks and scopes every item to the agency", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/v1/agency/dashboard", headers: cookie("admin-a-token") });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.objectContaining({
      newApplicants: expect.objectContaining({ count: 1, periodDays: 30 }),
      upcomingViewings: expect.objectContaining({ items: [expect.objectContaining({ applicationId: applicationA, propertyId: propertyA })] }),
      topProperties: expect.objectContaining({ items: [expect.objectContaining({ propertyId: propertyA, applicantCount: 1 })] }),
    }));
    expect(Object.keys(response.json().data).sort()).toEqual(["newApplicants", "topProperties", "upcomingViewings"]);
    expect(JSON.stringify(response.json())).not.toContain(applicationB);
    expect(JSON.stringify(response.json())).not.toContain(propertyB);
  });

  it("returns a zero-filled daily applicant trend with per-property breakdowns", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/v1/agency/dashboard/applicant-trend?range=7d", headers: cookie("admin-a-token") });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ range: "7d", periodDays: 7 });
    expect(response.json().data.items).toHaveLength(7);
    expect(response.json().data.items.find((item: { date: string }) => item.date === "2026-08-07")).toMatchObject({
      total: 1,
      properties: [expect.objectContaining({ propertyId: propertyA, count: 1 })],
    });
    expect(JSON.stringify(response.json())).not.toContain(propertyB);
    expect(response.json().data.items.some((item: { total: number }) => item.total === 0)).toBe(true);
  });

  it("uses hashed, expiring, single-use invitations and prevents cross-agency membership changes", async () => {
    const denied = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("collaborator-a-token"), "idempotency-key": "invite-collaborator-0001" }, payload: { email: "nuevo@example.es" },
    });
    expect(denied.statusCode).toBe(403);

    const invited = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-admin-a-0000001" }, payload: { email: "NUEVO@example.es" },
    });
    expect(invited.statusCode).toBe(201);
    const token = invited.json().data.debugToken as string;
    const stored = await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.agencyId, agencyA));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.email).toBe("nuevo@example.es");
    expect(stored[0]?.tokenHash).toBe(hashSecret(token));
    expect(JSON.stringify(stored[0])).not.toContain(token);
    expect(stored[0]?.expiresAt.getTime()).toBe(fixedNow.getTime() + 7 * 86_400_000);
    const queued = await context.db.select().from(emailOutbox);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ recipient: "nuevo@example.es", template: "team_invitation", state: "pending" });

    const inviteReplay = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-admin-a-0000001" }, payload: { email: "nuevo@example.es" },
    });
    expect(inviteReplay.statusCode).toBe(201);
    expect(inviteReplay.headers["idempotency-replayed"]).toBe("true");
    expect(inviteReplay.json().data).not.toHaveProperty("debugToken");
    expect(await context.db.select().from(emailOutbox)).toHaveLength(1);
    expect((await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.agencyId, agencyA)))[0]?.tokenHash).toBe(hashSecret(token));

    const accepted = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Nueva Persona", password: "password-segura", termsAccepted: true },
    });
    expect(accepted.statusCode).toBe(200);
    const newUsers = await context.db.select().from(users).where(and(eq(users.email, "nuevo@example.es"), eq(users.kind, "agency")));
    expect(newUsers).toHaveLength(1);
    expect(newUsers[0]).toMatchObject({ termsVersion: "terms-2026-08-v1" });
    expect(newUsers[0]?.termsAcceptedAt).toBeInstanceOf(Date);
    const memberships = await context.db.select().from(agencyMemberships).where(eq(agencyMemberships.userId, newUsers[0]!.id));
    expect(memberships).toEqual([expect.objectContaining({ agencyId: agencyA, role: "collaborator" })]);
    expect((await context.db.select().from(emailOutbox))[0]).toMatchObject({
      state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: "INVITATION_ACCEPTED",
    });

    const replay = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Otra Persona", password: "password-segura", termsAccepted: true },
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe("INVITATION_INVALID");

    const foreignMutation = await context.app.inject({
      method: "PATCH", url: `/api/v1/agency/team/members/${adminB}`, headers: cookie("admin-a-token"), payload: { role: "collaborator" },
    });
    expect(foreignMutation.statusCode).toBe(404);
  });

  it("reserves Profesional seats across concurrent invitations and blocks Particular team creation", async () => {
    await context.db.update(subscriptions).set({ plan: "particular", updatedAt: fixedNow }).where(eq(subscriptions.agencyId, agencyA));
    const particular = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "particular-seat-block-1" },
      payload: { email: "sin-plaza@example.es" },
    });
    expect(particular.statusCode).toBe(409);
    expect(particular.json().error).toMatchObject({ code: "PLAN_ACCOUNT_LIMIT_REACHED" });

    await context.db.update(subscriptions).set({ plan: "professional", updatedAt: fixedNow }).where(eq(subscriptions.agencyId, agencyA));
    const results = await Promise.all([
      context.app.inject({ method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": "professional-seat-race-1" }, payload: { email: "plaza-uno@example.es" } }),
      context.app.inject({ method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": "professional-seat-race-2" }, payload: { email: "plaza-dos@example.es" } }),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((response) => response.statusCode === 409)?.json().error.code).toBe("PLAN_ACCOUNT_LIMIT_REACHED");
    const pending = await context.db.select().from(agencyInvitations).where(and(
      eq(agencyInvitations.agencyId, agencyA),
      isNull(agencyInvitations.acceptedAt),
    ));
    expect(pending).toHaveLength(1);
  });

  it("keeps a pending invitation unconsumed when a downgrade makes the workspace over limit", async () => {
    const invited = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-before-downgrade-1" },
      payload: { email: "persona-downgrade@example.es" },
    });
    expect(invited.statusCode).toBe(201);
    const token = invited.json().data.debugToken as string;
    await context.db.update(subscriptions).set({ plan: "particular", updatedAt: fixedNow }).where(eq(subscriptions.agencyId, agencyA));
    const accepted = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Persona Invitada", password: "contraseña-segura", termsAccepted: true },
    });
    expect(accepted.statusCode).toBe(409);
    expect(accepted.json().error.code).toBe("PLAN_ACCOUNT_LIMIT_REACHED");
    expect((await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.email, "persona-downgrade@example.es")))[0]?.acceptedAt).toBeNull();
  });

  it("requires current terms for a new invited account and rejects invalid tokens before Argon2", async () => {
    const invited = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-terms-required-0001" },
      payload: { email: "terminos@example.es" },
    });
    expect(invited.statusCode).toBe(201);
    const token = invited.json().data.debugToken as string;
    const missing = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Sin Términos", password: "password-segura" },
    });
    expect(missing.statusCode).toBe(400);
    const rejected = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Sin Términos", password: "password-segura", termsAccepted: false },
    });
    expect(rejected.statusCode).toBe(400);

    const hashSpy = vi.spyOn(argon2, "hash");
    const invalid = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token: "invalid-invitation-token-0001", fullName: "Ataque Costoso", password: "password-segura", termsAccepted: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVITATION_INVALID");
    expect(hashSpy).not.toHaveBeenCalled();
    hashSpy.mockRestore();

    const accepted = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Persona con Términos", password: "password-segura", termsAccepted: true },
    });
    expect(accepted.statusCode).toBe(200);
    const login = await context.app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "terminos@example.es", password: "password-segura", accountType: "agency" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data).toMatchObject({ user: { kind: "agency", email: "terminos@example.es" }, returnPath: "/app" });
    expect(login.headers["set-cookie"]).toContain("inquilink_session=");
  });

  it("rate-limits repeated invalid invitation acceptance attempts by client IP", async () => {
    const responses = [];
    for (let index = 0; index < 21; index += 1) {
      responses.push(await context.app.inject({
        method: "POST", url: "/api/v1/team/invitations/accept",
        payload: { token: `invalid-invitation-token-${String(index).padStart(4, "0")}` },
      }));
    }
    expect(responses.slice(0, 20).every((response) => response.statusCode === 400)).toBe(true);
    expect(responses[20]?.statusCode).toBe(429);
    expect(responses[20]?.json().error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("allows only one agency to accept concurrent invitations for the same account", async () => {
    const inviteA = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": "same-user-agency-a-0001" }, payload: { email: "compartida@example.es" },
    });
    const inviteB = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-b-token"), "idempotency-key": "same-user-agency-b-0001" }, payload: { email: "compartida@example.es" },
    });
    expect(inviteA.statusCode).toBe(201);
    expect(inviteB.statusCode).toBe(201);
    const results = await Promise.all([
      context.app.inject({ method: "POST", url: "/api/v1/team/invitations/accept", payload: { token: inviteA.json().data.debugToken, fullName: "Persona Compartida", password: "password-segura", termsAccepted: true } }),
      context.app.inject({ method: "POST", url: "/api/v1/team/invitations/accept", payload: { token: inviteB.json().data.debugToken, fullName: "Persona Compartida", password: "password-segura", termsAccepted: true } }),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    expect(results.find((response) => response.statusCode === 400)?.json().error.code).toBe("INVITATION_INVALID");
    const matchingUsers = await context.db.select().from(users).where(and(eq(users.email, "compartida@example.es"), eq(users.kind, "agency")));
    expect(matchingUsers).toHaveLength(1);
    expect(await context.db.select().from(agencyMemberships).where(eq(agencyMemberships.userId, matchingUsers[0]!.id))).toHaveLength(1);
  });

  it("rejects invitation creation and acceptance once agency closure has started", async () => {
    const invitation = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-b-token"), "idempotency-key": "invite-before-closure-0001" },
      payload: { email: "cierre@example.es" },
    });
    expect(invitation.statusCode).toBe(201);
    const token = invitation.json().data.debugToken as string;
    await enqueueEmail(context.db, {
      userId: adminB,
      recipient: "admin-b@example.es",
      template: "reset_password",
      variables: { token: "reset-token-before-agency-close", returnPath: "/app" },
      dedupeKey: "reset-admin-b-before-close",
    }, fixedNow);
    const closed = await context.app.inject({
      method: "POST", url: "/api/v1/account/close", headers: cookie("admin-b-token"),
      payload: { confirmation: "CERRAR MI CUENTA" },
    });
    expect(closed.statusCode).toBe(202);

    const createAfterClosure = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-b-token"), "idempotency-key": "invite-after-closure-00001" },
      payload: { email: "demasiado-tarde@example.es" },
    });
    expect([401, 403, 409]).toContain(createAfterClosure.statusCode);
    const acceptAfterClosure = await context.app.inject({
      method: "POST", url: "/api/v1/team/invitations/accept",
      payload: { token, fullName: "Persona Cierre", password: "password-segura", termsAccepted: true },
    });
    expect(acceptAfterClosure.statusCode).toBe(400);
    expect(acceptAfterClosure.json().error.code).toBe("INVITATION_INVALID");
    expect((await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.agencyId, agencyB)))[0]?.revokedAt).not.toBeNull();
    const closedOutbox = (await context.db.select().from(emailOutbox).where(eq(emailOutbox.agencyId, agencyB)))[0]!;
    expect(closedOutbox).toMatchObject({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, claimToken: null, claimedAt: null });
    const memberScoped = (await context.db.select().from(emailOutbox).where(eq(emailOutbox.userId, adminB)))[0]!;
    expect(memberScoped).toMatchObject({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: "ACCOUNT_CLOSED" });
    let delivered = 0;
    await dispatchEmailBatch(context.db, { deliver: async () => { delivered += 1; } }, "https://inquilink.example", { now: () => fixedNow });
    expect(delivered).toBe(0);
    expect(await context.db.select().from(users).where(and(eq(users.email, "cierre@example.es"), eq(users.kind, "agency")))).toHaveLength(0);
  });

  it("scrubs superseded and revoked invitation emails before delivery", async () => {
    const first = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-superseded-000001" }, payload: { email: "supersede@example.es" },
    });
    expect(first.statusCode).toBe(201);
    const invitationId = (await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.email, "supersede@example.es")))[0]!.id;
    const second = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-superseded-000002" }, payload: { email: "supersede@example.es" },
    });
    expect(second.statusCode).toBe(201);
    let queued = await context.db.select().from(emailOutbox).where(eq(emailOutbox.subjectId, invitationId));
    expect(queued).toHaveLength(2);
    expect(queued.filter((row) => row.state === "expired")[0]).toMatchObject({
      recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: "INVITATION_SUPERSEDED",
    });
    expect(queued.filter((row) => row.state === "pending")).toHaveLength(1);
    const currentTokenHash = (await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.id, invitationId)))[0]!.tokenHash;
    const delayedFirstRetry = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-superseded-000001" }, payload: { email: "supersede@example.es" },
    });
    expect(delayedFirstRetry.statusCode).toBe(201);
    expect(delayedFirstRetry.headers["idempotency-replayed"]).toBe("true");
    expect(delayedFirstRetry.json().data).not.toHaveProperty("debugToken");
    expect((await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.id, invitationId)))[0]!.tokenHash).toBe(currentTokenHash);
    expect(await context.db.select().from(emailOutbox).where(eq(emailOutbox.subjectId, invitationId))).toHaveLength(2);
    const mismatchedRetry = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-a-token"), "idempotency-key": "invite-superseded-000001" }, payload: { email: "otra@example.es" },
    });
    expect(mismatchedRetry.statusCode).toBe(409);
    expect(mismatchedRetry.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const revoked = await context.app.inject({
      method: "DELETE", url: `/api/v1/agency/team/invitations/${invitationId}`, headers: cookie("admin-a-token"),
    });
    expect(revoked.statusCode).toBe(204);
    queued = await context.db.select().from(emailOutbox).where(eq(emailOutbox.subjectId, invitationId));
    expect(queued.every((row) => row.state === "expired" && row.recipient === "eliminado@inquilink.invalid")).toBe(true);
    expect(queued.some((row) => row.lastErrorCode === "INVITATION_REVOKED")).toBe(true);
    let delivered = 0;
    await dispatchEmailBatch(context.db, { deliver: async () => { delivered += 1; } }, "https://inquilink.example", { now: () => fixedNow });
    expect(delivered).toBe(0);
  });

  it("preserves the last invitation idempotency key across the operation-history upgrade", async () => {
    const key = "legacy-invitation-key-0001";
    const invitationId = "88000000-0000-4000-8000-000000000099";
    await context.db.insert(agencyInvitations).values({
      id: invitationId, agencyId: agencyA, email: "legacy-invite@example.es", role: "collaborator",
      tokenHash: hashSecret("legacy-token-value-long-enough"), invitedByUserId: adminA,
      lastRequestKeyHash: hashSecret(key), expiresAt: new Date(fixedNow.getTime() + 86_400_000),
      createdAt: fixedNow, updatedAt: fixedNow,
    });
    const replay = await context.app.inject({ method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": key }, payload: { email: "legacy-invite@example.es" } });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.json().data).not.toHaveProperty("debugToken");
    expect((await context.db.select().from(agencyInvitations).where(eq(agencyInvitations.id, invitationId)))[0]!.tokenHash).toBe(hashSecret("legacy-token-value-long-enough"));
    const conflict = await context.app.inject({ method: "POST", url: "/api/v1/agency/team/invitations", headers: { ...cookie("admin-a-token"), "idempotency-key": key }, payload: { email: "different@example.es" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("serializes invitation acceptance against agency closure without leaving an active member", async () => {
    const invitation = await context.app.inject({
      method: "POST", url: "/api/v1/agency/team/invitations",
      headers: { ...cookie("admin-b-token"), "idempotency-key": "invite-close-race-000001" },
      payload: { email: "carrera-cierre@example.es" },
    });
    expect(invitation.statusCode).toBe(201);
    const [closed, accepted] = await Promise.all([
      context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: cookie("admin-b-token"), payload: { confirmation: "CERRAR MI CUENTA" } }),
      context.app.inject({ method: "POST", url: "/api/v1/team/invitations/accept", payload: { token: invitation.json().data.debugToken, fullName: "Persona Carrera", password: "password-segura", termsAccepted: true } }),
    ]);
    expect(closed.statusCode).toBe(202);
    expect([200, 400]).toContain(accepted.statusCode);
    const created = await context.db.select().from(users).where(and(eq(users.email, "carrera-cierre@example.es"), eq(users.kind, "agency")));
    if (accepted.statusCode === 200) {
      expect(created).toHaveLength(1);
      expect(created[0]?.accountState).toBe("closure_requested");
    } else {
      expect(accepted.json().error.code).toBe("INVITATION_INVALID");
      expect(created).toHaveLength(0);
    }
  });

  it("never permits removal or demotion of the last administrator", async () => {
    const demote = await context.app.inject({
      method: "PATCH", url: `/api/v1/agency/team/members/${adminA}`, headers: cookie("admin-a-token"), payload: { role: "collaborator" },
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe("LAST_ADMIN_REQUIRED");

    const remove = await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${adminA}`, headers: cookie("admin-a-token") });
    expect(remove.statusCode).toBe(409);
    const admins = await context.db.select().from(agencyMemberships).where(and(eq(agencyMemberships.agencyId, agencyA), eq(agencyMemberships.role, "admin")));
    expect(admins).toHaveLength(1);
  });

  it("returns a stable conflict until every responsible assignment is moved", async () => {
    await context.db.update(properties).set({ responsibleUserId: collaboratorA }).where(eq(properties.id, propertyA));
    await context.db.update(applications).set({ responsibleUserId: collaboratorA }).where(eq(applications.id, applicationA));
    await context.db.update(appointments).set({ responsibleUserId: collaboratorA }).where(eq(appointments.agencyId, agencyA));
    const blocked = await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${collaboratorA}`, headers: cookie("admin-a-token") });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatchObject({
      code: "MEMBER_HAS_ASSIGNMENTS",
      details: { properties: 1, applications: 1, appointments: 1 },
    });
    await context.db.update(properties).set({ responsibleUserId: adminA }).where(eq(properties.id, propertyA));
    await context.db.update(applications).set({ responsibleUserId: adminA }).where(eq(applications.id, applicationA));
    await context.db.update(appointments).set({ responsibleUserId: adminA }).where(eq(appointments.agencyId, agencyA));
    const removed = await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${collaboratorA}`, headers: cookie("admin-a-token") });
    expect(removed.statusCode).toBe(204);
  });

  it("expires queued agency mail for a removed member without touching tenant essentials", async () => {
    await enqueueEmail(context.db, {
      userId: collaboratorA, agencyId: agencyA, recipient: "colaborador-a@example.es",
      template: "new_applicant", variables: { propertyTitle: "Piso A" },
      dedupeKey: "member-removal-new-applicant",
    }, fixedNow);
    await enqueueEmail(context.db, {
      userId: tenantA, agencyId: agencyA, recipient: "tenant-a@example.es",
      template: "application_received", variables: { propertyTitle: "Piso A", agencyName: "Agencia A" },
      dedupeKey: "member-removal-tenant-essential",
    }, fixedNow);
    const agencyMessage = (await context.db.select().from(emailOutbox).where(eq(emailOutbox.userId, collaboratorA)))[0]!;
    await context.db.update(emailOutbox).set({ state: "processing", claimToken: "claimed-before-removal", claimedAt: fixedNow }).where(eq(emailOutbox.id, agencyMessage.id));

    const removed = await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${collaboratorA}`, headers: cookie("admin-a-token") });
    expect(removed.statusCode).toBe(204);
    expect((await context.db.select().from(emailOutbox).where(eq(emailOutbox.userId, collaboratorA)))[0]).toMatchObject({
      state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, claimToken: null, claimedAt: null,
      lastErrorCode: "AGENCY_MEMBERSHIP_REMOVED",
    });
    expect((await context.db.select().from(emailOutbox).where(eq(emailOutbox.userId, tenantA)))[0]).toMatchObject({
      state: "pending", recipient: "tenant-a@example.es", template: "application_received",
    });
    const deliveredRecipients: string[] = [];
    await dispatchEmailBatch(context.db, { deliver: async (delivery) => { deliveredRecipients.push(delivery.recipient); } }, "https://inquilink.example", { now: () => fixedNow });
    expect(deliveredRecipients).toEqual(["tenant-a@example.es"]);
  });

  it("keeps profile changes personal and agency identity changes admin-only", async () => {
    const profile = await context.app.inject({
      method: "PATCH", url: "/api/v1/account/profile", headers: cookie("collaborator-a-token"), payload: { fullName: "Nombre Actualizado" },
    });
    expect(profile.statusCode).toBe(200);
    const userRows = await context.db.select().from(users).where(eq(users.id, collaboratorA));
    expect(userRows[0]?.fullName).toBe("Nombre Actualizado");

    const denied = await context.app.inject({
      method: "PATCH", url: "/api/v1/agency/settings", headers: cookie("collaborator-a-token"), payload: { name: "Nombre indebido" },
    });
    expect(denied.statusCode).toBe(403);
    const updated = await context.app.inject({
      method: "PATCH", url: "/api/v1/agency/settings", headers: cookie("admin-a-token"),
      payload: { name: "Agencia A renovada", contactEmail: "contacto@example.es", phone: "+34910000000" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.agency).toMatchObject({ name: "Agencia A renovada", contactEmail: "contacto@example.es", phone: "+34910000000" });
    const agencyBRows = await context.db.select().from(agencies).where(eq(agencies.id, agencyB));
    expect(agencyBRows[0]?.name).toBe("Agencia B");
  });

  it("rejects a tenant profile write when closure wins after authentication", async () => {
    context.app.addHook("preHandler", async (request) => {
      if (request.method !== "PATCH" || request.url !== "/api/v1/account/profile" || request.currentUser?.id !== tenantA) return;
      await context.db.update(users).set({ accountState: "closure_requested", closureRequestedAt: fixedNow, updatedAt: fixedNow }).where(eq(users.id, tenantA));
    });
    const response = await context.app.inject({
      method: "PATCH", url: "/api/v1/account/profile", headers: cookie("tenant-a-token"), payload: { fullName: "Cambio tardío" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_CLOSURE_IN_PROGRESS");
    expect((await context.db.select().from(users).where(eq(users.id, tenantA)))[0]?.fullName).toBe("Inquilino A");
  });

  it("rejects an orphan agency-user profile write when closure wins after authentication", async () => {
    await context.db.delete(agencyMemberships).where(eq(agencyMemberships.userId, collaboratorA));
    context.app.addHook("preHandler", async (request) => {
      if (request.method !== "PATCH" || request.url !== "/api/v1/account/profile" || request.currentUser?.id !== collaboratorA) return;
      await context.db.update(users).set({ accountState: "closure_requested", closureRequestedAt: fixedNow, updatedAt: fixedNow }).where(eq(users.id, collaboratorA));
    });
    const response = await context.app.inject({
      method: "PATCH", url: "/api/v1/account/profile", headers: cookie("collaborator-a-token"), payload: { fullName: "Cambio tardío" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_CLOSURE_IN_PROGRESS");
    expect((await context.db.select().from(users).where(eq(users.id, collaboratorA)))[0]?.fullName).toBe("Colaborador A");
  });
});

describe("privacy-safe analytics", () => {
  it("rejects arbitrary names and PII-like or free-text fields", async () => {
    const pii = await context.app.inject({
      method: "POST", url: "/api/v1/analytics/events", payload: { name: "marketing_cta_clicked", placement: "hero", email: "persona@example.es" },
    });
    expect(pii.statusCode).toBe(400);
    const freeText = await context.app.inject({
      method: "POST", url: "/api/v1/analytics/events", payload: { name: "application_completed", notes: "información privada" }, headers: cookie("tenant-a-token"),
    });
    expect(freeText.statusCode).toBe(400);
    const unknown = await context.app.inject({ method: "POST", url: "/api/v1/analytics/events", payload: { name: "applicant_income_seen" } });
    expect(unknown.statusCode).toBe(400);
    for (const forbiddenField of ["phone", "income", "filename", "document", "message"]) {
      const response = await context.app.inject({
        method: "POST", url: "/api/v1/analytics/events",
        payload: { name: "marketing_cta_clicked", placement: "pricing", [forbiddenField]: "dato privado" },
      });
      expect(response.statusCode, forbiddenField).toBe(400);
      expect(response.json().error.code, forbiddenField).toBe("ANALYTICS_PAYLOAD_REJECTED");
    }
  });

  it("authorizes event categories and returns only the current agency summary", async () => {
    const eventA = await context.app.inject({
      method: "POST", url: "/api/v1/analytics/events", headers: cookie("admin-a-token"), payload: { name: "first_property_published" },
    });
    const eventB = await context.app.inject({
      method: "POST", url: "/api/v1/analytics/events", headers: cookie("admin-b-token"), payload: { name: "viewing_scheduled" },
    });
    expect(eventA.statusCode).toBe(202);
    expect(eventB.statusCode).toBe(202);
    const wrongActor = await context.app.inject({
      method: "POST", url: "/api/v1/analytics/events", headers: cookie("tenant-a-token"), payload: { name: "trial_activated", plan: "professional" },
    });
    expect(wrongActor.statusCode).toBe(403);

    const summaryA = await context.app.inject({ method: "GET", url: "/api/v1/agency/analytics/summary", headers: cookie("admin-a-token") });
    expect(summaryA.statusCode).toBe(200);
    expect(summaryA.json().data.events).toEqual([{ name: "first_property_published", count: 1 }]);
    expect(JSON.stringify(summaryA.json())).not.toContain("viewing_scheduled");
  });
});
