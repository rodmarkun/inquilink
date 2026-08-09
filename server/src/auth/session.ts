import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { agencyMemberships, agencies, sessions, users } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import { hashSecret, newId, newSecret } from "../lib/ids.js";
import type { AppDependencies } from "../types.js";

export const SESSION_COOKIE = "inquilink_session";

export function registerSessionAuth(app: FastifyInstance, deps: AppDependencies): void {
  const now = deps.now ?? (() => new Date());

  app.addHook("onRequest", async (request) => {
    request.currentUser = null;
    request.currentAgency = null;
    request.sessionId = null;
  });

  app.addHook("preHandler", async (request) => {
    const rawToken = request.cookies[SESSION_COOKIE];
    if (!rawToken) return;

    const rows = await deps.db
      .select({
        sessionId: sessions.id,
        userId: users.id,
        kind: users.kind,
        email: users.email,
        fullName: users.fullName,
        emailVerifiedAt: users.emailVerifiedAt,
        userAccountState: users.accountState,
        agencyId: agencies.id,
        agencyName: agencies.name,
        role: agencyMemberships.role,
        agencyAccountState: agencies.accountState,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(agencyMemberships, eq(agencyMemberships.userId, users.id))
      .leftJoin(agencies, eq(agencies.id, agencyMemberships.agencyId))
      .where(and(
        eq(sessions.tokenHash, hashSecret(rawToken)), gt(sessions.expiresAt, now()),
        eq(users.accountState, "active"),
        or(isNull(agencies.id), eq(agencies.accountState, "active")),
      ))
      .limit(1);

    const row = rows[0];
    if (!row) return;
    request.sessionId = row.sessionId;
    request.currentUser = {
      id: row.userId,
      kind: row.kind,
      email: row.email,
      fullName: row.fullName,
      emailVerified: row.emailVerifiedAt !== null,
    };
    if (row.kind === "agency" && row.agencyId && row.agencyName && row.role) {
      request.currentAgency = { id: row.agencyId, name: row.agencyName, role: row.role };
    }
  });
}

export async function createSession(deps: AppDependencies, userId: string): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const now = (deps.now ?? (() => new Date()))();
  const active = await deps.db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.accountState, "active"))).limit(1);
  if (!active[0]) throw new ApiError(403, "ACCOUNT_CLOSED", "Esta cuenta está cerrada o pendiente de eliminación.");
  const token = newSecret();
  const sessionId = newId();
  const expiresAt = new Date(now.getTime() + deps.config.SESSION_TTL_DAYS * 86_400_000);
  await deps.db.insert(sessions).values({
    id: sessionId,
    userId,
    tokenHash: hashSecret(token),
    expiresAt,
    lastSeenAt: now,
    createdAt: now,
  });
  return { token, sessionId, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, deps: AppDependencies, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: deps.config.COOKIE_SECURE,
    sameSite: "lax",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, deps: AppDependencies): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: deps.config.COOKIE_SECURE,
    sameSite: "lax",
  });
}

export function requireUser(request: FastifyRequest): NonNullable<FastifyRequest["currentUser"]> {
  if (!request.currentUser) throw new ApiError(401, "AUTH_REQUIRED", "Inicia sesión para continuar.");
  if (!request.currentUser.emailVerified) throw new ApiError(403, "EMAIL_NOT_VERIFIED", "Verifica tu correo electrónico para continuar.");
  return request.currentUser;
}

export function requireAgency(request: FastifyRequest): { user: NonNullable<FastifyRequest["currentUser"]>; agency: NonNullable<FastifyRequest["currentAgency"]> } {
  const user = requireUser(request);
  if (user.kind !== "agency" || !request.currentAgency) {
    throw new ApiError(403, "AGENCY_ACCESS_REQUIRED", "No tienes acceso a este espacio de agencia.");
  }
  return { user, agency: request.currentAgency };
}

export function requireAdmin(request: FastifyRequest): ReturnType<typeof requireAgency> {
  const context = requireAgency(request);
  if (context.agency.role !== "admin") {
    throw new ApiError(403, "ADMIN_REQUIRED", "Solo una persona administradora puede realizar esta acción.");
  }
  return context;
}

export function requireTenant(request: FastifyRequest): NonNullable<FastifyRequest["currentUser"]> {
  const user = requireUser(request);
  if (user.kind !== "tenant") throw new ApiError(403, "TENANT_ACCESS_REQUIRED", "Esta acción requiere una cuenta de inquilino.");
  return user;
}
