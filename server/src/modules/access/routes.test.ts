import argon2 from "argon2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applications, agencies, agencyMemberships, properties, sessions, users } from "../../db/schema.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { createTestApp } from "../../test/test-app.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const ids = {
  agencyA: "11111111-1111-4111-8111-111111111111", agencyB: "22222222-2222-4222-8222-222222222222",
  adminA: "11111111-1111-4111-8111-111111111112", adminB: "22222222-2222-4222-8222-222222222223",
  tenantA: "33333333-3333-4333-8333-333333333333", tenantB: "44444444-4444-4444-8444-444444444444",
  propertyA: "55555555-5555-4555-8555-555555555555", propertyB: "66666666-6666-4666-8666-666666666666",
  applicationA: "77777777-7777-4777-8777-777777777777", applicationB: "88888888-8888-4888-8888-888888888888",
};

beforeEach(async () => {
  context = await createTestApp();
  const now = new Date();
  const passwordHash = await argon2.hash("test-password");
  await context.db.insert(users).values([
    { id: ids.adminA, kind: "agency", email: "a@example.es", fullName: "Admin A", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: ids.adminB, kind: "agency", email: "b@example.es", fullName: "Admin B", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: ids.tenantA, kind: "tenant", email: "ta@example.es", fullName: "Tenant A", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
    { id: ids.tenantB, kind: "tenant", email: "tb@example.es", fullName: "Tenant B", passwordHash, emailVerifiedAt: now, createdAt: now, updatedAt: now },
  ]);
  await context.db.insert(agencies).values([
    { id: ids.agencyA, name: "Agency A", createdAt: now, updatedAt: now },
    { id: ids.agencyB, name: "Agency B", createdAt: now, updatedAt: now },
  ]);
  await context.db.insert(agencyMemberships).values([
    { agencyId: ids.agencyA, userId: ids.adminA, role: "admin", createdAt: now },
    { agencyId: ids.agencyB, userId: ids.adminB, role: "admin", createdAt: now },
  ]);
  await context.db.insert(properties).values([
    { id: ids.propertyA, agencyId: ids.agencyA, internalReference: "A", title: "Property A", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, createdAt: now, updatedAt: now },
    { id: ids.propertyB, agencyId: ids.agencyB, internalReference: "B", title: "Property B", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, createdAt: now, updatedAt: now },
  ]);
  await context.db.insert(applications).values([
    { id: ids.applicationA, agencyId: ids.agencyA, propertyId: ids.propertyA, tenantUserId: ids.tenantA, createdAt: now, updatedAt: now },
    { id: ids.applicationB, agencyId: ids.agencyB, propertyId: ids.propertyB, tenantUserId: ids.tenantB, createdAt: now, updatedAt: now },
  ]);
  for (const [userId, token] of [[ids.adminA, "admin-a-token"], [ids.tenantA, "tenant-a-token"]] as const) {
    await context.db.insert(sessions).values({ id: newId(), userId, tokenHash: hashSecret(token), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000) });
  }
});
afterEach(async () => context.close());

describe("tenant isolation", () => {
  it("returns 404 when an agency requests another agency's property", async () => {
    const own = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyA}`, headers: { cookie: "inquilink_session=admin-a-token" } });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.property).not.toHaveProperty("publicLinkTokenHash");
    expect(own.json().data.property).not.toHaveProperty("publicLinkTokenCiphertext");
    const foreign = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyB}`, headers: { cookie: "inquilink_session=admin-a-token" } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("PROPERTY_NOT_FOUND");
  });

  it("returns 404 when a tenant requests another tenant's application", async () => {
    const own = await context.app.inject({ method: "GET", url: `/api/v1/tenant/applications/${ids.applicationA}`, headers: { cookie: "inquilink_session=tenant-a-token" } });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.application).not.toHaveProperty("sourceLinkTokenHash");
    expect(own.json().data.application).not.toHaveProperty("submissionKeyHash");
    const foreign = await context.app.inject({ method: "GET", url: `/api/v1/tenant/applications/${ids.applicationB}`, headers: { cookie: "inquilink_session=tenant-a-token" } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("APPLICATION_NOT_FOUND");
  });
});
