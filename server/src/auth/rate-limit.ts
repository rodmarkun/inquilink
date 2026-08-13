import { lt, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import type { FastifyRequest } from "fastify";
import { authRateLimits } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";
import { hashSecret } from "../lib/ids.js";
import type { AppDependencies } from "../types.js";

interface Limit {
  max: number;
  windowMs: number;
}

async function increment(deps: AppDependencies, scope: string, value: string, limit: Limit, now: Date): Promise<void> {
  const windowEpoch = Math.floor(now.getTime() / limit.windowMs) * limit.windowMs;
  const windowStartedAt = new Date(windowEpoch);
  const encodedWindowStart = sql.param(windowStartedAt, authRateLimits.windowStartedAt);
  const keyHash = hashSecret(`auth-rate:${scope}:${value}`);
  const rows = await deps.db.insert(authRateLimits).values({ keyHash, scope, windowStartedAt, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: authRateLimits.keyHash,
      set: {
        scope,
        windowStartedAt: sql`CASE WHEN ${authRateLimits.windowStartedAt} < ${encodedWindowStart} THEN ${encodedWindowStart} ELSE ${authRateLimits.windowStartedAt} END`,
        count: sql`CASE WHEN ${authRateLimits.windowStartedAt} < ${encodedWindowStart} THEN 1 ELSE ${authRateLimits.count} + 1 END`,
        updatedAt: now,
      },
    }).returning({ count: authRateLimits.count, windowStartedAt: authRateLimits.windowStartedAt });
  const bucket = rows[0];
  if (bucket && bucket.count > limit.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt.getTime() + limit.windowMs - now.getTime()) / 1000));
    throw new ApiError(429, "AUTH_RATE_LIMITED", "Has realizado demasiados intentos. Espera antes de volver a intentarlo.", { retryAfterSeconds });
  }
}

export async function enforceAuthRateLimits(
  deps: AppDependencies,
  request: FastifyRequest,
  action: "login" | "register" | "recover" | "invitation_accept",
  normalizedAccount: string,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  const limits = action === "login"
    ? { ip: { max: 50, windowMs: 15 * 60_000 }, account: { max: 20, windowMs: 15 * 60_000 } }
    : action === "recover"
      ? { ip: { max: 20, windowMs: 60 * 60_000 }, account: { max: 5, windowMs: 60 * 60_000 } }
      : action === "invitation_accept"
        ? { ip: { max: 20, windowMs: 60 * 60_000 }, account: { max: 5, windowMs: 60 * 60_000 } }
      : { ip: { max: 10, windowMs: 60 * 60_000 }, account: { max: 3, windowMs: 60 * 60_000 } };
  // Raw IPs and account identifiers never enter this table.
  await increment(deps, `${action}:ip`, request.ip, limits.ip, now);
  await increment(deps, `${action}:account`, normalizedAccount, limits.account, now);
}

export async function enforceGuestOtpRateLimits(
  deps: AppDependencies,
  request: FastifyRequest,
  normalizedEmail: string,
): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  await increment(deps, "guest_otp:ip", request.ip, { max: 15, windowMs: 60 * 60_000 }, now);
  await increment(deps, "guest_otp:email", normalizedEmail, { max: 5, windowMs: 60 * 60_000 }, now);
}

export async function enforceGuestApplicationRateLimit(
  deps: AppDependencies,
  request: FastifyRequest,
): Promise<void> {
  await increment(deps, "guest_application:ip", request.ip, { max: 20, windowMs: 24 * 60 * 60_000 }, (deps.now ?? (() => new Date()))());
}

/** Removes expired fixed-window buckets; the raw identifiers were never stored. */
export async function cleanupAuthRateLimits(
  db: Database,
  now: Date = new Date(),
  staleAfterMs = 24 * 60 * 60_000,
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const deleted = await db.delete(authRateLimits).where(lt(authRateLimits.windowStartedAt, cutoff)).returning({ keyHash: authRateLimits.keyHash });
  return deleted.length;
}
