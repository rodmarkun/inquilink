import argon2 from "argon2";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearSessionCookie, createSession, requireTenant, requireUser, SESSION_COOKIE, setSessionCookie } from "../../auth/session.js";
import { agencies, agencyClosureCleanup, agencyInvitations, agencyMemberships, emailOutbox, oneTimeTokens, sessions, subscriptions, users } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { hashSecret, newId, newSecret } from "../../lib/ids.js";
import type { AppDependencies } from "../../types.js";
import { lockActiveAgency } from "../agency-lock.js";
import { enforceAuthRateLimits } from "../../auth/rate-limit.js";

const dummyPassword = "inquilink-auth-timing-placeholder";
const dummyPasswordHash = argon2.hash(dummyPassword);
export const CURRENT_ACCOUNT_TERMS_VERSION = "terms-2026-08-v1";

const password = z.string().min(10).max(200);
const returnPath = z.string().max(500).optional().transform((value) => {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
});

const agencyRegistration = z.object({
  fullName: z.string().trim().min(2).max(200),
  agencyName: z.string().trim().min(2).max(200),
  email: z.email().max(320),
  phone: z.string().trim().min(6).max(40),
  fiscalId: z.string().trim().transform((value) => value.replace(/[\s-]/g, "").toUpperCase()).pipe(z.string().regex(/^(?:[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])$/)).optional(),
  billingName: z.string().trim().min(2).max(200).optional(),
  billingAddress: z.string().trim().min(5).max(500).optional(),
  password,
  termsAccepted: z.literal(true, { error: "Debes aceptar los términos de la cuenta para continuar." }),
  termsVersion: z.literal(CURRENT_ACCOUNT_TERMS_VERSION, { error: "La versión de los términos no es válida. Actualiza la página e inténtalo de nuevo." }),
  returnPath,
}).strict();

const tenantRegistration = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.email().max(320),
  password,
  termsAccepted: z.literal(true, { error: "Debes aceptar los términos de la cuenta para continuar." }),
  termsVersion: z.literal(CURRENT_ACCOUNT_TERMS_VERSION, { error: "La versión de los términos no es válida. Actualiza la página e inténtalo de nuevo." }),
  returnPath,
}).strict();

function databaseCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string" && /^[0-9A-Z_]{2,20}$/.test(record.code)) return record.code;
    current = record.cause;
  }
  return null;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const now = deps.now ?? (() => new Date());

  async function issueToken(
    transaction: Pick<AppDependencies["db"], "insert">,
    userId: string,
    email: string,
    kind: "verify_email" | "reset_password",
    path: string | null,
    createdAt: Date,
  ) {
    const token = newSecret();
    const expiresAt = new Date(createdAt.getTime() + deps.config.TOKEN_TTL_MINUTES * 60_000);
    await transaction.insert(oneTimeTokens).values({
      id: newId(), userId, kind, tokenHash: hashSecret(token), returnPath: path,
      expiresAt, createdAt,
    });
    await deps.emailProvider.send({
      userId,
      recipient: email,
      template: kind,
      variables: { token, returnPath: path ?? "/" },
      dedupeKey: `${kind}:${userId}:${hashSecret(token).slice(0, 24)}`,
      expiresAt,
    }, { transaction });
    return token;
  }

  app.post("/api/v1/auth/agency/register", {
    schema: { tags: ["Autenticación"], summary: "Registrar una agencia" },
  }, async (request, reply) => {
    const input = agencyRegistration.parse(request.body);
    const email = input.email.toLowerCase();
    await enforceAuthRateLimits(deps, request, "register", `agency:${email}`);
    const existing = await deps.db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.kind, "agency"))).limit(1);
    if (existing.length) throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ya existe una cuenta de agencia con este correo.");
    const createdAt = now();
    const userId = newId();
    const agencyId = newId();
    const passwordHash = await argon2.hash(input.password);
    let token = "";
    try {
      await deps.db.transaction(async (tx) => {
        const inserted = await tx.insert(users).values({
          id: userId, kind: "agency", email, fullName: input.fullName, passwordHash,
          termsVersion: input.termsVersion, termsAcceptedAt: createdAt, createdAt, updatedAt: createdAt,
        })
          .onConflictDoNothing({ target: [users.email, users.kind] }).returning({ id: users.id });
        if (!inserted[0]) throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ya existe una cuenta de agencia con este correo.");
        await tx.insert(agencies).values({ id: agencyId, name: input.agencyName, phone: input.phone, fiscalId: input.fiscalId ?? null, billingName: input.billingName ?? null, billingAddress: input.billingAddress ?? null, createdAt, updatedAt: createdAt });
        await tx.insert(agencyMemberships).values({ agencyId, userId, role: "admin", createdAt });
        token = await issueToken(tx, userId, email, "verify_email", input.returnPath ?? "/registro?verificado=1", createdAt);
      });
    } catch (error) {
      if (databaseCode(error) === "23505") throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ya existe una cuenta de agencia con este correo.");
      throw error;
    }
    const debugToken = deps.config.NODE_ENV === "test" ? token : undefined;
    return reply.status(201).send({ data: { userId, agencyId, message: "Revisa tu correo para verificar la cuenta.", ...(debugToken ? { debugToken } : {}) } });
  });

  app.post("/api/v1/auth/tenant/register", {
    schema: { tags: ["Autenticación"], summary: "Registrar un inquilino" },
  }, async (request, reply) => {
    const input = tenantRegistration.parse(request.body);
    const email = input.email.toLowerCase();
    await enforceAuthRateLimits(deps, request, "register", `tenant:${email}`);
    const existing = await deps.db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.kind, "tenant"))).limit(1);
    if (existing.length) throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ya existe una cuenta de inquilino con este correo.");
    const createdAt = now();
    const userId = newId();
    const passwordHash = await argon2.hash(input.password);
    let token = "";
    try {
      await deps.db.transaction(async (tx) => {
        const inserted = await tx.insert(users).values({
          id: userId, kind: "tenant", email, fullName: input.fullName, passwordHash,
          termsVersion: input.termsVersion, termsAcceptedAt: createdAt, createdAt, updatedAt: createdAt,
        }).onConflictDoNothing({ target: [users.email, users.kind] }).returning({ id: users.id });
        if (!inserted[0]) throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ya existe una cuenta de inquilino con este correo.");
        token = await issueToken(tx, userId, email, "verify_email", input.returnPath, createdAt);
      });
    } catch (error) {
      if (databaseCode(error) === "23505") throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "Ya existe una cuenta de inquilino con este correo.");
      throw error;
    }
    const debugToken = deps.config.NODE_ENV === "test" ? token : undefined;
    return reply.status(201).send({ data: { userId, message: "Revisa tu correo para verificar la cuenta.", ...(debugToken ? { debugToken } : {}) } });
  });

  app.post("/api/v1/auth/verify-email", {
    schema: { tags: ["Autenticación"], summary: "Verificar correo electrónico" },
  }, async (request, reply) => {
    const input = z.object({ token: z.string().min(20) }).parse(request.body);
    const tokenRows = await deps.db.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.tokenHash, hashSecret(input.token)), eq(oneTimeTokens.kind, "verify_email"), isNull(oneTimeTokens.usedAt))).limit(1);
    const record = tokenRows[0];
    if (!record || record.expiresAt <= now()) throw new ApiError(400, "TOKEN_INVALID", "El enlace de verificación no es válido o ha caducado.");
    const verifiedAt = now();
    await deps.db.transaction(async (tx) => {
      const userRows = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, record.userId)).for("update").limit(1);
      if (userRows[0]?.accountState !== "active") throw new ApiError(400, "TOKEN_INVALID", "El enlace de verificación no es válido o ha caducado.");
      const consumed = await tx.update(oneTimeTokens).set({ usedAt: verifiedAt, returnPath: null })
        .where(and(eq(oneTimeTokens.id, record.id), isNull(oneTimeTokens.usedAt)))
        .returning({ id: oneTimeTokens.id });
      if (!consumed[0]) throw new ApiError(400, "TOKEN_INVALID", "El enlace de verificación ya se ha utilizado.");
      await tx.update(users).set({ emailVerifiedAt: verifiedAt, updatedAt: verifiedAt }).where(eq(users.id, record.userId));
    });
    const session = await createSession(deps, record.userId);
    setSessionCookie(reply, deps, session.token, session.expiresAt);
    return { data: { verified: true, returnPath: record.returnPath ?? "/" } };
  });

  app.post("/api/v1/auth/resend-verification", {
    schema: {
      tags: ["Autenticación"], summary: "Reenviar la verificación del correo",
      body: {
        type: "object", additionalProperties: false, required: ["email", "accountType"],
        properties: {
          email: { type: "string", format: "email", maxLength: 320 },
          accountType: { type: "string", enum: ["agency", "tenant"] },
          returnPath: { type: "string", maxLength: 500 },
        },
      },
    },
  }, async (request) => {
    const input = z.object({ email: z.email(), accountType: z.enum(["agency", "tenant"]), returnPath }).strict().parse(request.body);
    const email = input.email.toLowerCase();
    await enforceAuthRateLimits(deps, request, "recover", `verify:${input.accountType}:${email}`);
    const rows = await deps.db.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(and(
      eq(users.email, email), eq(users.kind, input.accountType), eq(users.accountState, "active"),
    )).limit(1);
    // Match the password-recovery endpoint's response shape and timing so this
    // public endpoint cannot be used to enumerate registered accounts.
    await argon2.verify(await dummyPasswordHash, dummyPassword);
    let token: string | undefined;
    const user = rows[0];
    if (user && !user.emailVerifiedAt) {
      const clock = now();
      const cooldownSince = new Date(clock.getTime() - deps.config.AUTH_EMAIL_COOLDOWN_SECONDS * 1000);
      await deps.db.transaction(async (tx) => {
        const locked = await tx.select({ accountState: users.accountState, emailVerifiedAt: users.emailVerifiedAt }).from(users)
          .where(eq(users.id, user.id)).for("update").limit(1);
        if (locked[0]?.accountState !== "active" || locked[0].emailVerifiedAt) return;
        const recent = deps.config.AUTH_EMAIL_COOLDOWN_SECONDS > 0
          ? await tx.select({ id: oneTimeTokens.id }).from(oneTimeTokens).where(and(
            eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, "verify_email"), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.createdAt, cooldownSince),
          )).limit(1)
          : [];
        if (!recent[0]) token = await issueToken(tx, user.id, user.email, "verify_email", input.returnPath, clock);
      });
    }
    const debugToken = deps.config.NODE_ENV === "test" ? token : undefined;
    return { data: { message: "Si la cuenta está pendiente de verificación, recibirás un nuevo correo.", ...(debugToken ? { debugToken } : {}) } };
  });

  app.post("/api/v1/auth/login", {
    schema: { tags: ["Autenticación"], summary: "Iniciar sesión" },
  }, async (request, reply) => {
    const input = z.object({ email: z.email(), password: z.string().min(1), accountType: z.enum(["agency", "tenant"]), returnPath }).parse(request.body);
    const email = input.email.toLowerCase();
    await enforceAuthRateLimits(deps, request, "login", `${input.accountType}:${email}`);
    const rows = await deps.db.select().from(users).where(and(eq(users.email, email), eq(users.kind, input.accountType))).limit(1);
    const user = rows[0];
    const validPassword = await argon2.verify(user?.passwordHash ?? await dummyPasswordHash, input.password);
    if (!user || !validPassword) throw new ApiError(401, "INVALID_CREDENTIALS", "Correo o contraseña incorrectos.");
    if (user.accountState !== "active") throw new ApiError(403, "ACCOUNT_CLOSED", "Esta cuenta está cerrada o pendiente de eliminación.");
    if (!user.emailVerifiedAt) throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Verifica tu correo electrónico antes de iniciar sesión.");
    const session = await createSession(deps, user.id);
    setSessionCookie(reply, deps, session.token, session.expiresAt);
    return { data: { user: { id: user.id, kind: user.kind, email: user.email, fullName: user.fullName }, returnPath: input.returnPath ?? (user.kind === "agency" ? "/app" : "/mis-solicitudes") } };
  });

  app.post("/api/v1/auth/logout", { schema: { tags: ["Autenticación"], summary: "Cerrar sesión" } }, async (request, reply) => {
    if (request.sessionId) await deps.db.delete(sessions).where(eq(sessions.id, request.sessionId));
    clearSessionCookie(reply, deps);
    return reply.status(204).send();
  });

  app.post("/api/v1/account/close", {
    schema: {
      tags: ["Autenticación"], summary: "Solicitar el cierre de la cuenta",
      body: { type: "object", additionalProperties: false, required: ["confirmation"], properties: { confirmation: { type: "string", enum: ["CERRAR MI CUENTA"] } } },
    },
  }, async (request, reply) => {
    const user = requireUser(request);
    z.object({ confirmation: z.literal("CERRAR MI CUENTA") }).strict().parse(request.body);
    const requestedAt = now();
    await deps.db.transaction(async (tx) => {
      // A former agency member can have a valid personal login but no workspace;
      // they must still be able to close that orphaned personal account.
      if (user.kind === "tenant" || !request.currentAgency) {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update").limit(1);
        await tx.update(users).set({ accountState: "closure_requested", closureRequestedAt: requestedAt, accountPurgeNextAttemptAt: requestedAt, updatedAt: requestedAt })
          .where(and(eq(users.id, user.id), eq(users.accountState, "active")));
        await tx.update(emailOutbox).set({
          state: "expired", recipient: "eliminado@inquilink.invalid", variables: {},
          claimToken: null, claimedAt: null, lastErrorCode: "ACCOUNT_CLOSED",
        }).where(and(eq(emailOutbox.userId, user.id), or(eq(emailOutbox.state, "pending"), eq(emailOutbox.state, "processing"))));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.delete(oneTimeTokens).where(eq(oneTimeTokens.userId, user.id));
        return;
      }
      const agency = request.currentAgency;
      if (agency.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "Solo una persona administradora puede cerrar la cuenta de la agencia.");
      await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
      const memberRows = await tx.select({ userId: agencyMemberships.userId }).from(agencyMemberships).where(eq(agencyMemberships.agencyId, agency.id));
      const memberIds = memberRows.map((member) => member.userId);
      const subscriptionRows = await tx.select({
        providerSubscriptionRef: subscriptions.providerSubscriptionRef,
        pendingBillingOperationId: subscriptions.pendingBillingOperationId,
      }).from(subscriptions).where(eq(subscriptions.agencyId, agency.id)).limit(1);
      const providerSubscriptionRef = subscriptionRows[0]?.providerSubscriptionRef ?? null;
      const hasUnresolvedBillingOperation = Boolean(subscriptionRows[0]?.pendingBillingOperationId);
      await tx.insert(agencyClosureCleanup).values({
        id: newId(), agencyId: agency.id, providerSubscriptionRef,
        state: providerSubscriptionRef || hasUnresolvedBillingOperation ? "pending" : "ready_for_purge",
        nextAttemptAt: requestedAt,
        createdAt: requestedAt, updatedAt: requestedAt,
      }).onConflictDoNothing({ target: agencyClosureCleanup.agencyId });
      await tx.update(agencies).set({ accountState: "closure_requested", closureRequestedAt: requestedAt, accountPurgeNextAttemptAt: requestedAt, updatedAt: requestedAt })
        .where(and(eq(agencies.id, agency.id), eq(agencies.accountState, "active")));
      await tx.update(agencyInvitations).set({ revokedAt: requestedAt, updatedAt: requestedAt }).where(and(
        eq(agencyInvitations.agencyId, agency.id), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt),
      ));
      await tx.update(emailOutbox).set({
        state: "expired", recipient: "eliminado@inquilink.invalid", variables: {},
        claimToken: null, claimedAt: null, lastErrorCode: "ACCOUNT_CLOSED",
      }).where(and(
        memberIds.length ? or(eq(emailOutbox.agencyId, agency.id), inArray(emailOutbox.userId, memberIds)) : eq(emailOutbox.agencyId, agency.id),
        or(eq(emailOutbox.state, "pending"), eq(emailOutbox.state, "processing")),
      ));
      if (memberIds.length) {
        await tx.update(users).set({ accountState: "closure_requested", closureRequestedAt: requestedAt, accountPurgeNextAttemptAt: requestedAt, updatedAt: requestedAt }).where(inArray(users.id, memberIds));
        await tx.delete(sessions).where(inArray(sessions.userId, memberIds));
        await tx.delete(oneTimeTokens).where(inArray(oneTimeTokens.userId, memberIds));
      }
    });
    clearSessionCookie(reply, deps);
    return reply.status(202).send({ data: { state: "closure_requested", purgePolicyEnabled: deps.config.ACCOUNT_CLOSURE_RETENTION_DAYS !== undefined } });
  });

  app.post("/api/v1/auth/forgot-password", { schema: { tags: ["Autenticación"], summary: "Solicitar recuperación de contraseña" } }, async (request) => {
    const input = z.object({ email: z.email(), accountType: z.enum(["agency", "tenant"]), returnPath }).parse(request.body);
    const email = input.email.toLowerCase();
    await enforceAuthRateLimits(deps, request, "recover", `${input.accountType}:${email}`);
    const rows = await deps.db.select({ id: users.id, email: users.email }).from(users).where(and(
      eq(users.email, email), eq(users.kind, input.accountType), eq(users.accountState, "active"),
    )).limit(1);
    // Comparable Argon2 work is performed regardless of account existence.
    await argon2.verify(await dummyPasswordHash, dummyPassword);
    let token: string | undefined;
    const user = rows[0];
    if (user) {
      const clock = now();
      const cooldownSince = new Date(clock.getTime() - deps.config.AUTH_EMAIL_COOLDOWN_SECONDS * 1000);
      await deps.db.transaction(async (tx) => {
        const locked = await tx.select({ accountState: users.accountState }).from(users)
          .where(eq(users.id, user.id)).for("update").limit(1);
        if (locked[0]?.accountState !== "active") return;
        const recent = deps.config.AUTH_EMAIL_COOLDOWN_SECONDS > 0
          ? await tx.select({ id: oneTimeTokens.id }).from(oneTimeTokens).where(and(
            eq(oneTimeTokens.userId, user.id), eq(oneTimeTokens.kind, "reset_password"), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.createdAt, cooldownSince),
          )).limit(1)
          : [];
        if (!recent[0]) token = await issueToken(tx, user.id, user.email, "reset_password", input.returnPath, clock);
      });
    }
    const debugToken = deps.config.NODE_ENV === "test" ? token : undefined;
    return { data: { message: "Si existe una cuenta, recibirás un correo para restablecer la contraseña.", ...(debugToken ? { debugToken } : {}) } };
  });

  app.post("/api/v1/auth/reset-password", { schema: { tags: ["Autenticación"], summary: "Restablecer contraseña" } }, async (request) => {
    const input = z.object({ token: z.string().min(20), password }).parse(request.body);
    const rows = await deps.db.select().from(oneTimeTokens).where(and(eq(oneTimeTokens.tokenHash, hashSecret(input.token)), eq(oneTimeTokens.kind, "reset_password"), isNull(oneTimeTokens.usedAt))).limit(1);
    const record = rows[0];
    if (!record || record.expiresAt <= now()) throw new ApiError(400, "TOKEN_INVALID", "El enlace de recuperación no es válido o ha caducado.");
    const changedAt = now();
    const passwordHash = await argon2.hash(input.password);
    await deps.db.transaction(async (tx) => {
      const userRows = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, record.userId)).for("update").limit(1);
      if (userRows[0]?.accountState !== "active") throw new ApiError(400, "TOKEN_INVALID", "El enlace de recuperación no es válido o ha caducado.");
      const consumed = await tx.update(oneTimeTokens).set({ usedAt: changedAt, returnPath: null })
        .where(and(eq(oneTimeTokens.id, record.id), isNull(oneTimeTokens.usedAt)))
        .returning({ id: oneTimeTokens.id });
      if (!consumed[0]) throw new ApiError(400, "TOKEN_INVALID", "El enlace de recuperación ya se ha utilizado.");
      await tx.update(users).set({ passwordHash, updatedAt: changedAt }).where(eq(users.id, record.userId));
      await tx.delete(sessions).where(eq(sessions.userId, record.userId));
      await tx.update(oneTimeTokens).set({ usedAt: changedAt, returnPath: null })
        .where(and(eq(oneTimeTokens.userId, record.userId), eq(oneTimeTokens.kind, "reset_password"), isNull(oneTimeTokens.usedAt)));
    });
    return { data: { message: "Contraseña actualizada. Ya puedes iniciar sesión.", returnPath: record.returnPath ?? "/iniciar-sesion" } };
  });

  app.get("/api/v1/auth/me", { schema: { tags: ["Autenticación"], summary: "Obtener la sesión actual" } }, async (request) => {
    const user = requireUser(request);
    return { data: { user, agency: request.currentAgency } };
  });

  app.post("/api/v1/tenant/account/set-password", { schema: { tags: ["Inquilinos"], summary: "Guardar una contraseña para una cuenta invitada" } }, async (request) => {
    const tenant = requireTenant(request);
    const input = z.object({
      password,
      termsAccepted: z.literal(true, { error: "Debes aceptar los términos de la cuenta para continuar." }),
      termsVersion: z.literal(CURRENT_ACCOUNT_TERMS_VERSION, { error: "La versión de los términos no es válida. Actualiza la página e inténtalo de nuevo." }),
    }).strict().parse(request.body);
    const changedAt = now();
    const passwordHash = await argon2.hash(input.password);
    await deps.db.transaction(async (tx) => {
      const rows = await tx.select({ passwordHash: users.passwordHash, accountState: users.accountState }).from(users)
        .where(and(eq(users.id, tenant.id), eq(users.kind, "tenant"))).for("update").limit(1);
      if (rows[0]?.accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "Esta cuenta está cerrada o pendiente de eliminación.");
      if (rows[0].passwordHash !== null) throw new ApiError(409, "PASSWORD_ALREADY_SET", "Esta cuenta ya tiene una contraseña configurada.");
      await tx.update(users).set({
        passwordHash,
        termsVersion: input.termsVersion,
        termsAcceptedAt: changedAt,
        updatedAt: changedAt,
      }).where(and(eq(users.id, tenant.id), isNull(users.passwordHash)));
    });
    return { data: { passwordSet: true } };
  });
}
