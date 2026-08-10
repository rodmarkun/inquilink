import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, cookieFrom } from "../../test/test-app.js";
import { agencies, emailOutbox, sessions, users } from "../../db/schema.js";
import { newId } from "../../lib/ids.js";
import type { EmailProvider } from "../email/provider.js";

const resources: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { await Promise.all(resources.splice(0).map((item) => item.close())); });

describe("authentication", () => {
  it("registers and verifies an agency account while preserving its return path", async () => {
    const context = await createTestApp(); resources.push(context);
    const registration = await context.app.inject({
      method: "POST", url: "/api/v1/auth/agency/register",
      payload: { fullName: "Ana García", agencyName: "Sol Madrid", email: "ANA@EXAMPLE.ES", phone: "+34600111222", fiscalId: "B-12345678", billingName: "Sol Madrid SL", billingAddress: "Calle Mayor 1, 28013 Madrid", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1", returnPath: "/registro?verificado=1&plan=inmobiliaria" },
    });
    expect(registration.statusCode).toBe(201);
    const registrationBody = registration.json();
    expect(registrationBody.data.debugToken).toEqual(expect.any(String));
    expect(context.emailProvider.messages[0]?.template).toBe("verify_email");

    const verification = await context.app.inject({
      method: "POST", url: "/api/v1/auth/verify-email", payload: { token: registrationBody.data.debugToken },
    });
    expect(verification.statusCode).toBe(200);
    expect(verification.json().data.returnPath).toBe("/registro?verificado=1&plan=inmobiliaria");
    const cookie = cookieFrom(verification);
    const me = await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({
      user: { kind: "agency", email: "ana@example.es", emailVerified: true },
      agency: { name: "Sol Madrid", role: "admin" },
    });
    expect((await context.db.select().from(agencies))[0]).toMatchObject({ fiscalId: "B12345678", billingName: "Sol Madrid SL", billingAddress: "Calle Mayor 1, 28013 Madrid" });
  });

  it("preserves the property path through tenant verification and invalidates reset tokens after one use", async () => {
    const context = await createTestApp(); resources.push(context);
    const registration = await context.app.inject({
      method: "POST", url: "/api/v1/auth/tenant/register",
      payload: { fullName: "Lucía Martín", email: "lucia@example.es", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1", returnPath: "/solicitud/token-propiedad" },
    });
    const token = registration.json().data.debugToken;
    const verification = await context.app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
    expect(verification.json().data.returnPath).toBe("/solicitud/token-propiedad");
    const persisted = (await context.db.select().from(users))[0];
    expect(persisted).toMatchObject({ termsVersion: "terms-2026-08-v1" });
    expect(persisted?.termsAcceptedAt).toBeInstanceOf(Date);

    const forgot = await context.app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: "lucia@example.es", accountType: "tenant", returnPath: "/solicitud/token-propiedad" } });
    const resetToken = forgot.json().data.debugToken;
    const sibling = await context.app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: "lucia@example.es", accountType: "tenant" } });
    const siblingToken = sibling.json().data.debugToken;
    const firstReset = await context.app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token: resetToken, password: "nueva-contraseña-segura" } });
    expect(firstReset.statusCode).toBe(200);
    expect(firstReset.json().data.returnPath).toBe("/solicitud/token-propiedad");
    expect(await context.db.select().from(sessions)).toHaveLength(0);
    const loginAfterReset = await context.app.inject({
      method: "POST", url: "/api/v1/auth/login",
      payload: { email: "lucia@example.es", password: "nueva-contraseña-segura", accountType: "tenant", returnPath: firstReset.json().data.returnPath },
    });
    expect(loginAfterReset.statusCode).toBe(200);
    expect(loginAfterReset.json().data.returnPath).toBe("/solicitud/token-propiedad");
    expect(cookieFrom(loginAfterReset)).toContain("inquilink_session=");
    const reuse = await context.app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token: resetToken, password: "otra-contraseña-segura" } });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe("TOKEN_INVALID");
    const siblingReuse = await context.app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token: siblingToken, password: "tercera-contraseña-segura" } });
    expect(siblingReuse.statusCode).toBe(400);
    expect(siblingReuse.json().error.code).toBe("TOKEN_INVALID");

    const plainForgot = await context.app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: "lucia@example.es", accountType: "tenant" } });
    const plainReset = await context.app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token: plainForgot.json().data.debugToken, password: "contraseña-final-segura" } });
    expect(plainReset.statusCode).toBe(200);
    expect(plainReset.json().data.returnPath).toBe("/iniciar-sesion");
    expect(await context.db.select().from(sessions)).toHaveLength(0);
    const plainLogin = await context.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "lucia@example.es", password: "contraseña-final-segura", accountType: "tenant" } });
    expect(plainLogin.statusCode).toBe(200);
    expect(plainLogin.json().data.returnPath).toBe("/mis-solicitudes");
  });

  it("rejects backslash-based external return paths", async () => {
    const context = await createTestApp(); resources.push(context);
    const registration = await context.app.inject({
      method: "POST", url: "/api/v1/auth/tenant/register",
      payload: { fullName: "Lucía Martín", email: "escape@example.es", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1", returnPath: "/\\evil.example" },
    });
    const verification = await context.app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token: registration.json().data.debugToken } });
    expect(verification.json().data.returnPath).toBe("/");
  });

  it("does not reveal whether an account exists during password recovery", async () => {
    const context = await createTestApp(); resources.push(context);
    const response = await context.app.inject({ method: "POST", url: "/api/v1/auth/forgot-password", payload: { email: "nadie@example.es", accountType: "tenant" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).not.toHaveProperty("debugToken");
  });

  it("resends verification without exposing account existence or verified state", async () => {
    const context = await createTestApp(); resources.push(context);
    const registration = await context.app.inject({
      method: "POST", url: "/api/v1/auth/agency/register",
      payload: { fullName: "Ana García", agencyName: "Sol Madrid", email: "reenviar@example.es", phone: "+34600111222", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    const resent = await context.app.inject({
      method: "POST", url: "/api/v1/auth/resend-verification",
      payload: { email: "REENVIAR@EXAMPLE.ES", accountType: "agency", returnPath: "/registro?verificado=1" },
    });
    expect(resent.statusCode).toBe(200);
    expect(resent.json().data).toMatchObject({ message: expect.stringContaining("Si la cuenta") });
    expect(resent.json().data.debugToken).toEqual(expect.any(String));
    expect(context.emailProvider.messages.filter((message) => message.template === "verify_email")).toHaveLength(2);

    const verified = await context.app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token: registration.json().data.debugToken } });
    expect(verified.statusCode).toBe(200);
    const alreadyVerified = await context.app.inject({ method: "POST", url: "/api/v1/auth/resend-verification", payload: { email: "reenviar@example.es", accountType: "agency" } });
    const missing = await context.app.inject({ method: "POST", url: "/api/v1/auth/resend-verification", payload: { email: "nadie@example.es", accountType: "agency" } });
    expect(alreadyVerified.statusCode).toBe(200);
    expect(missing.statusCode).toBe(200);
    expect(alreadyVerified.json().data).toEqual(missing.json().data);
    expect(context.emailProvider.messages.filter((message) => message.template === "verify_email")).toHaveLength(2);
  });

  it("rolls registration back when its verification message cannot be enqueued", async () => {
    const failingProvider: EmailProvider = { send: async () => { throw new Error("OUTBOX_UNAVAILABLE"); } };
    const context = await createTestApp({}, undefined, { emailProvider: failingProvider }); resources.push(context);
    const response = await context.app.inject({
      method: "POST", url: "/api/v1/auth/tenant/register",
      payload: { fullName: "Lucía Martín", email: "atomic@example.es", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    expect(response.statusCode).toBe(500);
    expect(await context.db.select().from(users)).toHaveLength(0);
  });

  it("returns only stable Spanish validation details", async () => {
    const context = await createTestApp(); resources.push(context);
    const response = await context.app.inject({ method: "POST", url: "/api/v1/auth/tenant/register", payload: { fullName: "x", email: "no-es-email", password: "corta" } });
    expect(response.statusCode).toBe(400);
    const messages = response.json().error.details.map((detail: { message: string }) => detail.message).join(" ");
    expect(messages).not.toMatch(/Invalid|Too small|expected string/i);
    expect(response.json().error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: "email", message: "El formato no es válido." })]));
  });

  it("requires the current account terms and stores no tenant without acceptance", async () => {
    const context = await createTestApp(); resources.push(context);
    const rejected = await context.app.inject({
      method: "POST", url: "/api/v1/auth/tenant/register",
      payload: { fullName: "Lucía Martín", email: "sin-terminos@example.es", password: "contraseña-segura", termsAccepted: false, termsVersion: "terms-2026-08-v1" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(JSON.stringify(rejected.json())).toMatch(/términos/);
    expect(await context.db.select().from(users)).toHaveLength(0);
  });

  it("immediately disables a tenant session while retaining a durable closure request", async () => {
    const context = await createTestApp(); resources.push(context);
    const registration = await context.app.inject({
      method: "POST", url: "/api/v1/auth/tenant/register",
      payload: { fullName: "Lucía Martín", email: "cerrar@example.es", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    const verification = await context.app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token: registration.json().data.debugToken } });
    const cookie = cookieFrom(verification);
    const userId = registration.json().data.userId as string;
    const queuedAt = new Date();
    await context.db.insert(emailOutbox).values([
      { id: newId(), userId, recipient: "cerrar@example.es", template: "reset_password", variables: { token: "sensitive-close-token", returnPath: "/" }, state: "pending", attempts: 0, availableAt: queuedAt, expiresAt: new Date(queuedAt.getTime() + 60_000), createdAt: queuedAt },
      { id: newId(), userId: newId(), recipient: "unrelated@example.es", template: "reset_password", variables: { token: "unrelated-token-value", returnPath: "/" }, state: "pending", attempts: 0, availableAt: queuedAt, expiresAt: new Date(queuedAt.getTime() + 60_000), createdAt: queuedAt },
    ]);
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    expect(closed.json().data).toEqual({ state: "closure_requested", purgePolicyEnabled: false });
    expect((await context.db.select().from(users))[0]).toMatchObject({ accountState: "closure_requested" });
    expect(await context.db.select().from(sessions)).toHaveLength(0);
    const outbox = await context.db.select().from(emailOutbox);
    expect(outbox.find((row) => row.userId === userId)).toMatchObject({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: "ACCOUNT_CLOSED" });
    expect(outbox.find((row) => row.userId !== userId)).toMatchObject({ state: "pending", recipient: "unrelated@example.es" });
    expect((await context.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie } })).statusCode).toBe(401);
  });

  it("allows only an administrator to close an agency and disables every member", async () => {
    const context = await createTestApp(); resources.push(context);
    const registration = await context.app.inject({
      method: "POST", url: "/api/v1/auth/agency/register",
      payload: { fullName: "Ana García", agencyName: "Sol Madrid", email: "cierre-agencia@example.es", phone: "+34600111222", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    const verification = await context.app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token: registration.json().data.debugToken } });
    const agencyId = registration.json().data.agencyId as string;
    const queuedAt = new Date();
    await context.db.insert(emailOutbox).values([
      { id: newId(), agencyId, recipient: "cierre-agencia@example.es", template: "trial_ending", variables: { trialEndsAt: new Date(queuedAt.getTime() + 60_000).toISOString(), plan: "professional" }, state: "processing", attempts: 1, availableAt: queuedAt, claimedAt: queuedAt, claimToken: "claim-sensitive", expiresAt: new Date(queuedAt.getTime() + 120_000), createdAt: queuedAt },
      { id: newId(), agencyId: newId(), recipient: "otra-agencia@example.es", template: "trial_ending", variables: { trialEndsAt: new Date(queuedAt.getTime() + 60_000).toISOString(), plan: "professional" }, state: "pending", attempts: 0, availableAt: queuedAt, expiresAt: new Date(queuedAt.getTime() + 120_000), createdAt: queuedAt },
    ]);
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookieFrom(verification) }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    expect((await context.db.select().from(agencies))[0]).toMatchObject({ accountState: "closure_requested" });
    expect((await context.db.select().from(users))[0]).toMatchObject({ accountState: "closure_requested" });
    const outbox = await context.db.select().from(emailOutbox);
    expect(outbox.find((row) => row.agencyId === agencyId)).toMatchObject({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, claimToken: null, claimedAt: null });
    expect(outbox.find((row) => row.agencyId !== agencyId)).toMatchObject({ state: "pending", recipient: "otra-agencia@example.es" });
  });

  it("returns stable conflicts for concurrent duplicate tenant and agency registrations", async () => {
    const context = await createTestApp(); resources.push(context);
    const tenantRequest = () => context.app.inject({
      method: "POST", url: "/api/v1/auth/tenant/register",
      payload: { fullName: "Lucía Martín", email: "duplicada@example.es", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    const tenants = await Promise.all([tenantRequest(), tenantRequest()]);
    expect(tenants.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(tenants.find((response) => response.statusCode === 409)?.json().error.code).toBe("EMAIL_ALREADY_REGISTERED");

    const agencyRequest = () => context.app.inject({
      method: "POST", url: "/api/v1/auth/agency/register",
      payload: { fullName: "Ana García", agencyName: "Agencia Duplicada", email: "agencia-duplicada@example.es", phone: "+34600111222", password: "contraseña-segura", termsAccepted: true, termsVersion: "terms-2026-08-v1" },
    });
    const agencyResponses = await Promise.all([agencyRequest(), agencyRequest()]);
    expect(agencyResponses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(agencyResponses.find((response) => response.statusCode === 409)?.json().error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });
});
