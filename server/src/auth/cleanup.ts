import { and, asc, inArray, isNotNull, lte, or } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { oneTimeTokens, sessions } from "../db/schema.js";

export interface AuthArtifactCleanupResult {
  sessionsDeleted: number;
  tokensDeleted: number;
}

/**
 * Deletes due authentication artifacts in bounded batches. Used one-time tokens
 * remain briefly for replay/audit detection, while their return path is scrubbed
 * at consumption time by the auth routes.
 */
export async function cleanupAuthArtifacts(
  db: Database,
  now: Date = new Date(),
  options: { batchSize?: number; usedTokenRetentionMs?: number } = {},
): Promise<AuthArtifactCleanupResult> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 500, 5_000));
  const usedCutoff = new Date(now.getTime() - (options.usedTokenRetentionMs ?? 24 * 60 * 60_000));

  const expiredSessions = await db.select({ id: sessions.id }).from(sessions)
    .where(lte(sessions.expiresAt, now)).orderBy(asc(sessions.expiresAt), asc(sessions.id)).limit(batchSize);
  const deletedSessions = expiredSessions.length
    ? await db.delete(sessions).where(inArray(sessions.id, expiredSessions.map((row) => row.id))).returning({ id: sessions.id })
    : [];

  const dueTokens = await db.select({ id: oneTimeTokens.id }).from(oneTimeTokens)
    .where(or(
      lte(oneTimeTokens.expiresAt, now),
      and(isNotNull(oneTimeTokens.usedAt), lte(oneTimeTokens.usedAt, usedCutoff)),
    ))
    .orderBy(asc(oneTimeTokens.expiresAt), asc(oneTimeTokens.id)).limit(batchSize);
  const deletedTokens = dueTokens.length
    ? await db.delete(oneTimeTokens).where(inArray(oneTimeTokens.id, dueTokens.map((row) => row.id))).returning({ id: oneTimeTokens.id })
    : [];

  return { sessionsDeleted: deletedSessions.length, tokensDeleted: deletedTokens.length };
}
