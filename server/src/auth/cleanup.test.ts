import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oneTimeTokens, sessions, users } from "../db/schema.js";
import { hashSecret, newId } from "../lib/ids.js";
import { createTestApp } from "../test/test-app.js";
import { cleanupAuthArtifacts } from "./cleanup.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const now = new Date("2026-08-08T10:00:00.000Z");

beforeEach(async () => { context = await createTestApp({}, () => now); });
afterEach(async () => context.close());

describe("authentication artifact cleanup", () => {
  it("deletes only expired sessions and expired or sufficiently old used tokens", async () => {
    const userId = newId();
    await context.db.insert(users).values({
      id: userId, kind: "tenant", email: "cleanup@example.es", fullName: "Cleanup",
      passwordHash: "hash", emailVerifiedAt: now, createdAt: now, updatedAt: now,
    });
    await context.db.insert(sessions).values([
      { id: "expired-session", userId, tokenHash: hashSecret("expired-session"), expiresAt: new Date(now.getTime() - 1), lastSeenAt: now, createdAt: now },
      { id: "live-session", userId, tokenHash: hashSecret("live-session"), expiresAt: new Date(now.getTime() + 60_000), lastSeenAt: now, createdAt: now },
    ]);
    await context.db.insert(oneTimeTokens).values([
      { id: "expired-token", userId, kind: "verify_email", tokenHash: hashSecret("expired-token"), returnPath: "/private-expired", expiresAt: new Date(now.getTime() - 1), createdAt: now },
      { id: "old-used-token", userId, kind: "reset_password", tokenHash: hashSecret("old-used-token"), returnPath: null, expiresAt: new Date(now.getTime() + 60_000), usedAt: new Date(now.getTime() - 24 * 60 * 60_000 - 1), createdAt: now },
      { id: "recent-used-token", userId, kind: "reset_password", tokenHash: hashSecret("recent-used-token"), returnPath: null, expiresAt: new Date(now.getTime() + 60_000), usedAt: new Date(now.getTime() - 60_000), createdAt: now },
      { id: "live-token", userId, kind: "verify_email", tokenHash: hashSecret("live-token"), returnPath: "/live", expiresAt: new Date(now.getTime() + 60_000), createdAt: now },
    ]);

    await expect(cleanupAuthArtifacts(context.db, now)).resolves.toEqual({ sessionsDeleted: 1, tokensDeleted: 2 });
    expect((await context.db.select({ id: sessions.id }).from(sessions)).map((row) => row.id)).toEqual(["live-session"]);
    expect((await context.db.select({ id: oneTimeTokens.id }).from(oneTimeTokens)).map((row) => row.id).sort()).toEqual(["live-token", "recent-used-token"]);
    expect(await context.db.select().from(oneTimeTokens).where(eq(oneTimeTokens.id, "expired-token"))).toHaveLength(0);
  });
});
