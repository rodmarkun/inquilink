import { describe, expect, it } from "vitest";
import type { AppDependencies } from "../types.js";
import { authRateLimits } from "../db/schema.js";
import { cleanupAuthRateLimits } from "./rate-limit.js";
import { createTestApp } from "../test/test-app.js";
import { enforceAuthRateLimits } from "./rate-limit.js";

describe("distributed authentication throttling", () => {
  it("cleans only expired rate-limit buckets", async () => {
    const context = await createTestApp();
    try {
      const now = new Date("2026-08-08T12:00:00.000Z");
      await context.db.insert(authRateLimits).values([
        { keyHash: "stale", scope: "login:ip", windowStartedAt: new Date("2026-08-06T00:00:00.000Z"), count: 1, updatedAt: now },
        { keyHash: "fresh", scope: "login:ip", windowStartedAt: new Date("2026-08-08T11:00:00.000Z"), count: 1, updatedAt: now },
      ]);
      expect(await cleanupAuthRateLimits(context.db, now)).toBe(1);
      expect((await context.db.select().from(authRateLimits)).map((row) => row.keyHash)).toEqual(["fresh"]);
    } finally {
      await context.close();
    }
  });
  it("limits hashed account buckets without storing the account or IP", async () => {
    const context = await createTestApp();
    try {
      const deps = {
        db: context.db,
        now: () => new Date("2026-08-08T10:00:00.000Z"),
      } as AppDependencies;
      const request = { ip: "203.0.113.42" } as Parameters<typeof enforceAuthRateLimits>[1];
      for (let index = 0; index < 20; index += 1) {
        await enforceAuthRateLimits(deps, request, "login", "tenant:persona@example.es");
      }
      await expect(enforceAuthRateLimits(deps, request, "login", "tenant:persona@example.es"))
        .rejects.toMatchObject({ statusCode: 429, code: "AUTH_RATE_LIMITED" });
      const serialized = JSON.stringify(await context.db.select().from(authRateLimits));
      expect(serialized).not.toContain("persona@example.es");
      expect(serialized).not.toContain("203.0.113.42");
    } finally {
      await context.close();
    }
  });
});
