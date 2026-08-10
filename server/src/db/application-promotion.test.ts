import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { agencies, applications, properties, users } from "./schema.js";
import { createTestApp } from "../test/test-app.js";
import type { Database } from "./client.js";
import { backfillSubmittedApplicationColumns } from "./application-scale-migration.js";

let context: Awaited<ReturnType<typeof createTestApp>>;

beforeEach(async () => { context = await createTestApp(); });
afterEach(async () => context.close());

it("backfills valid submitted application fields without changing draft JSON or failing on malformed legacy values", async () => {
  const at = new Date("2026-08-08T10:00:00.000Z");
  const agencyId = "95000000-0000-4000-8000-000000000001";
  const propertyId = "95000000-0000-4000-8000-000000000002";
  const validTenantId = "95000000-0000-4000-8000-000000000003";
  const malformedTenantId = "95000000-0000-4000-8000-000000000004";
  const lateTenantId = "95000000-0000-4000-8000-000000000007";
  const passwordHash = "not-used-by-this-migration-test";
  const coApplicantId = "95000000-0000-4000-8000-000000000008";
  const validDraft = { fullName: "Válida", email: "VALID@EXAMPLE.ES", phone: "+34612345678", employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Indefinido", individualNetMonthlyIncomeCents: 250_000, householdNetMonthlyIncomeCents: 420_000, adultOccupants: 2, minorOccupants: 1, intendedMoveInDate: "2026-10-01", message: "Preservar", additionalAdults: [{ id: coApplicantId, fullName: "Co Applicant", email: "CO@EXAMPLE.ES", phone: "+34699888777", employmentStatus: "Autónomo", employerOrActivity: "Estudio", contractType: "Autónomo", netMonthlyIncomeCents: 170_000 }] };
  const duplicatedLegacyAdult = { id: "95000000-0000-4000-8000-000000000009", fullName: "Duplicada", email: "duplicate@example.es", phone: "+34611222333", employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Indefinido", netMonthlyIncomeCents: 100_000 };
  const malformedDraft = { email: "not-an-email", phone: "no-es-un-telefono", individualNetMonthlyIncomeCents: "mucho", householdNetMonthlyIncomeCents: 999_999_999, adultOccupants: 0, minorOccupants: 99, intendedMoveInDate: "2026-02-31", additionalAdults: [null, { id: "not-a-uuid", fullName: "Inválida" }, duplicatedLegacyAdult, { ...duplicatedLegacyAdult, fullName: "También duplicada" }] };
  await context.db.insert(users).values([
    { id: validTenantId, kind: "tenant", email: "valid@example.es", fullName: "Válida", passwordHash, createdAt: at, updatedAt: at },
    { id: malformedTenantId, kind: "tenant", email: "malformed@example.es", fullName: "Legado", passwordHash, createdAt: at, updatedAt: at },
    { id: lateTenantId, kind: "tenant", email: "late@example.es", fullName: "Tardía", passwordHash, createdAt: at, updatedAt: at },
  ]);
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia", createdAt: at, updatedAt: at });
  await context.db.insert(properties).values({ id: propertyId, agencyId, internalReference: "BACKFILL", title: "Piso", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, createdAt: at, updatedAt: at });
  await context.db.insert(applications).values([
    { id: "95000000-0000-4000-8000-000000000005", agencyId, propertyId, tenantUserId: validTenantId, submittedAt: at, draftData: validDraft, createdAt: at, updatedAt: at },
    { id: "95000000-0000-4000-8000-000000000006", agencyId, propertyId, tenantUserId: malformedTenantId, submittedAt: at, draftData: malformedDraft, createdAt: at, updatedAt: at },
  ]);
  // Recreate rows that predate the compatibility trigger. Updating only the
  // promoted columns does not fire its submitted_at/draft_data trigger.
  await context.db.update(applications).set({
    phone: null, individualNetMonthlyIncomeCents: null, householdNetMonthlyIncomeCents: null,
    adultOccupants: null, minorOccupants: null, intendedMoveInDate: null,
    normalizedPhone: null, normalizedEmail: null, adultProfiles: [],
    applicationDataPromotedAt: null,
  }).where(eq(applications.agencyId, agencyId));

  const execute = context.db.execute.bind(context.db) as (query: unknown) => Promise<unknown>;
  let batches = 0;
  const migrationDb = {
    execute: async (query: unknown) => {
      const result = await execute(query);
      batches += 1;
      if (batches === 1) {
        // Simulate an older application instance submitting a lower UUID after
        // the first batch. Marker-driven selection must still reconcile it.
        await context.db.insert(applications).values({
          id: "05000000-0000-4000-8000-000000000001", agencyId, propertyId,
          tenantUserId: lateTenantId, submittedAt: at, draftData: validDraft,
          createdAt: at, updatedAt: at,
        });
        await context.db.update(applications).set({
          phone: null, individualNetMonthlyIncomeCents: null, householdNetMonthlyIncomeCents: null,
          adultOccupants: null, minorOccupants: null, intendedMoveInDate: null,
          normalizedPhone: null, normalizedEmail: null, adultProfiles: [],
          applicationDataPromotedAt: null,
        }).where(eq(applications.tenantUserId, lateTenantId));
      }
      return result;
    },
  } as unknown as Database;

  expect(await backfillSubmittedApplicationColumns(migrationDb, 1)).toBe(3);
  expect(await backfillSubmittedApplicationColumns(context.db as unknown as Database, 1)).toBe(0);

  const valid = (await context.db.select().from(applications).where(eq(applications.tenantUserId, validTenantId)))[0]!;
  expect(valid).toMatchObject({
    phone: "+34612345678", individualNetMonthlyIncomeCents: 250_000, householdNetMonthlyIncomeCents: 420_000,
    adultOccupants: 2, minorOccupants: 1, intendedMoveInDate: "2026-10-01", applicationDataPromotedAt: expect.any(Date), draftData: validDraft,
    normalizedPhone: "34612345678", normalizedEmail: "valid@example.es",
  });
  expect(valid.adultProfiles).toEqual([
    expect.objectContaining({ id: "primary", isPrimary: true, email: "valid@example.es", netMonthlyIncomeCents: 250_000 }),
    expect.objectContaining({ id: coApplicantId, isPrimary: false, email: "co@example.es", netMonthlyIncomeCents: 170_000 }),
  ]);
  const malformed = (await context.db.select().from(applications).where(eq(applications.tenantUserId, malformedTenantId)))[0]!;
  expect(malformed).toMatchObject({
    phone: null, individualNetMonthlyIncomeCents: null, householdNetMonthlyIncomeCents: null,
    adultOccupants: null, minorOccupants: null, intendedMoveInDate: null, normalizedPhone: null, normalizedEmail: "malformed@example.es", applicationDataPromotedAt: expect.any(Date), draftData: malformedDraft,
  });
  expect(malformed.adultProfiles).toEqual([expect.objectContaining({ id: "primary", email: "malformed@example.es", phone: null })]);
  const late = (await context.db.select().from(applications).where(eq(applications.tenantUserId, lateTenantId)))[0]!;
  expect(late).toMatchObject({ phone: "+34612345678", normalizedPhone: "34612345678", normalizedEmail: "valid@example.es", applicationDataPromotedAt: expect.any(Date), draftData: validDraft });
  expect(late.adultProfiles).toHaveLength(2);
});

it("promotes a legacy submission written after the one-shot backfill has completed", async () => {
  const at = new Date("2026-08-08T10:00:00.000Z");
  const agencyId = "96000000-0000-4000-8000-000000000001";
  const propertyId = "96000000-0000-4000-8000-000000000002";
  const tenantId = "96000000-0000-4000-8000-000000000003";
  const invalidTenantId = "96000000-0000-4000-8000-000000000006";
  const draftData = {
    fullName: "Rolling", email: "ROLLING@EXAMPLE.ES", phone: "+34698765432", employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Indefinido", individualNetMonthlyIncomeCents: 210_000,
    householdNetMonthlyIncomeCents: 360_000, adultOccupants: 2,
    minorOccupants: 0, intendedMoveInDate: "2026-11-15",
    additionalAdults: [
      { id: "96000000-0000-4000-8000-000000000005", fullName: "Otra persona", email: null, phone: null, employmentStatus: "Pensionista", employerOrActivity: "Seguridad Social", contractType: "Pensión", netMonthlyIncomeCents: 120_000 },
      null,
      { id: "bad-id", fullName: "Inválida", employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Temporal", netMonthlyIncomeCents: 90_000 },
      { id: "96000000-0000-4000-8000-000000000009", fullName: "Duplicada", email: null, phone: null, employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Temporal", netMonthlyIncomeCents: 90_000 },
      { id: "96000000-0000-4000-8000-000000000009", fullName: "Duplicada otra vez", email: null, phone: null, employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Temporal", netMonthlyIncomeCents: 90_000 },
    ],
  };
  await context.db.insert(users).values([
    { id: tenantId, kind: "tenant", email: "rolling@example.es", fullName: "Rolling", passwordHash: "unused", createdAt: at, updatedAt: at },
    { id: invalidTenantId, kind: "tenant", email: "invalid-date@example.es", fullName: "Fecha inválida", passwordHash: "unused", createdAt: at, updatedAt: at },
  ]);
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia rolling", createdAt: at, updatedAt: at });
  await context.db.insert(properties).values({ id: propertyId, agencyId, internalReference: "ROLLING", title: "Piso", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, createdAt: at, updatedAt: at });

  expect(await backfillSubmittedApplicationColumns(context.db as unknown as Database, 1)).toBe(0);
  // This shape models an old instance: it writes only submitted_at + draft JSON.
  await context.db.insert(applications).values({ id: "96000000-0000-4000-8000-000000000004", agencyId, propertyId, tenantUserId: tenantId, submittedAt: at, draftData, createdAt: at, updatedAt: at });
  await context.db.insert(applications).values({ id: "96000000-0000-4000-8000-000000000007", agencyId, propertyId, tenantUserId: invalidTenantId, submittedAt: at, draftData: { ...draftData, intendedMoveInDate: "0000-01-01" }, createdAt: at, updatedAt: at });

  const submitted = (await context.db.select().from(applications).where(eq(applications.tenantUserId, tenantId)))[0]!;
  expect(submitted).toMatchObject({
    phone: "+34698765432", individualNetMonthlyIncomeCents: 210_000,
    householdNetMonthlyIncomeCents: 360_000, adultOccupants: 2,
    minorOccupants: 0, intendedMoveInDate: "2026-11-15",
    normalizedPhone: "34698765432", normalizedEmail: "rolling@example.es",
    applicationDataPromotedAt: expect.any(Date), draftData,
  });
  expect(submitted.adultProfiles).toEqual([
    expect.objectContaining({ id: "primary", isPrimary: true, email: "rolling@example.es" }),
    expect.objectContaining({ id: "96000000-0000-4000-8000-000000000005", isPrimary: false }),
  ]);
  const invalidDate = (await context.db.select().from(applications).where(eq(applications.tenantUserId, invalidTenantId)))[0]!;
  expect(invalidDate).toMatchObject({ intendedMoveInDate: null, applicationDataPromotedAt: expect.any(Date) });
  expect(invalidDate.adultProfiles).toHaveLength(2);
});
