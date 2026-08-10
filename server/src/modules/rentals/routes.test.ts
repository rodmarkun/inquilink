import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agencies,
  agencyMemberships,
  applicationDocuments,
  applicationNotes,
  applications,
  applicationStatusHistory,
  appointments,
  auditEvents,
  documentStorageCleanup,
  emailOutbox,
  properties,
  sessions,
  subscriptions,
  users,
} from "../../db/schema.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { createTestApp } from "../../test/test-app.js";
import { MemoryPrivateDocumentStorage, type PrivateDocumentStorage, type StoredObject } from "./storage.js";
import { runDataLifecycle } from "./lifecycle.js";
import { AGENCY_RENTAL_MUTATION_ROUTES } from "./routes.js";
import { AesGcmPublicLinkTokenVault } from "./public-link-vault.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
let storage: FailingDeleteStorage;
let applicationWriteGate: { operation: "draft" | "submit"; entered: () => void; released: Promise<void> } | null;
let agencyWriteGate: { operation: "property" | "applicant" | "document_access" | "appointment"; entered: () => void; released: Promise<void> } | null;
let agencySensitiveReadGate: { entered: () => void; released: Promise<void> } | null;
let documentStateWriteGate: { entered: () => void; released: Promise<void> } | null;

function blockApplicationWrite(operation: "draft" | "submit"): { entered: Promise<void>; release: () => void } {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  applicationWriteGate = { operation, entered: markEntered, released };
  return { entered, release };
}

function blockAgencyWrite(operation: "property" | "applicant" | "document_access" | "appointment"): { entered: Promise<void>; release: () => void } {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  agencyWriteGate = { operation, entered: markEntered, released };
  return { entered, release };
}

function blockAgencySensitiveRead(): { entered: Promise<void>; release: () => void } {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  agencySensitiveReadGate = { entered: markEntered, released };
  return { entered, release };
}

function blockDocumentStateWrite(): { entered: Promise<void>; release: () => void } {
  let markEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  documentStateWriteGate = { entered: markEntered, released };
  return { entered, release };
}

class FailingDeleteStorage implements PrivateDocumentStorage {
  private readonly delegate = new MemoryPrivateDocumentStorage();
  private barrier: { entered: () => void; released: Promise<void> } | null = null;
  private putBarrier: { entered: () => void; released: Promise<void> } | null = null;
  failNextDelete = false;
  failNextPutAfterWrite = false;
  blockNextDelete(): { entered: Promise<void>; release: () => void } {
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.barrier = { entered: markEntered, released };
    return { entered, release };
  }
  blockNextPut(): { entered: Promise<void>; release: () => void } {
    let markEntered!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.putBarrier = { entered: markEntered, released };
    return { entered, release };
  }
  async put(input: { key: string; body: Buffer; contentType: "application/pdf" | "image/jpeg" | "image/png" }): Promise<void> {
    if (this.putBarrier) {
      const barrier = this.putBarrier;
      this.putBarrier = null;
      barrier.entered();
      await barrier.released;
    }
    await this.delegate.put(input);
    if (this.failNextPutAfterWrite) {
      this.failNextPutAfterWrite = false;
      throw new Error("AMBIGUOUS_STORAGE_PUT_FAILURE");
    }
  }
  get(key: string): Promise<StoredObject | null> { return this.delegate.get(key); }
  async delete(key: string): Promise<void> {
    if (this.barrier) {
      const barrier = this.barrier;
      this.barrier = null;
      barrier.entered();
      await barrier.released;
    }
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("DOCUMENT_STORAGE_DELETE_FAILED");
    }
    await this.delegate.delete(key);
  }
}

const ids = {
  agencyA: "10000000-0000-4000-8000-000000000001",
  agencyB: "20000000-0000-4000-8000-000000000001",
  adminA: "10000000-0000-4000-8000-000000000002",
  collaboratorA: "10000000-0000-4000-8000-000000000003",
  adminB: "20000000-0000-4000-8000-000000000002",
  tenantA: "30000000-0000-4000-8000-000000000001",
  tenantB: "40000000-0000-4000-8000-000000000001",
  propertyA: "50000000-0000-4000-8000-000000000001",
  propertyB: "60000000-0000-4000-8000-000000000001",
  applicationA: "70000000-0000-4000-8000-000000000001",
} as const;

const cookies = {
  adminA: "inquilink_session=workflow-admin-a",
  collaboratorA: "inquilink_session=workflow-collaborator-a",
  adminB: "inquilink_session=workflow-admin-b",
  tenantA: "inquilink_session=workflow-tenant-a",
  tenantB: "inquilink_session=workflow-tenant-b",
};

const publishedProperty = {
  address: "Calle de Galileo, 41",
  postalCode: "28015",
  propertyType: "Piso",
  bedrooms: 2,
  bathrooms: 1,
  floorAreaSqm: 78,
  availableFrom: "2026-10-01",
  description: "Vivienda exterior reformada.",
  publicLocation: "Trafalgar, Madrid",
  requestedDocumentCategories: ["payslips", "employment_contract"],
} as const;

const completeApplication = {
  fullName: "Lucía Martín",
  email: "lucia@example.es",
  phone: "+34612144309",
  preferredContactChannel: "whatsapp",
  adultOccupants: 1,
  minorOccupants: 0,
  intendedMoveInDate: "2026-10-01",
  pets: "no",
  petDetails: null,
  message: "Buscamos un piso tranquilo.",
  employmentStatus: "Trabajo por cuenta ajena",
  employerOrActivity: "Cobalto Studio",
  contractType: "Indefinido",
  individualNetMonthlyIncomeCents: 250_000,
  householdNetMonthlyIncomeCents: 420_000,
  guarantorAvailability: "no",
  viewingAvailability: ["Entre semana por la tarde"],
  availabilityNote: "A partir de las 18:00",
  marketingConsent: false,
} as const;

async function createSession(userId: string, token: string) {
  const createdAt = new Date("2026-08-08T10:00:00.000Z");
  await context.db.insert(sessions).values({ id: newId(), userId, tokenHash: hashSecret(token), createdAt, lastSeenAt: createdAt, expiresAt: new Date("2099-01-01T00:00:00.000Z") });
}

beforeEach(async () => {
  storage = new FailingDeleteStorage();
  applicationWriteGate = null;
  agencyWriteGate = null;
  agencySensitiveReadGate = null;
  documentStateWriteGate = null;
  context = await createTestApp({}, undefined, { rentals: {
    storage,
    beforeApplicationWrite: async (operation) => {
      if (!applicationWriteGate || applicationWriteGate.operation !== operation) return;
      const gate = applicationWriteGate;
      applicationWriteGate = null;
      gate.entered();
      await gate.released;
    },
    beforeAgencyWrite: async (operation) => {
      if (!agencyWriteGate || agencyWriteGate.operation !== operation) return;
      const gate = agencyWriteGate;
      agencyWriteGate = null;
      gate.entered();
      await gate.released;
    },
    beforeAgencySensitiveRead: async () => {
      if (!agencySensitiveReadGate) return;
      const gate = agencySensitiveReadGate;
      agencySensitiveReadGate = null;
      gate.entered();
      await gate.released;
    },
    beforeDocumentStateWrite: async () => {
      if (!documentStateWriteGate) return;
      const gate = documentStateWriteGate;
      documentStateWriteGate = null;
      gate.entered();
      await gate.released;
    },
  } });
  const createdAt = new Date("2026-08-08T10:00:00.000Z");
  const passwordHash = await argon2.hash("test-password");
  const publicLinkVault = new AesGcmPublicLinkTokenVault("test-public-link-vault-secret-32-bytes-minimum");
  await context.db.insert(users).values([
    { id: ids.adminA, kind: "agency", email: "admin-a@example.es", fullName: "Marta Soler", passwordHash, emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt },
    { id: ids.collaboratorA, kind: "agency", email: "collab-a@example.es", fullName: "Diego García", passwordHash, emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt },
    { id: ids.adminB, kind: "agency", email: "admin-b@example.es", fullName: "Laura Torres", passwordHash, emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt },
    { id: ids.tenantA, kind: "tenant", email: "lucia@example.es", fullName: "Lucía Martín", passwordHash, emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt },
    { id: ids.tenantB, kind: "tenant", email: "other@example.es", fullName: "Otro Inquilino", passwordHash, emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt },
  ]);
  await context.db.insert(agencies).values([
    { id: ids.agencyA, name: "Albor Inmobiliaria", createdAt, updatedAt: createdAt },
    { id: ids.agencyB, name: "Otra Agencia", createdAt, updatedAt: createdAt },
  ]);
  await context.db.insert(agencyMemberships).values([
    { agencyId: ids.agencyA, userId: ids.adminA, role: "admin", createdAt },
    { agencyId: ids.agencyA, userId: ids.collaboratorA, role: "collaborator", createdAt },
    { agencyId: ids.agencyB, userId: ids.adminB, role: "admin", createdAt },
  ]);
  await context.db.insert(properties).values([
    { id: ids.propertyA, agencyId: ids.agencyA, responsibleUserId: ids.adminA, internalReference: "MAD-042", title: "Piso luminoso en Chamberí", city: "Madrid", province: "Madrid", monthlyRentCents: 145_000, state: "published", publicLinkTokenHash: hashSecret("valid-chamberi-public-link"), publicLinkTokenCiphertext: publicLinkVault.seal(ids.propertyA, "valid-chamberi-public-link"), publicLinkIssuedAt: createdAt, ...publishedProperty, createdAt, updatedAt: createdAt },
    { id: ids.propertyB, agencyId: ids.agencyB, responsibleUserId: ids.adminB, internalReference: "MAD-999", title: "Vivienda de otra agencia", city: "Madrid", province: "Madrid", monthlyRentCents: 120_000, state: "published", publicLinkTokenHash: hashSecret("other-agency-public-link"), publicLinkTokenCiphertext: publicLinkVault.seal(ids.propertyB, "other-agency-public-link"), publicLinkIssuedAt: createdAt, ...publishedProperty, createdAt, updatedAt: createdAt },
  ]);
  await context.db.insert(subscriptions).values([
    { id: "10000000-0000-4000-8000-000000000090", agencyId: ids.agencyA, plan: "inmobiliaria", state: "active", createdAt, updatedAt: createdAt },
    { id: "20000000-0000-4000-8000-000000000090", agencyId: ids.agencyB, plan: "inmobiliaria", state: "active", createdAt, updatedAt: createdAt },
  ]);
  await Promise.all([
    createSession(ids.adminA, "workflow-admin-a"), createSession(ids.collaboratorA, "workflow-collaborator-a"),
    createSession(ids.adminB, "workflow-admin-b"), createSession(ids.tenantA, "workflow-tenant-a"), createSession(ids.tenantB, "workflow-tenant-b"),
  ]);
});

afterEach(async () => context.close());

describe("property and public-link lifecycle", () => {
  it("keeps an explicit audit list of every agency rental mutation surface", () => {
    expect(AGENCY_RENTAL_MUTATION_ROUTES).toEqual([
      "POST /api/v1/agency/properties", "PATCH /api/v1/agency/properties/:propertyId",
      "POST /api/v1/agency/properties/:propertyId/publish", "POST /api/v1/agency/properties/:propertyId/pause",
      "POST /api/v1/agency/properties/:propertyId/archive", "POST /api/v1/agency/properties/:propertyId/public-link/regenerate",
      "DELETE /api/v1/agency/properties/:propertyId/public-link", "PATCH /api/v1/agency/applications/:applicationId/status",
      "PATCH /api/v1/agency/applications/:applicationId/responsible-user", "POST /api/v1/agency/applications/:applicationId/notes",
      "POST /api/v1/agency/applications/:applicationId/whatsapp", "POST /api/v1/agency/applications/:applicationId/documents/:documentId/access",
      "GET /api/v1/documents/:documentId/content (agency audit write)", "POST /api/v1/agency/appointments",
      "PATCH /api/v1/agency/appointments/:appointmentId",
    ]);
  });

  it("lets agency closure win over a property mutation authenticated just before closure", async () => {
    const gate = blockAgencyWrite("property");
    const mutation = context.app.inject({ method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA }, payload: {
      internalReference: "RACE-001", title: "Piso en carrera", address: "Calle Mayor, 1", city: "Madrid", province: "Madrid", postalCode: "28001",
      propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 50, availableFrom: "2026-12-01", description: "No debe guardarse.", publicLocation: "Centro, Madrid",
      coverImageUrl: null, galleryUrls: [], monthlyRentCents: 100_000, responsibleUserId: null, requestedDocumentCategories: [],
    } });
    await gate.entered;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.adminA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    gate.release();
    const response = await mutation;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AGENCY_CLOSURE_IN_PROGRESS");
    expect(await context.db.select().from(properties).where(eq(properties.internalReference, "RACE-001"))).toHaveLength(0);
  });

  it("rechecks responsibility membership after the agency lock so removal wins", async () => {
    const gate = blockAgencyWrite("property");
    const mutation = context.app.inject({ method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA }, payload: {
      internalReference: "MEMBER-RACE", title: "Piso con responsable", address: "Calle Mayor, 2", city: "Madrid", province: "Madrid", postalCode: "28001",
      propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 50, availableFrom: "2026-12-01", description: "No debe guardarse.", publicLocation: "Centro, Madrid",
      coverImageUrl: null, galleryUrls: [], monthlyRentCents: 100_000, responsibleUserId: ids.collaboratorA, requestedDocumentCategories: [],
    } });
    await gate.entered;
    const removed = await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${ids.collaboratorA}`, headers: { cookie: cookies.adminA } });
    expect(removed.statusCode).toBe(204);
    gate.release();
    const response = await mutation;
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_RESPONSIBLE_USER");
    expect(await context.db.select().from(properties).where(eq(properties.internalReference, "MEMBER-RACE"))).toHaveLength(0);
  });

  it("rejects a stale removed collaborator after the agency lock", async () => {
    const gate = blockAgencyWrite("property");
    const mutation = context.app.inject({ method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.collaboratorA }, payload: {
      internalReference: "CALLER-RACE", title: "Piso de sesión obsoleta", address: "Calle Mayor, 3", city: "Madrid", province: "Madrid", postalCode: "28001",
      propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 50, availableFrom: "2026-12-01", description: "No debe guardarse.", publicLocation: "Centro, Madrid",
      coverImageUrl: null, galleryUrls: [], monthlyRentCents: 100_000, responsibleUserId: null, requestedDocumentCategories: [],
    } });
    await gate.entered;
    expect((await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${ids.collaboratorA}`, headers: { cookie: cookies.adminA } })).statusCode).toBe(204);
    gate.release();
    const response = await mutation;
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AGENCY_ACCESS_CHANGED");
    expect(await context.db.select().from(properties).where(eq(properties.internalReference, "CALLER-RACE"))).toHaveLength(0);
  });

  it("retires public, draft, and submission access immediately when the agency closes", async () => {
    const before = await context.app.inject({ method: "GET", url: "/api/v1/public/properties/valid-chamberi-public-link" });
    expect(before.statusCode).toBe(200);
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.adminA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    for (const response of await Promise.all([
      context.app.inject({ method: "GET", url: "/api/v1/public/properties/valid-chamberi-public-link" }),
      context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "No debe guardarse" } }),
      context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: {} }),
    ])) {
      expect(response.statusCode).toBe(410);
      expect(response.json().error.code).toBe("AGENCY_ACCOUNT_CLOSED");
    }
    expect(await context.db.select().from(applications)).toHaveLength(0);
  });

  it("creates, edits, publishes, pauses, republishes, and archives an agency-scoped property", async () => {
    const create = await context.app.inject({ method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA }, payload: {
      internalReference: "MAD-051", title: "Estudio reformado en Malasaña", address: "Calle de la Palma, 22", city: "Madrid", province: "Madrid", postalCode: "28004",
      propertyType: "Estudio", bedrooms: 1, bathrooms: 1, floorAreaSqm: 38, availableFrom: "2026-11-01", description: "Estudio exterior reformado.", publicLocation: "Malasaña, Madrid",
      coverImageUrl: "https://example.test/cover.jpg", galleryUrls: ["https://example.test/gallery.jpg"], monthlyRentCents: 98_000, responsibleUserId: ids.collaboratorA, requestedDocumentCategories: ["payslips"],
    } });
    expect(create.statusCode).toBe(201);
    const propertyId = create.json().data.property.id as string;
    expect(create.json().data.property.state).toBe("draft");
    expect(create.json().data.property).not.toHaveProperty("publicLinkTokenHash");
    expect(create.json().data.property).not.toHaveProperty("publicLinkTokenCiphertext");

    const edit = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${propertyId}`, headers: { cookie: cookies.collaboratorA }, payload: { title: "Estudio exterior reformado en Malasaña" } });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().data.property.title).toContain("exterior");
    expect(edit.json().data.property.coverImageUrl).toBe("https://example.test/cover.jpg");
    expect(edit.json().data.property.galleryUrls).toEqual(["https://example.test/gallery.jpg"]);
    expect(edit.json().data.property.responsibleUserId).toBe(ids.collaboratorA);
    expect(edit.json().data.property.requestedDocumentCategories).toEqual(["payslips"]);
    const publish = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "property-publish-0001" }, payload: { expectedVersion: 1 } });
    expect(publish.statusCode).toBe(200);
    expect(publish.json().data.property).not.toHaveProperty("publicLinkTokenHash");
    expect(publish.json().data.property).not.toHaveProperty("publicLinkTokenCiphertext");
    expect(publish.json().data.publicLink).toMatch(/\/solicitud\/[A-Za-z0-9_-]{40,}$/);
    const originalLink = publish.json().data.publicLink;
    const publishRetry = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "property-publish-0001" }, payload: { expectedVersion: 1 } });
    expect(publishRetry.statusCode).toBe(200);
    expect(publishRetry.json().data).toMatchObject({ publicLink: originalLink, idempotentReplay: true });
    expect((await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${propertyId}/public-link`, headers: { cookie: cookies.adminA } })).json().data.publicLink).toBe(originalLink);
    expect((await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/pause`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 2 } })).statusCode).toBe(200);
    const republish = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "property-republish-0001" }, payload: { expectedVersion: 3 } });
    expect(republish.statusCode).toBe(200);
    expect(republish.json().data.publicLink).toBe(originalLink);
    expect(republish.json().data.linkRotated).toBe(false);
    const listed = await context.app.inject({ method: "GET", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA } });
    expect(listed.json().data.properties.every((row: { property: Record<string, unknown> }) => !("publicLinkTokenHash" in row.property) && !("publicLinkTokenCiphertext" in row.property))).toBe(true);
    expect((await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/archive`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 4 } })).statusCode).toBe(200);
    const cannotRepublish = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "property-publish-archived" }, payload: { expectedVersion: 5 } });
    expect(cannotRepublish.statusCode).toBe(409);
    const protectedEdit = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${propertyId}`, headers: { cookie: cookies.adminA }, payload: { title: "Estudio archivado", expectedVersion: 5 } });
    expect(protectedEdit.statusCode).toBe(200);
    expect(protectedEdit.json().data.property.version).toBe(6);
    const staleEdit = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${propertyId}`, headers: { cookie: cookies.adminA }, payload: { title: "Edición obsoleta", expectedVersion: 5 } });
    expect(staleEdit.statusCode).toBe(409);
    expect(staleEdit.json().error.code).toBe("PROPERTY_CHANGED");
  });

  it("serializes concurrent Particular publishes, counts paused listings, and blocks an over-limit downgrade", async () => {
    const createDraft = async (reference: string) => context.app.inject({
      method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA }, payload: {
        internalReference: reference, title: `Vivienda ${reference}`, address: "Calle Mayor, 10", city: "Madrid", province: "Madrid", postalCode: "28001",
        propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 55, availableFrom: "2026-12-01", description: "Vivienda lista para publicar.", publicLocation: "Centro, Madrid",
        coverImageUrl: null, galleryUrls: [], monthlyRentCents: 100_000, responsibleUserId: null, requestedDocumentCategories: [],
      },
    });
    const firstDraft = await createDraft("LIMIT-A");
    const secondDraft = await createDraft("LIMIT-B");
    const firstId = firstDraft.json().data.property.id as string;
    const secondId = secondDraft.json().data.property.id as string;
    await context.db.update(subscriptions).set({ plan: "particular", updatedAt: new Date() }).where(eq(subscriptions.agencyId, ids.agencyA));

    const raced = await Promise.all([
      context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${firstId}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "particular-publish-race-a" }, payload: { expectedVersion: 1 } }),
      context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${secondId}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "particular-publish-race-b" }, payload: { expectedVersion: 1 } }),
    ]);
    expect(raced.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(raced.find((response) => response.statusCode === 409)?.json().error.code).toBe("PLAN_LISTING_LIMIT_REACHED");
    const winner = raced[0]!.statusCode === 200 ? firstId : secondId;
    const loser = winner === firstId ? secondId : firstId;
    expect((await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${winner}/pause`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 2 } })).statusCode).toBe(200);
    const pausedStillCounts = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${loser}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "paused-still-counts-1" }, payload: { expectedVersion: 1 } });
    expect(pausedStillCounts.statusCode).toBe(409);
    expect(pausedStillCounts.json().error.code).toBe("PLAN_LISTING_LIMIT_REACHED");

    await context.db.update(subscriptions).set({ plan: "inmobiliaria", updatedAt: new Date() }).where(eq(subscriptions.agencyId, ids.agencyA));
    await context.db.insert(properties).values({
      id: "50000000-0000-4000-8000-000000000099", agencyId: ids.agencyA, internalReference: "OVER-LIMIT", title: "Anuncio conservado", city: "Madrid", province: "Madrid", monthlyRentCents: 110_000, state: "published", createdAt: new Date(), updatedAt: new Date(),
    });
    await context.db.update(subscriptions).set({ plan: "particular", updatedAt: new Date() }).where(eq(subscriptions.agencyId, ids.agencyA));
    const reactivation = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${winner}/publish`, headers: { cookie: cookies.adminA, "idempotency-key": "downgrade-reactivation-block" }, payload: { expectedVersion: 3 } });
    expect(reactivation.statusCode).toBe(409);
    expect(reactivation.json().error.code).toBe("PLAN_LISTING_LIMIT_REACHED");
    expect((await context.db.select().from(properties).where(eq(properties.id, winner)))[0]?.state).toBe("paused");
  });

  it("maps duplicate internal references on create and update to a stable Spanish conflict", async () => {
    const payload = {
      internalReference: "MAD-042", title: "Referencia repetida", address: "Calle Mayor, 4", city: "Madrid", province: "Madrid", postalCode: "28001",
      propertyType: "Piso", bedrooms: 1, bathrooms: 1, floorAreaSqm: 50, availableFrom: "2026-12-01", description: "Referencia duplicada.", publicLocation: "Centro, Madrid",
      coverImageUrl: null, galleryUrls: [], monthlyRentCents: 100_000, responsibleUserId: null, requestedDocumentCategories: [],
    };
    const duplicate = await context.app.inject({ method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA }, payload });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toMatchObject({ code: "PROPERTY_REFERENCE_EXISTS", message: "Ya existe un anuncio con esa referencia interna en la agencia." });
    const created = await context.app.inject({ method: "POST", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA }, payload: { ...payload, internalReference: "MAD-UNIQUE" } });
    expect(created.statusCode).toBe(201);
    const update = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${created.json().data.property.id}`, headers: { cookie: cookies.adminA }, payload: { internalReference: "MAD-042" } });
    expect(update.statusCode).toBe(409);
    expect(update.json().error.code).toBe("PROPERTY_REFERENCE_EXISTS");
  });

  it("publishes with a hard-to-guess link and invalidates old, paused, revoked, and cross-agency operations", async () => {
    const publicResult = await context.app.inject({ method: "GET", url: "/api/v1/public/properties/valid-chamberi-public-link" });
    expect(publicResult.statusCode).toBe(200);
    expect(publicResult.json().data.property).not.toHaveProperty("address");

    const foreignPause = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/pause`, headers: { cookie: cookies.adminB } });
    expect(foreignPause.statusCode).toBe(404);

    const regenerate = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/public-link/regenerate`, headers: { cookie: cookies.adminA, "idempotency-key": "property-regenerate-0001" }, payload: { expectedVersion: 1 } });
    expect(regenerate.statusCode).toBe(200);
    const regeneratedUrl = new URL(regenerate.json().data.publicLink);
    expect(regeneratedUrl.pathname.split("/").at(-1)?.length).toBeGreaterThanOrEqual(40);
    expect((await context.app.inject({ method: "GET", url: "/api/v1/public/properties/valid-chamberi-public-link" })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "GET", url: `/api/v1/public/properties/${regeneratedUrl.pathname.split("/").at(-1)}` })).statusCode).toBe(200);

    const regenerateRetry = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/public-link/regenerate`, headers: { cookie: cookies.adminA, "idempotency-key": "property-regenerate-0001" }, payload: { expectedVersion: 1 } });
    expect(regenerateRetry.json().data).toMatchObject({ publicLink: regenerate.json().data.publicLink, idempotentReplay: true });
    const concurrentRegeneration = await Promise.all([
      context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/public-link/regenerate`, headers: { cookie: cookies.adminA, "idempotency-key": "property-regenerate-race-a" }, payload: { expectedVersion: 2 } }),
      context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/public-link/regenerate`, headers: { cookie: cookies.adminA, "idempotency-key": "property-regenerate-race-b" }, payload: { expectedVersion: 2 } }),
    ]);
    expect(concurrentRegeneration.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winningRegeneration = concurrentRegeneration.find((response) => response.statusCode === 200)!;
    const winningToken = new URL(winningRegeneration.json().data.publicLink).pathname.split("/").at(-1)!;
    expect((await context.app.inject({ method: "GET", url: `/api/v1/public/properties/${regeneratedUrl.pathname.split("/").at(-1)}` })).statusCode).toBe(404);
    expect((await context.app.inject({ method: "GET", url: `/api/v1/public/properties/${winningToken}` })).statusCode).toBe(200);

    await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/pause`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 3 } });
    const paused = await context.app.inject({ method: "GET", url: `/api/v1/public/properties/${winningToken}` });
    expect(paused.statusCode).toBe(410);
    expect(paused.json().error.code).toBe("PUBLIC_LINK_INACTIVE");

    await context.app.inject({ method: "DELETE", url: `/api/v1/agency/properties/${ids.propertyA}/public-link`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 4 } });
    expect((await context.app.inject({ method: "GET", url: `/api/v1/public/properties/${winningToken}` })).statusCode).toBe(404);
  });
});

describe("authenticated tenant submission", () => {
  it("keeps co-applicants in one account while requiring document ownership for every adult", async () => {
    const coApplicantId = "8a7ef94a-2f92-44f5-a48d-0360644959f7";
    const application = { ...completeApplication, adultOccupants: 2, additionalAdults: [{ id: coApplicantId, fullName: "Mario Martín", email: "mario@example.es", phone: "+34699888777", employmentStatus: "Trabajo por cuenta ajena", employerOrActivity: "Estudio Norte", contractType: "Indefinido", netMonthlyIncomeCents: 170_000 }] };
    const partialDraft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { adultOccupants: 2, additionalAdults: [{ id: coApplicantId, fullName: "", email: null, phone: null, employmentStatus: "", employerOrActivity: "", contractType: "", netMonthlyIncomeCents: 0 }] } });
    expect(partialDraft.statusCode).toBe(201);
    const draft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: application });
    expect(draft.statusCode).toBe(200);
    const applicationId = draft.json().data.applicationId as string;
    const pdf = Buffer.from("%PDF-adult-owned").toString("base64");
    for (const category of ["payslips", "employment_contract"] as const) {
      expect((await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie: cookies.tenantA }, payload: { adultProfileId: "primary", category, originalName: `${category}.pdf`, contentType: "application/pdf", dataBase64: pdf } })).statusCode).toBe(201);
    }
    const incomplete = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: { application, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "co-applicant-submit-0001" } });
    expect(incomplete.statusCode).toBe(422);
    expect(incomplete.json().error.details.missingByAdult).toEqual([{ adultProfileId: coApplicantId, categories: ["payslips", "employment_contract"] }]);
    for (const category of ["payslips", "employment_contract"] as const) {
      expect((await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie: cookies.tenantA }, payload: { adultProfileId: coApplicantId, category, originalName: `${category}-mario.pdf`, contentType: "application/pdf", dataBase64: pdf } })).statusCode).toBe(201);
    }
    const submitted = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: { application, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "co-applicant-submit-0001" } });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().data.application.adultProfiles.map((adult: { id: string }) => adult.id)).toEqual(["primary", coApplicantId]);
    expect((await context.db.select().from(applicationDocuments)).map((document) => document.adultProfileId).sort()).toEqual([coApplicantId, coApplicantId, "primary", "primary"].sort());
  });

  it("rejects missing and duplicate co-applicant profiles before submission", async () => {
    const submit = (application: Record<string, unknown>, submissionKey: string) => context.app.inject({
      method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit",
      headers: { cookie: cookies.tenantA },
      payload: { application, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey },
    });
    const missing = await submit({ ...completeApplication, adultOccupants: 2, additionalAdults: [] }, "missing-co-applicant-0001");
    expect(missing.statusCode).toBe(400);

    const duplicateId = "8a7ef94a-2f92-44f5-a48d-0360644959f7";
    const adult = { id: duplicateId, fullName: "Mario Martín", email: null, phone: null, employmentStatus: "Empleado", employerOrActivity: "Empresa", contractType: "Indefinido", netMonthlyIncomeCents: 170_000 };
    const duplicate = await submit({ ...completeApplication, adultOccupants: 3, additionalAdults: [adult, { ...adult, fullName: "María Martín" }] }, "duplicate-co-applicant-0001");
    expect(duplicate.statusCode).toBe(400);
    expect(await context.db.select().from(applications)).toHaveLength(0);
  });

  it("rejects a draft when the property is paused after link resolution", async () => {
    const gate = blockApplicationWrite("draft");
    const draft = context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín" } });
    await gate.entered;
    const paused = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/pause`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 1 } });
    expect(paused.statusCode).toBe(200);
    gate.release();
    const response = await draft;
    expect(response.statusCode).toBe(410);
    expect(response.json().error.code).toBe("PUBLIC_LINK_INACTIVE");
    expect(await context.db.select().from(applications)).toHaveLength(0);
  });

  it.each(["pause", "revoke", "regenerate"] as const)("rejects a submission when %s wins after link resolution", async (operation) => {
    await context.db.update(properties).set({ requestedDocumentCategories: [] }).where(eq(properties.id, ids.propertyA));
    const gate = blockApplicationWrite("submit");
    const submit = context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: {
      application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: `stale-link-${operation}-0001`,
    } });
    await gate.entered;
    const mutation = operation === "revoke"
      ? await context.app.inject({ method: "DELETE", url: `/api/v1/agency/properties/${ids.propertyA}/public-link`, headers: { cookie: cookies.adminA }, payload: { expectedVersion: 1 } })
      : await context.app.inject({
        method: "POST", url: `/api/v1/agency/properties/${ids.propertyA}/${operation === "pause" ? "pause" : "public-link/regenerate"}`,
        headers: { cookie: cookies.adminA, ...(operation === "regenerate" ? { "idempotency-key": "stale-submit-regenerate-0001" } : {}) }, payload: { expectedVersion: 1 },
      });
    expect(mutation.statusCode).toBe(operation === "revoke" ? 204 : 200);
    gate.release();
    const response = await submit;
    expect(response.statusCode).toBe(operation === "pause" ? 410 : 404);
    expect(response.json().error.code).toBe(operation === "pause" ? "PUBLIC_LINK_INACTIVE" : "PUBLIC_LINK_INVALID");
    expect(await context.db.select().from(applications)).toHaveLength(0);
    expect(context.emailProvider.messages.filter((message) => message.template === "application_received" || message.template === "new_applicant")).toHaveLength(0);
  });

  it("rechecks requested categories after the property edit fence before submitting", async () => {
    const draft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín" } });
    const applicationId = draft.json().data.applicationId as string;
    const pdf = Buffer.from("%PDF-category-race").toString("base64");
    for (const [category, originalName] of [["payslips", "nominas.pdf"], ["employment_contract", "contrato.pdf"]] as const) {
      expect((await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie: cookies.tenantA }, payload: { category, originalName, contentType: "application/pdf", dataBase64: pdf } })).statusCode).toBe(201);
    }
    const gate = blockApplicationWrite("submit");
    const submit = context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: {
      application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "requested-category-race-0001",
    } });
    await gate.entered;
    const changed = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${ids.propertyA}`, headers: { cookie: cookies.adminA }, payload: {
      requestedDocumentCategories: ["payslips", "employment_contract", "supporting"],
    } });
    expect(changed.statusCode).toBe(200);
    gate.release();
    const response = await submit;
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({ code: "REQUESTED_DOCUMENTS_MISSING", details: { missingCategories: ["supporting"] } });
    expect((await context.db.select().from(applications).where(eq(applications.id, applicationId)))[0]).toMatchObject({ submittedAt: null, documentState: "missing" });
    expect(context.emailProvider.messages.filter((message) => message.template === "application_received" || message.template === "new_applicant")).toHaveLength(0);
  });

  it("resolves notification administrators only after the agency lock", async () => {
    await context.db.update(properties).set({ requestedDocumentCategories: [] }).where(eq(properties.id, ids.propertyA));
    await context.db.update(agencyMemberships).set({ role: "admin" }).where(eq(agencyMemberships.userId, ids.collaboratorA));
    const gate = blockApplicationWrite("submit");
    const submit = context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: {
      application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "fresh-admin-resolution-0001",
    } });
    await gate.entered;
    expect((await context.app.inject({ method: "DELETE", url: `/api/v1/agency/team/members/${ids.collaboratorA}`, headers: { cookie: cookies.adminA } })).statusCode).toBe(204);
    gate.release();
    const response = await submit;
    expect(response.statusCode).toBe(201);
    expect(context.emailProvider.messages.some((message) => message.recipient === "collab-a@example.es")).toBe(false);
    expect(context.emailProvider.messages.some((message) => message.recipient === "admin-a@example.es" && message.template === "new_applicant")).toBe(true);
  });

  it("rejects a draft whose transaction resumes after tenant closure", async () => {
    const gate = blockApplicationWrite("draft");
    const draft = context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "No debe persistirse" } });
    await gate.entered;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.tenantA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    gate.release();
    const rejected = await draft;
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("ACCOUNT_CLOSED");
    expect(await context.db.select().from(applications)).toHaveLength(0);
  });

  it("rejects a submission and its emails when its transaction resumes after tenant closure", async () => {
    const draft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín" } });
    const applicationId = draft.json().data.applicationId as string;
    const pdf = Buffer.from("%PDF-close-submit").toString("base64");
    for (const [category, name] of [["payslips", "nominas.pdf"], ["employment_contract", "contrato.pdf"]] as const) {
      expect((await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie: cookies.tenantA }, payload: { category, originalName: name, contentType: "application/pdf", dataBase64: pdf } })).statusCode).toBe(201);
    }
    const gate = blockApplicationWrite("submit");
    const submission = context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: { application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "close-race-submit-key" } });
    await gate.entered;
    expect((await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.tenantA }, payload: { confirmation: "CERRAR MI CUENTA" } })).statusCode).toBe(202);
    gate.release();
    const rejected = await submission;
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("ACCOUNT_CLOSED");
    expect((await context.db.select().from(applications).where(eq(applications.id, applicationId)))[0]?.submittedAt).toBeNull();
    expect(context.emailProvider.messages.filter((message) => message.template === "application_received" || message.template === "new_applicant")).toHaveLength(0);
  });

  it("atomically merges concurrent first autosaves and preserves explicit null clearing", async () => {
    const [identity, household] = await Promise.all([
      context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín", message: "Borrar después", petDetails: "Un gato", availabilityNote: "Por la tarde", marketingConsent: true, viewingAvailability: ["Martes"] } }),
      context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { adultOccupants: 2, phone: "+34612144309" } }),
    ]);
    expect([identity.statusCode, household.statusCode].every((status) => status === 200 || status === 201)).toBe(true);
    const rows = await context.db.select().from(applications).where(and(eq(applications.propertyId, ids.propertyA), eq(applications.tenantUserId, ids.tenantA)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.draftData).toMatchObject({ fullName: "Lucía Martín", adultOccupants: 2, phone: "+34612144309", message: "Borrar después", petDetails: "Un gato", availabilityNote: "Por la tarde", marketingConsent: true, viewingAvailability: ["Martes"] });
    const cleared = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { message: null, petDetails: null, availabilityNote: null, marketingConsent: false, viewingAvailability: [] } });
    expect(cleared.statusCode).toBe(200);
    expect((await context.db.select().from(applications))[0]?.draftData).toMatchObject({ fullName: "Lucía Martín", adultOccupants: 2, message: null, petDetails: null, availabilityNote: null, marketingConsent: false, viewingAvailability: [] });
  });

  it("requires a verified tenant, resumes drafts, records source/consent, and makes retries idempotent", async () => {
    const unauthenticated = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", payload: { fullName: "Lucía" } });
    expect(unauthenticated.statusCode).toBe(401);

    const draft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín", phone: "+34612144309" } });
    expect(draft.statusCode).toBe(201);
    const draftApplicationId = draft.json().data.applicationId as string;
    const nextStep = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { adultOccupants: 2, message: null, viewingAvailability: [] } });
    expect(nextStep.statusCode).toBe(200);
    const recovered = await context.app.inject({ method: "GET", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA } });
    expect(recovered.json().data.application.draftData.phone).toBe("+34612144309");
    expect(recovered.json().data.application.draftData).toMatchObject({ fullName: "Lucía Martín", adultOccupants: 2, message: null, viewingAvailability: [] });

    const pdf = Buffer.from("%PDF-test-private").toString("base64");
    for (const [category, originalName] of [["payslips", "nominas.pdf"], ["employment_contract", "contrato.pdf"]] as const) {
      const upload = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${draftApplicationId}/documents`, headers: { cookie: cookies.tenantA }, payload: { category, originalName, contentType: "application/pdf", dataBase64: pdf } });
      expect(upload.statusCode).toBe(201);
    }

    const firstPayload = { application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "stable-submit-key-0001" };
    const secondPayload = { ...firstPayload, application: { ...completeApplication, message: "Contenido concurrente diferente." }, submissionKey: "different-submit-key-0002" };
    const concurrent = await Promise.all([
      context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: firstPayload }),
      context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: secondPayload }),
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const winnerIndex = concurrent.findIndex((response) => response.statusCode === 201);
    const winner = concurrent[winnerIndex]!;
    const winnerPayload = winnerIndex === 0 ? firstPayload : secondPayload;
    expect(winner.json().data.application.status).toBe("new");
    expect(winner.json().data.application.consentVersion).toBe("privacy-2026-08-v1");
    expect(winner.json().data.idempotentReplay).toBe(false);
    const retry = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: winnerPayload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.idempotentReplay).toBe(true);
    const records = await context.db.select().from(applications);
    expect(records).toHaveLength(1);
    expect(records[0]?.agencyId).toBe(ids.agencyA);
    expect(records[0]?.propertyId).toBe(ids.propertyA);
    expect(records[0]?.responsibleUserId).toBeNull();
    expect(records[0]).toMatchObject({
      phone: completeApplication.phone,
      individualNetMonthlyIncomeCents: completeApplication.individualNetMonthlyIncomeCents,
      householdNetMonthlyIncomeCents: completeApplication.householdNetMonthlyIncomeCents,
      adultOccupants: completeApplication.adultOccupants,
      minorOccupants: completeApplication.minorOccupants,
      intendedMoveInDate: completeApplication.intendedMoveInDate,
      draftData: completeApplication,
    });
    expect(context.emailProvider.messages.filter((message) => message.template === "application_received")).toHaveLength(1);
    const agencyNotifications = context.emailProvider.messages.filter((message) => message.template === "new_applicant");
    expect(agencyNotifications).toHaveLength(1);
    expect(agencyNotifications[0]).toMatchObject({ recipient: "admin-a@example.es", variables: { propertyTitle: "Piso luminoso en Chamberí" } });
    expect(JSON.stringify(agencyNotifications[0]?.variables)).not.toContain("Lucía");
    const changedRetry = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: { ...winnerPayload, submissionKey: "third-submit-key-0003" } });
    expect(changedRetry.statusCode).toBe(409);
    expect(changedRetry.json().error.code).toBe("APPLICATION_ALREADY_SUBMITTED");
  });

  it("never counts pending or infected legacy documents as complete or submittable", async () => {
    const draft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín" } });
    const applicationId = draft.json().data.applicationId as string;
    const createdAt = new Date("2026-08-08T11:00:00.000Z");
    await context.db.insert(applicationDocuments).values([
      { id: "81000000-0000-4000-8000-000000000001", applicationId, agencyId: ids.agencyA, tenantUserId: ids.tenantA, category: "payslips", storageKey: "legacy/payslips", originalName: "nominas.pdf", contentType: "application/pdf", byteSize: 100, malwareScanState: "pending", createdAt, updatedAt: createdAt },
      { id: "81000000-0000-4000-8000-000000000002", applicationId, agencyId: ids.agencyA, tenantUserId: ids.tenantA, category: "employment_contract", storageKey: "legacy/contract", originalName: "contrato.pdf", contentType: "application/pdf", byteSize: 100, malwareScanState: "infected", createdAt, updatedAt: createdAt },
    ]);
    await context.db.update(applications).set({ documentState: "complete" }).where(eq(applications.id, applicationId));
    const submit = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload: { application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "pending-docs-submit-key" } });
    expect(submit.statusCode).toBe(422);
    expect(submit.json().error.code).toBe("REQUESTED_DOCUMENTS_MISSING");
    expect((await context.db.select().from(applications).where(eq(applications.id, applicationId)))[0]?.documentState).toBe("missing");
  });

  it("rolls back submission when its durable notification cannot be enqueued", async () => {
    const draft = await context.app.inject({ method: "PUT", url: "/api/v1/tenant/application-drafts/by-link/valid-chamberi-public-link", headers: { cookie: cookies.tenantA }, payload: { fullName: "Lucía Martín" } });
    const applicationId = draft.json().data.applicationId as string;
    const pdf = Buffer.from("%PDF-atomic-submit").toString("base64");
    for (const [category, originalName] of [["payslips", "nominas.pdf"], ["employment_contract", "contrato.pdf"]] as const) {
      expect((await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie: cookies.tenantA }, payload: { category, originalName, contentType: "application/pdf", dataBase64: pdf } })).statusCode).toBe(201);
    }
    const payload = { application: completeApplication, consentVersion: "privacy-2026-08-v1", privacyConsent: true, submissionKey: "atomic-submit-key-0001" };
    context.emailProvider.failTemplateOnce = "application_received";
    const failed = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload });
    expect(failed.statusCode).toBe(500);
    expect((await context.db.select().from(applications).where(eq(applications.id, applicationId)))[0]).toMatchObject({ submittedAt: null, submissionKeyHash: null });
    const retry = await context.app.inject({ method: "POST", url: "/api/v1/tenant/applications/by-link/valid-chamberi-public-link/submit", headers: { cookie: cookies.tenantA }, payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().data.idempotentReplay).toBe(false);
  });
});

describe("agency applicant workspace", () => {
  it("flags same-property normalized phone matches without merging or changing either application", async () => {
    const submittedAt = new Date("2026-08-08T12:00:00.000Z");
    const secondId = "70000000-0000-4000-8000-000000000099";
    await context.db.update(applications).set({ normalizedPhone: "34612144309", normalizedEmail: "lucia@example.es" }).where(eq(applications.id, ids.applicationA));
    await context.db.insert(applications).values({ id: secondId, agencyId: ids.agencyA, propertyId: ids.propertyA, tenantUserId: ids.tenantB, status: "new", documentState: "not_requested", submittedAt, phone: "+34612144309", normalizedPhone: "34612144309", normalizedEmail: "other@example.es", draftData: { ...completeApplication, fullName: "Otro Inquilino", email: "other@example.es" }, createdAt: submittedAt, updatedAt: submittedAt });
    const list = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyA}/applications`, headers: { cookie: cookies.adminA } });
    expect(list.statusCode).toBe(200);
    const items = list.json().data.applications as Array<{ application: { id: string }; possibleDuplicate: { matchedOn: string[]; applicationIds: string[] } | null }>;
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.possibleDuplicate)).toEqual(expect.arrayContaining([
      { matchedOn: ["phone"], applicationIds: [secondId] },
      { matchedOn: ["phone"], applicationIds: [ids.applicationA] },
    ]));
    expect(items.map((item) => item.application.id).sort()).toEqual([ids.applicationA, secondId].sort());
  });

  it("paginates properties, applicants, and appointments with stable metadata", async () => {
    const createdAt = new Date("2026-08-08T12:00:00.000Z");
    const tenantId = "30000000-0000-4000-8000-000000000099";
    const propertyId = "50000000-0000-4000-8000-000000000099";
    const applicationId = "70000000-0000-4000-8000-000000000099";
    await context.db.insert(users).values({ id: tenantId, kind: "tenant", email: "pagination@example.es", fullName: "Ana Paginada", passwordHash: await argon2.hash("test-password"), emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt });
    await context.db.insert(properties).values({ id: propertyId, agencyId: ids.agencyA, internalReference: "MAD-PAGE", title: "Piso paginado", city: "Madrid", province: "Madrid", monthlyRentCents: 110_000, createdAt, updatedAt: createdAt });
    await context.db.insert(applications).values({ id: applicationId, agencyId: ids.agencyA, propertyId: ids.propertyA, tenantUserId: tenantId, submittedAt: createdAt, phone: "+34600000099", householdNetMonthlyIncomeCents: 500_000, draftData: { phone: "+34600000099", householdNetMonthlyIncomeCents: 500_000 }, createdAt, updatedAt: createdAt });
    await context.db.insert(appointments).values([
      { id: "90000000-0000-4000-8000-000000000098", agencyId: ids.agencyA, propertyId: ids.propertyA, applicationId: ids.applicationA, startsAt: new Date("2098-08-10T10:00:00.000Z"), durationMinutes: 30, createdAt, updatedAt: createdAt },
      { id: "90000000-0000-4000-8000-000000000099", agencyId: ids.agencyA, propertyId: ids.propertyA, applicationId, startsAt: new Date("2098-08-11T10:00:00.000Z"), durationMinutes: 30, createdAt, updatedAt: createdAt },
    ]);

    for (const url of [
      "/api/v1/agency/properties?page=1&pageSize=1",
      `/api/v1/agency/properties/${ids.propertyA}/applications?page=1&pageSize=1`,
      "/api/v1/agency/appointments?page=1&pageSize=1",
    ]) {
      const first = await context.app.inject({ method: "GET", url, headers: { cookie: cookies.adminA } });
      expect(first.statusCode).toBe(200);
      expect(first.json().data.pagination).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2, hasMore: true });
      const second = await context.app.inject({ method: "GET", url: url.replace("page=1", "page=2"), headers: { cookie: cookies.adminA } });
      expect(second.statusCode).toBe(200);
      expect(second.json().data.pagination).toEqual({ page: 2, pageSize: 1, total: 2, totalPages: 2, hasMore: false });
    }

    const phoneSearch = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyA}/applications?search=%2B34600000099`, headers: { cookie: cookies.adminA } });
    expect(phoneSearch.json().data.applications).toEqual([expect.objectContaining({ application: expect.objectContaining({ id: applicationId }) })]);
    const incomeSort = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyA}/applications?sort=income`, headers: { cookie: cookies.adminA } });
    expect(incomeSort.json().data.applications[0].application.id).toBe(applicationId);
    const recentOnly = await context.app.inject({ method: "GET", url: "/api/v1/agency/properties?hasRecentNewApplicants=true&pageSize=1", headers: { cookie: cookies.adminA } });
    expect(recentOnly.json().data).toMatchObject({ properties: [expect.objectContaining({ property: expect.objectContaining({ id: ids.propertyA }) })], pagination: { total: 1, hasMore: false } });
  });

  beforeEach(async () => {
    const submittedAt = new Date("2026-08-08T10:30:00.000Z");
    await context.db.insert(applications).values({ id: ids.applicationA, agencyId: ids.agencyA, propertyId: ids.propertyA, tenantUserId: ids.tenantA, responsibleUserId: ids.adminA, status: "new", documentState: "missing", submittedAt, draftData: completeApplication, phone: completeApplication.phone, individualNetMonthlyIncomeCents: completeApplication.individualNetMonthlyIncomeCents, householdNetMonthlyIncomeCents: completeApplication.householdNetMonthlyIncomeCents, adultOccupants: completeApplication.adultOccupants, minorOccupants: completeApplication.minorOccupants, intendedMoveInDate: completeApplication.intendedMoveInDate, consentVersion: "v1", consentedAt: submittedAt, sourceLinkTokenHash: hashSecret("valid-chamberi-public-link"), createdAt: submittedAt, updatedAt: submittedAt });
  });

  it("returns tenant-scoped summaries and details that match the explicit OpenAPI contract", async () => {
    const response = await context.app.inject({ method: "GET", url: "/api/v1/tenant/applications", headers: { cookie: cookies.tenantA } });
    expect(response.statusCode).toBe(200);
    const item = response.json().data.applications[0];
    expect(item).toMatchObject({
      application: { id: ids.applicationA, status: "new", documentState: "missing", submittedAt: expect.any(String), updatedAt: expect.any(String) },
      property: { id: ids.propertyA, title: "Piso luminoso en Chamberí", publicLocation: "Trafalgar, Madrid", coverImageUrl: null },
      resumePath: null,
    });
    expect(Object.keys(item.application).sort()).toEqual(["documentState", "id", "status", "submittedAt", "updatedAt"]);
    expect(Object.keys(item.property).sort()).toEqual(["coverImageUrl", "id", "publicLocation", "title"]);
    const otherTenant = await context.app.inject({ method: "GET", url: "/api/v1/tenant/applications", headers: { cookie: cookies.tenantB } });
    expect(otherTenant.json().data.applications).toEqual([]);

    await context.app.ready();
    const document = context.app.swagger() as Record<string, any>;
    const operation = document.paths["/api/v1/tenant/applications"].get;
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "401", "403", "500"]);
    const itemSchema = operation.responses["200"].content["application/json"].schema.properties.data.properties.applications.items;
    for (const key of itemSchema.required) expect(item).toHaveProperty(key);
    for (const key of itemSchema.properties.application.required) expect(item.application).toHaveProperty(key);
    for (const key of itemSchema.properties.property.required) expect(item.property).toHaveProperty(key);
    expect(itemSchema.properties.application.properties.status.enum).toContain(item.application.status);
    expect(itemSchema.properties.application.properties.documentState.enum).toContain(item.application.documentState);

    const detail = await context.app.inject({ method: "GET", url: `/api/v1/tenant/applications/${ids.applicationA}`, headers: { cookie: cookies.tenantA } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data).toMatchObject({
      application: { id: ids.applicationA, status: "new", documentState: "missing" },
      property: { id: ids.propertyA, agencyName: "Albor Inmobiliaria", internalReference: "MAD-042", title: "Piso luminoso en Chamberí" },
      documents: [],
    });
    expect(detail.json().data.application).not.toHaveProperty("draftData");
    expect((await context.app.inject({ method: "GET", url: `/api/v1/tenant/applications/${ids.applicationA}`, headers: { cookie: cookies.tenantB } })).statusCode).toBe(404);

    const detailOperation = document.paths["/api/v1/tenant/applications/{applicationId}"].get;
    expect(Object.keys(detailOperation.responses).sort()).toEqual(["200", "400", "401", "403", "404", "409", "500"]);
  });

  it("returns a recoverable source link only for an active draft", async () => {
    await context.db.update(applications).set({ submittedAt: null, consentedAt: null, consentVersion: null }).where(eq(applications.id, ids.applicationA));
    const active = await context.app.inject({ method: "GET", url: "/api/v1/tenant/applications", headers: { cookie: cookies.tenantA } });
    expect(active.json().data.applications[0].resumePath).toBe("/solicitud/valid-chamberi-public-link");

    await context.db.update(properties).set({ state: "paused" }).where(eq(properties.id, ids.propertyA));
    const paused = await context.app.inject({ method: "GET", url: "/api/v1/tenant/applications", headers: { cookie: cookies.tenantA } });
    expect(paused.json().data.applications[0].resumePath).toBeNull();
  });

  it("denies a sensitive applicant read when membership is removed after authentication", async () => {
    const gate = blockAgencySensitiveRead();
    const detail = context.app.inject({ method: "GET", url: `/api/v1/agency/applications/${ids.applicationA}`, headers: { cookie: cookies.collaboratorA } });
    await gate.entered;
    await context.db.delete(agencyMemberships).where(and(eq(agencyMemberships.agencyId, ids.agencyA), eq(agencyMemberships.userId, ids.collaboratorA)));
    gate.release();
    const response = await detail;
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("AGENCY_ACCESS_CHANGED");
    expect(response.json().data).toBeUndefined();
  });

  it("returns agency-scoped identities for exact applicant and appointment destinations", async () => {
    const applicantDetail = await context.app.inject({ method: "GET", url: `/api/v1/agency/applications/${ids.applicationA}`, headers: { cookie: cookies.adminA } });
    expect(applicantDetail.statusCode).toBe(200);
    expect(applicantDetail.json().data).toMatchObject({
      applicant: { fullName: "Lucía Martín", email: "lucia@example.es" },
      application: { id: ids.applicationA },
      property: { id: ids.propertyA, title: "Piso luminoso en Chamberí" },
    });

    const created = await context.app.inject({
      method: "POST",
      url: "/api/v1/agency/appointments",
      headers: { cookie: cookies.adminA, "idempotency-key": "appointment-destination-0001" },
      payload: { applicationId: ids.applicationA, startsAt: "2098-08-10T18:00:00+02:00", durationMinutes: 30, responsibleUserId: ids.adminA, instructions: null, internalNote: null },
    });
    expect(created.statusCode).toBe(201);
    const appointmentId = created.json().data.appointment.id as string;

    const list = await context.app.inject({ method: "GET", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA } });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.appointments[0]).toMatchObject({
      id: appointmentId,
      applicantName: "Lucía Martín",
      propertyTitle: "Piso luminoso en Chamberí",
      href: `/app/citas/${appointmentId}`,
    });

    const detail = await context.app.inject({ method: "GET", url: `/api/v1/agency/appointments/${appointmentId}`, headers: { cookie: cookies.adminA } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.appointment).toMatchObject({ id: appointmentId, applicantName: "Lucía Martín", propertyTitle: "Piso luminoso en Chamberí", responsibleUserName: "Marta Soler" });
    await context.app.ready();
    const document = context.app.swagger() as Record<string, any>;
    const operation = document.paths["/api/v1/agency/appointments/{appointmentId}"].get;
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "403", "404", "500"]);
    const appointmentSchema = operation.responses["200"].content["application/json"].schema.properties.data.properties.appointment;
    for (const key of appointmentSchema.required) expect(detail.json().data.appointment).toHaveProperty(key);
    const foreignDetail = await context.app.inject({ method: "GET", url: `/api/v1/agency/appointments/${appointmentId}`, headers: { cookie: cookies.adminB } });
    expect(foreignDetail.statusCode).toBe(404);
    expect(foreignDetail.json().error.code).toBe("APPOINTMENT_NOT_FOUND");
  });

  it("distinguishes all current-new applicants from the dashboard's last-30-days filter", async () => {
    await context.db.update(applications).set({ submittedAt: new Date("2026-06-01T10:00:00.000Z") }).where(eq(applications.id, ids.applicationA));
    const response = await context.app.inject({ method: "GET", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA } });
    expect(response.statusCode).toBe(200);
    const row = response.json().data.properties.find((item: { property: { id: string } }) => item.property.id === ids.propertyA);
    expect(row).toMatchObject({ applicantCount: 1, newApplicantCount: 1, recentNewApplicantCount: 0 });
  });

  it("preserves a former member's historical note with an anonymized author", async () => {
    const created = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/notes`, headers: { cookie: cookies.collaboratorA }, payload: { body: "Seguimiento histórico que debe conservarse." } });
    expect(created.statusCode).toBe(201);
    const noteId = created.json().data.note.id as string;
    const old = new Date("2025-01-01T00:00:00.000Z");
    await context.db.update(users).set({ accountState: "closure_requested", closureRequestedAt: old, accountPurgeNextAttemptAt: old, updatedAt: old }).where(eq(users.id, ids.collaboratorA));
    await context.db.delete(agencyMemberships).where(and(eq(agencyMemberships.agencyId, ids.agencyA), eq(agencyMemberships.userId, ids.collaboratorA)));

    const purged = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T12:00:00.000Z"), accountRetentionDays: 0 });
    expect(purged.tenantAccountsDeleted).toBe(1);
    expect((await context.db.select().from(applicationNotes).where(eq(applicationNotes.id, noteId)))[0]?.authorUserId).toBeNull();

    const detail = await context.app.inject({ method: "GET", url: `/api/v1/agency/applications/${ids.applicationA}`, headers: { cookie: cookies.adminA } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ note: expect.objectContaining({ id: noteId, body: "Seguimiento histórico que debe conservarse.", authorUserId: null }), authorName: "Usuario eliminado" }),
    ]));
  });

  it("lets agency closure win over an applicant mutation authenticated before closure", async () => {
    const applicantGate = blockAgencyWrite("applicant");
    const applicantMutation = context.app.inject({
      method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA },
      payload: { status: "preselected", expectedStatus: "new" },
    });
    await applicantGate.entered;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.adminA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    applicantGate.release();
    const applicantResponse = await applicantMutation;
    expect(applicantResponse.statusCode).toBe(409);
    expect(applicantResponse.json().error.code).toBe("AGENCY_CLOSURE_IN_PROGRESS");
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))[0]?.status).toBe("new");
    expect(await context.db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, ids.applicationA))).toHaveLength(0);
    expect(await context.db.select().from(appointments).where(eq(appointments.applicationId, ids.applicationA))).toHaveLength(0);
  });

  it("lets agency closure win over appointment creation without persisting an email", async () => {
    const gate = blockAgencyWrite("appointment");
    const mutation = context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-closure-race-0001" }, payload: {
      applicationId: ids.applicationA, startsAt: "2098-08-10T18:00:00+02:00", durationMinutes: 30,
      responsibleUserId: ids.adminA, instructions: null, internalNote: null,
    } });
    await gate.entered;
    const beforeMessages = context.emailProvider.messages.length;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.adminA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    gate.release();
    const response = await mutation;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AGENCY_CLOSURE_IN_PROGRESS");
    expect(await context.db.select().from(appointments).where(eq(appointments.applicationId, ids.applicationA))).toHaveLength(0);
    expect(context.emailProvider.messages).toHaveLength(beforeMessages);
  });

  it("lets tenant closure win over appointment creation without persisting an email", async () => {
    const gate = blockAgencyWrite("appointment");
    const mutation = context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-tenant-closure-race-0001" }, payload: {
      applicationId: ids.applicationA, startsAt: "2098-08-10T18:00:00+02:00", durationMinutes: 30,
      responsibleUserId: ids.adminA, instructions: null, internalNote: null,
    } });
    await gate.entered;
    const beforeMessages = context.emailProvider.messages.length;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.tenantA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    gate.release();
    const response = await mutation;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("TENANT_CLOSURE_IN_PROGRESS");
    expect(await context.db.select().from(appointments).where(eq(appointments.applicationId, ids.applicationA))).toHaveLength(0);
    expect(context.emailProvider.messages).toHaveLength(beforeMessages);
  });

  it("scopes list/detail, supports filters, and audits only the five applicant statuses", async () => {
    const filtered = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyA}/applications?search=Luc%C3%ADa&status=new&documentState=missing&sort=income`, headers: { cookie: cookies.adminA } });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data.applications).toHaveLength(1);
    expect(filtered.json().data.applications[0]).toMatchObject({ responsibleUserName: "Marta Soler" });
    const foreign = await context.app.inject({ method: "GET", url: `/api/v1/agency/applications/${ids.applicationA}`, headers: { cookie: cookies.adminB } });
    expect(foreign.statusCode).toBe(404);

    const invalidStatus = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA }, payload: { status: "reviewing" } });
    expect(invalidStatus.statusCode).toBe(400);
    const agencyCannotWithdraw = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA }, payload: { status: "withdrawn" } });
    expect(agencyCannotWithdraw.statusCode).toBe(400);
    const changed = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA }, payload: { status: "preselected", expectedStatus: "new" } });
    expect(changed.statusCode).toBe(200);
    const history = await context.db.select().from(applicationStatusHistory);
    expect(history).toMatchObject([{ fromStatus: "new", toStatus: "preselected", actorUserId: ids.adminA }]);

    const note = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/notes`, headers: { cookie: cookies.collaboratorA }, payload: { body: "Prefiere una visita por la tarde." } });
    expect(note.statusCode).toBe(201);
    expect(note.json().data.note.authorName).toBe("Diego García");

    const withdrawn = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/withdraw`, headers: { cookie: cookies.tenantA } });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json().data.application.status).toBe("withdrawn");
    const cannotReopen = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA }, payload: { status: "new", expectedStatus: "withdrawn" } });
    expect(cannotReopen.statusCode).toBe(409);
  });

  it("generates an editable property-aware WhatsApp link and audits initiation without delivery claims", async () => {
    const response = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/whatsapp`, headers: { cookie: cookies.adminA }, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.deepLink).toContain("https://wa.me/34612144309");
    expect(decodeURIComponent(response.json().data.deepLink)).toContain("MAD-042");
    expect(response.json().data.deliveryClaimed).toBe(false);
    const events = await context.db.select().from(auditEvents);
    expect(events.some((event) => event.action === "whatsapp_contact_initiated")).toBe(true);
    const detail = await context.app.inject({ method: "GET", url: `/api/v1/agency/applications/${ids.applicationA}`, headers: { cookie: cookies.adminA } });
    expect(detail.json().data.activity.map((event: { type: string }) => event.type)).toEqual(expect.arrayContaining(["application_submitted", "whatsapp_contact_initiated"]));
  });

  it("rejects stale concurrent applicant status transitions without contradictory history", async () => {
    const [one, two] = await Promise.all([
      context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA }, payload: { status: "preselected", expectedStatus: "new" } }),
      context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.collaboratorA }, payload: { status: "rejected", expectedStatus: "new" } }),
    ]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 409]);
    const history = await context.db.select().from(applicationStatusHistory);
    expect(history).toHaveLength(1);
    expect(["preselected", "rejected"]).toContain(history[0]?.toStatus);
  });

  it("enforces the rental ownership graph at the database boundary", async () => {
    const createdAt = new Date("2026-08-08T12:00:00.000Z");
    await expect(context.db.insert(applications).values({ id: "82000000-0000-4000-8000-000000000001", agencyId: ids.agencyB, propertyId: ids.propertyA, tenantUserId: ids.tenantB, createdAt, updatedAt: createdAt })).rejects.toThrow();
    await expect(context.db.insert(applications).values({ id: "82000000-0000-4000-8000-000000000002", agencyId: ids.agencyA, propertyId: ids.propertyA, tenantUserId: ids.adminA, createdAt, updatedAt: createdAt })).rejects.toThrow();
    await expect(context.db.insert(applicationDocuments).values({ id: "82000000-0000-4000-8000-000000000003", applicationId: ids.applicationA, agencyId: ids.agencyB, tenantUserId: ids.tenantA, category: "payslips", storageKey: "invalid", originalName: "invalid.pdf", contentType: "application/pdf", byteSize: 1, malwareScanState: "clean", createdAt, updatedAt: createdAt })).rejects.toThrow();
    await expect(context.db.insert(appointments).values({ id: "82000000-0000-4000-8000-000000000004", applicationId: ids.applicationA, agencyId: ids.agencyA, propertyId: ids.propertyB, responsibleUserId: ids.adminA, startsAt: new Date("2098-01-01T10:00:00.000Z"), durationMinutes: 30, state: "scheduled", createdAt, updatedAt: createdAt })).rejects.toThrow();
    await expect(context.db.insert(appointments).values({ id: "82000000-0000-4000-8000-000000000005", applicationId: ids.applicationA, agencyId: ids.agencyA, propertyId: ids.propertyA, responsibleUserId: ids.adminB, startsAt: new Date("2098-01-01T10:00:00.000Z"), durationMinutes: 30, state: "scheduled", createdAt, updatedAt: createdAt })).rejects.toThrow();
  });

  it("recomputes independent document state when requested categories change", async () => {
    expect((await context.db.select().from(applications))[0]?.documentState).toBe("missing");
    const noDocuments = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${ids.propertyA}`, headers: { cookie: cookies.adminA }, payload: { requestedDocumentCategories: [] } });
    expect(noDocuments.statusCode).toBe(200);
    expect((await context.db.select().from(applications))[0]).toMatchObject({ documentState: "not_requested", status: "new" });
    const requestedAgain = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${ids.propertyA}`, headers: { cookie: cookies.adminA }, payload: { requestedDocumentCategories: ["payslips"] } });
    expect(requestedAgain.statusCode).toBe(200);
    expect((await context.db.select().from(applications))[0]).toMatchObject({ documentState: "missing", status: "new" });
  });

  it("keeps document state private and independent from applicant status", async () => {
    const pdf = Buffer.from("%PDF-test-private").toString("base64");
    const upload = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: pdf } });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().data.document.malwareScanState).toBe("clean");
    const documentId = upload.json().data.document.id as string;
    const ownDocuments = await context.app.inject({ method: "GET", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA } });
    expect(ownDocuments.statusCode).toBe(200);
    expect(ownDocuments.json().data.documents).toHaveLength(1);
    expect(ownDocuments.json().data.documents[0]).not.toHaveProperty("storageKey");
    expect((await context.app.inject({ method: "GET", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantB } })).statusCode).toBe(404);
    const applicationAfterUpload = (await context.db.select().from(applications))[0];
    expect(applicationAfterUpload?.documentState).toBe("missing");
    expect(applicationAfterUpload?.status).toBe("new");

    const tenantBAccess = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.tenantB } });
    expect(tenantBAccess.statusCode).toBe(404);
    const agencyBAccess = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.adminB } });
    expect(agencyBAccess.statusCode).toBe(404);

    const submittedAt = applicationAfterUpload?.submittedAt;
    const consentedAt = applicationAfterUpload?.consentedAt;
    await context.db.update(applications).set({ submittedAt: null, consentedAt: null }).where(eq(applications.id, ids.applicationA));
    const draftAgencyAccess = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.adminA } });
    expect(draftAgencyAccess.statusCode).toBe(404);
    await context.db.update(applications).set({ submittedAt, consentedAt }).where(eq(applications.id, ids.applicationA));

    const agencyAccess = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.adminA } });
    expect(agencyAccess.statusCode).toBe(200);
    const download = await context.app.inject({ method: "GET", url: agencyAccess.json().data.accessUrl, headers: { cookie: cookies.adminA, authorization: `Bearer ${agencyAccess.json().data.accessToken}` } });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString()).toBe("%PDF-test-private");

    await context.db.update(applicationDocuments).set({ malwareScanState: "pending" }).where(eq(applicationDocuments.id, documentId));
    const pendingAccess = await context.app.inject({ method: "POST", url: `/api/v1/agency/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.adminA } });
    expect(pendingAccess.statusCode).toBe(423);
    await context.db.update(applicationDocuments).set({ malwareScanState: "clean" }).where(eq(applicationDocuments.id, documentId));

    const documents = await context.db.select().from(applicationDocuments);
    expect(documents[0]?.storageKey).not.toContain("nominas.pdf");

    const contract = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "employment_contract", originalName: "contrato.pdf", contentType: "application/pdf", dataBase64: pdf } });
    expect(contract.statusCode).toBe(201);
    expect((await context.db.select().from(applications))[0]?.documentState).toBe("complete");
    const deleted = await context.app.inject({ method: "DELETE", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${contract.json().data.document.id}`, headers: { cookie: cookies.tenantA } });
    expect(deleted.statusCode).toBe(204);
    expect((await context.db.select().from(applications))[0]?.documentState).toBe("missing");
  });

  it("does not mint document access after tenant closure wins the fence", async () => {
    const pdf = Buffer.from("%PDF-access-closure").toString("base64");
    const upload = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: pdf } });
    expect(upload.statusCode).toBe(201);
    const documentId = upload.json().data.document.id as string;
    const gate = blockAgencyWrite("document_access");
    const access = context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.tenantA } });
    await gate.entered;
    expect((await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.tenantA }, payload: { confirmation: "CERRAR MI CUENTA" } })).statusCode).toBe(202);
    gate.release();
    const response = await access;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_CLOSED");
    expect(response.json().data).toBeUndefined();
  });

  it("tombstones an upload when its requested category is removed before scan publication", async () => {
    const barrier = storage.blockNextPut();
    const upload = context.app.inject({
      method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA },
      payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-category-upload-race").toString("base64") },
    });
    await barrier.entered;
    const staged = (await context.db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, ids.applicationA)))[0]!;
    const changed = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${ids.propertyA}`, headers: { cookie: cookies.adminA }, payload: {
      requestedDocumentCategories: ["employment_contract"],
    } });
    expect(changed.statusCode).toBe(200);
    barrier.release();
    const response = await upload;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DOCUMENT_UPLOAD_INTERRUPTED");
    expect(await storage.get(staged.storageKey)).toBeNull();
    expect(await context.db.select().from(applicationDocuments).where(eq(applicationDocuments.id, staged.id))).toHaveLength(0);
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))[0]?.documentState).toBe("missing");
  });

  it("serializes document-state recomputation with requested-category edits", async () => {
    const pdf = Buffer.from("%PDF-document-state-fence").toString("base64");
    const uploads = [];
    for (const [category, originalName] of [["payslips", "nominas.pdf"], ["employment_contract", "contrato.pdf"]] as const) {
      const upload = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category, originalName, contentType: "application/pdf", dataBase64: pdf } });
      expect(upload.statusCode).toBe(201);
      uploads.push(upload.json().data.document);
    }
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))[0]?.documentState).toBe("complete");

    const gate = blockDocumentStateWrite();
    const deletion = context.app.inject({ method: "DELETE", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${uploads[0].id}`, headers: { cookie: cookies.tenantA } });
    await gate.entered;
    const edit = context.app.inject({ method: "PATCH", url: `/api/v1/agency/properties/${ids.propertyA}`, headers: { cookie: cookies.adminA }, payload: {
      requestedDocumentCategories: ["employment_contract"],
    } });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    gate.release();
    const [deleted, changed] = await Promise.all([deletion, edit]);
    expect(deleted.statusCode).toBe(204);
    expect(changed.statusCode).toBe(200);
    expect((await context.db.select().from(properties).where(eq(properties.id, ids.propertyA)))[0]?.requestedDocumentCategories).toEqual(["employment_contract"]);
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))[0]?.documentState).toBe("complete");
  });

  it("retains a retryable tombstone when private storage deletion fails", async () => {
    const pdf = Buffer.from("%PDF-delete-retry").toString("base64");
    const upload = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: pdf } });
    const documentId = upload.json().data.document.id as string;
    storage.failNextDelete = true;
    const failed = await context.app.inject({ method: "DELETE", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${documentId}`, headers: { cookie: cookies.tenantA } });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("DOCUMENT_DELETE_PENDING");
    const retained = (await context.db.select().from(applicationDocuments)).find((document) => document.id === documentId);
    expect(retained).toMatchObject({ deletionState: "deleting", deletionAttempts: 1, lastDeleteErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED" });
    expect(retained?.storageKey).toBeTruthy();
    const access = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${documentId}/access`, headers: { cookie: cookies.tenantA } });
    expect(access.statusCode).toBe(404);
    const retried = await context.app.inject({ method: "DELETE", url: `/api/v1/tenant/applications/${ids.applicationA}/documents/${documentId}`, headers: { cookie: cookies.tenantA } });
    expect(retried.statusCode).toBe(204);
    expect((await context.db.select().from(applicationDocuments)).some((document) => document.id === documentId)).toBe(false);
  });

  it("stages metadata before bytes and prevents retention from claiming an in-flight upload", async () => {
    await context.db.update(applications).set({ status: "rejected", updatedAt: new Date("2025-01-01T00:00:00.000Z") }).where(eq(applications.id, ids.applicationA));
    const barrier = storage.blockNextPut();
    const upload = context.app.inject({
      method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA },
      payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-staged").toString("base64") },
    });
    await barrier.entered;
    const staged = (await context.db.select().from(applicationDocuments))[0];
    expect(staged).toMatchObject({ malwareScanState: "pending", deletionState: "active" });
    expect(await storage.get(staged!.storageKey)).toBeNull();
    const retentionWhileUploading = await runDataLifecycle(context.db, storage, {
      now: new Date(staged!.updatedAt.getTime() + 5 * 60_000), retentionDays: 30,
    });
    expect(retentionWhileUploading.applicationsDeleted).toBe(0);
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))[0]?.retentionState).toBe("active");
    barrier.release();
    expect((await upload).statusCode).toBe(201);
  });

  it("keeps an opaque cleanup pointer after an ambiguous put and retries it safely", async () => {
    storage.failNextPutAfterWrite = true;
    storage.failNextDelete = true;
    const failed = await context.app.inject({
      method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA },
      payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-ambiguous-put").toString("base64") },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("DOCUMENT_STORAGE_UNAVAILABLE");
    const staged = (await context.db.select().from(applicationDocuments))[0];
    expect(staged).toMatchObject({ malwareScanState: "pending", deletionState: "deleting", lastDeleteErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED" });
    expect(await storage.get(staged!.storageKey)).not.toBeNull();
    expect((await context.db.select().from(documentStorageCleanup))[0]).toMatchObject({ storageKey: staged!.storageKey, reason: "DOCUMENT_STAGING_CLEANUP" });
    const lifecycle = await runDataLifecycle(context.db, storage, { now: new Date(staged!.updatedAt.getTime() + 20 * 60_000) });
    expect(lifecycle.orphanDeleted).toBe(1);
    expect(await storage.get(staged!.storageKey)).toBeNull();
    expect(await context.db.select().from(applicationDocuments)).toHaveLength(0);
    expect(await context.db.select().from(documentStorageCleanup)).toHaveLength(0);
  });

  it("turns an in-flight upload into cleanup when the tenant closes the account", async () => {
    const barrier = storage.blockNextPut();
    const upload = context.app.inject({
      method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA },
      payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-close-race").toString("base64") },
    });
    await barrier.entered;
    const staged = (await context.db.select().from(applicationDocuments))[0]!;
    const closed = await context.app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: cookies.tenantA }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    const beforeRelease = await runDataLifecycle(context.db, storage, { now: new Date(staged.updatedAt.getTime() + 5 * 60_000), accountRetentionDays: 0 });
    expect(beforeRelease).toMatchObject({ tenantAccountsDeleted: 0, accountClosuresDeferred: 1 });
    barrier.release();
    const interrupted = await upload;
    expect(interrupted.statusCode).toBe(409);
    expect(interrupted.json().error.code).toBe("DOCUMENT_UPLOAD_INTERRUPTED");
    expect(await storage.get(staged.storageKey)).toBeNull();
    const purged = await runDataLifecycle(context.db, storage, { now: new Date(staged.updatedAt.getTime() + 20 * 60_000), accountRetentionDays: 0 });
    expect(purged.tenantAccountsDeleted).toBe(1);
    expect(await context.db.select().from(applicationDocuments)).toHaveLength(0);
    expect(await context.db.select().from(documentStorageCleanup)).toHaveLength(0);
  });

  it("accepts a configured 10 MiB document through the global JSON body limit and rejects the EICAR fixture", async () => {
    const tenMiB = Buffer.alloc(10 * 1024 * 1024);
    tenMiB.write("%PDF-");
    const large = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: tenMiB.toString("base64") } });
    expect(large.statusCode).toBe(201);
    expect(large.json().data.document.byteSize).toBe(10 * 1024 * 1024);

    const eicar = Buffer.from("%PDF-X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "ascii").toString("base64");
    const infected = await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "payslips", originalName: "infectado.pdf", contentType: "application/pdf", dataBase64: eicar } });
    expect(infected.statusCode).toBe(422);
    expect(infected.json().error.code).toBe("DOCUMENT_INFECTED");
  });

  it("warns about overlaps and transitions appointments without mutating applicant status", async () => {
    const payload = { applicationId: ids.applicationA, startsAt: "2098-08-10T18:00:00+02:00", durationMinutes: 30, responsibleUserId: ids.adminA, instructions: "Portal principal", internalNote: "Llevar ficha" };
    const first = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-create-0001" }, payload });
    expect(first.statusCode).toBe(201);
    expect(first.json().data.warnings).toHaveLength(0);
    const propertyList = await context.app.inject({ method: "GET", url: "/api/v1/agency/properties", headers: { cookie: cookies.adminA } });
    const listedProperty = propertyList.json().data.properties.find((row: { property: { id: string } }) => row.property.id === ids.propertyA);
    expect(listedProperty.nextViewing.id).toBe(first.json().data.appointment.id);
    expect(listedProperty.nextViewing).not.toHaveProperty("idempotencyKeyHash");
    expect(listedProperty.nextViewing).not.toHaveProperty("requestFingerprint");
    const applicantList = await context.app.inject({ method: "GET", url: `/api/v1/agency/properties/${ids.propertyA}/applications`, headers: { cookie: cookies.adminA } });
    const listedApplicant = applicantList.json().data.applications.find((row: { application: { id: string } }) => row.application.id === ids.applicationA);
    expect(listedApplicant.nextViewing.id).toBe(first.json().data.appointment.id);
    expect(listedApplicant.nextViewing).not.toHaveProperty("idempotencyKeyHash");
    expect(listedApplicant.nextViewing).not.toHaveProperty("requestFingerprint");
    const second = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-create-0002" }, payload: { ...payload, startsAt: "2098-08-10T18:15:00+02:00" } });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.warnings[0].code).toBe("RESPONSIBLE_USER_OVERLAP");

    const appointmentId = first.json().data.appointment.id as string;
    const createdUpdatedAt = first.json().data.appointment.updatedAt as string;
    const cleared = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointmentId}`, headers: { cookie: cookies.adminA }, payload: { action: "reschedule", expectedUpdatedAt: createdUpdatedAt, startsAt: "2098-08-10T20:00:00+02:00", instructions: null, internalNote: null } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.appointment.instructions).toBeNull();
    expect(cleared.json().data.appointment.internalNote).toBeNull();
    const complete = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointmentId}`, headers: { cookie: cookies.adminA }, payload: { action: "complete", expectedUpdatedAt: cleared.json().data.appointment.updatedAt } });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.appointment.state).toBe("completed");
    const finalAgain = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointmentId}`, headers: { cookie: cookies.adminA }, payload: { action: "cancel", expectedUpdatedAt: complete.json().data.appointment.updatedAt } });
    expect(finalAgain.statusCode).toBe(409);
    expect((await context.db.select().from(applications))[0]?.status).toBe("new");
    expect((await context.db.select().from(appointments))).toHaveLength(2);
  });

  it("allows a visit to remain indefinite and assigns its worker independently from the applicant", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/v1/agency/appointments",
      headers: { cookie: cookies.adminA, "idempotency-key": "appointment-indefinite-0001" },
      payload: { applicationId: ids.applicationA, startsAt: "2098-08-12T18:00:00+02:00", durationMinutes: 30, instructions: null, internalNote: null },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ appointment: { responsibleUserId: null }, warnings: [] });

    const appointmentId = created.json().data.appointment.id as string;
    const detail = await context.app.inject({ method: "GET", url: `/api/v1/agency/appointments/${appointmentId}`, headers: { cookie: cookies.adminA } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.appointment).toMatchObject({ responsibleUserId: null, responsibleUserName: null });

    const assigned = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/agency/appointments/${appointmentId}`,
      headers: { cookie: cookies.adminA },
      payload: { action: "reschedule", expectedUpdatedAt: created.json().data.appointment.updatedAt, startsAt: "2098-08-12T19:00:00+02:00", responsibleUserId: ids.collaboratorA },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data.appointment.responsibleUserId).toBe(ids.collaboratorA);

    const indefiniteAgain = await context.app.inject({
      method: "PATCH",
      url: `/api/v1/agency/appointments/${appointmentId}`,
      headers: { cookie: cookies.adminA },
      payload: { action: "reschedule", expectedUpdatedAt: assigned.json().data.appointment.updatedAt, startsAt: "2098-08-12T20:00:00+02:00", responsibleUserId: null },
    });
    expect(indefiniteAgain.statusCode).toBe(200);
    expect(indefiniteAgain.json().data).toMatchObject({ appointment: { responsibleUserId: null }, warnings: [] });
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))[0]?.responsibleUserId).toBe(ids.adminA);
  });

  it("keeps appointment retries free of self-overlaps and serializes concurrent overlap warnings", async () => {
    const base = { applicationId: ids.applicationA, startsAt: "2098-11-10T18:00:00+02:00", durationMinutes: 30, responsibleUserId: ids.adminA, instructions: null, internalNote: null };
    const headers = { cookie: cookies.adminA, "idempotency-key": "appointment-stable-replay-0001" };
    const first = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers, payload: base });
    const replay = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers, payload: base });
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ appointment: { id: first.json().data.appointment.id }, warnings: first.json().data.warnings, idempotentReplay: true });
    expect(replay.json().data.warnings.some((warning: { appointmentId: string }) => warning.appointmentId === first.json().data.appointment.id)).toBe(false);

    const concurrentPayload = { ...base, startsAt: "2098-11-11T18:00:00+02:00" };
    const [one, two] = await Promise.all([
      context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-overlap-race-0001" }, payload: concurrentPayload }),
      context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-overlap-race-0002" }, payload: { ...concurrentPayload, startsAt: "2098-11-11T18:15:00+02:00" } }),
    ]);
    expect([one.statusCode, two.statusCode]).toEqual([201, 201]);
    expect([one.json().data.warnings.length, two.json().data.warnings.length].sort()).toEqual([0, 1]);
  });

  it("correlates appointment mail and expires stale confirmations on reschedule and cancellation", async () => {
    const created = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-email-correlation-0001" }, payload: {
      applicationId: ids.applicationA, startsAt: "2098-12-10T18:00:00+02:00", durationMinutes: 30,
      responsibleUserId: ids.adminA, instructions: null, internalNote: null,
    } });
    expect(created.statusCode).toBe(201);
    const appointment = created.json().data.appointment;
    const createdMessage = context.emailProvider.messages.find((message) => message.template === "viewing_created")!;
    expect(createdMessage).toMatchObject({ subjectType: "appointment", subjectId: appointment.id });
    await context.db.insert(emailOutbox).values({
      id: newId(), userId: createdMessage.userId, agencyId: createdMessage.agencyId,
      subjectType: createdMessage.subjectType, subjectId: createdMessage.subjectId,
      recipient: createdMessage.recipient, template: createdMessage.template, variables: createdMessage.variables,
      dedupeKey: createdMessage.dedupeKey, state: "pending", attempts: 0,
      availableAt: new Date("2026-08-08T10:00:00.000Z"), expiresAt: new Date("2099-01-01T00:00:00.000Z"), createdAt: new Date("2026-08-08T10:00:00.000Z"),
    });
    const rescheduled = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointment.id}`, headers: { cookie: cookies.adminA }, payload: {
      action: "reschedule", expectedUpdatedAt: appointment.updatedAt, startsAt: "2098-12-10T19:00:00+02:00",
    } });
    expect(rescheduled.statusCode).toBe(200);
    const rescheduledMessage = context.emailProvider.messages.find((message) => message.template === "viewing_rescheduled")!;
    expect(rescheduledMessage).toMatchObject({ subjectType: "appointment", subjectId: appointment.id });
    await context.db.insert(emailOutbox).values({
      id: newId(), userId: rescheduledMessage.userId, agencyId: rescheduledMessage.agencyId,
      subjectType: rescheduledMessage.subjectType, subjectId: rescheduledMessage.subjectId,
      recipient: rescheduledMessage.recipient, template: rescheduledMessage.template, variables: rescheduledMessage.variables,
      dedupeKey: rescheduledMessage.dedupeKey, state: "pending", attempts: 0,
      availableAt: new Date("2026-08-08T10:01:00.000Z"), expiresAt: new Date("2099-01-01T00:00:00.000Z"), createdAt: new Date("2026-08-08T10:01:00.000Z"),
    });
    const cancelled = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointment.id}`, headers: { cookie: cookies.adminA }, payload: {
      action: "cancel", expectedUpdatedAt: rescheduled.json().data.appointment.updatedAt,
    } });
    expect(cancelled.statusCode).toBe(200);

    const mail = await context.db.select().from(emailOutbox).where(eq(emailOutbox.subjectId, appointment.id));
    expect(mail).toHaveLength(2);
    expect(mail.every((message) => message.subjectType === "appointment")).toBe(true);
    expect(mail).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: "APPOINTMENT_CHANGED" }),
      expect.objectContaining({ state: "expired", recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: "APPOINTMENT_CHANGED" }),
    ]));
    expect(context.emailProvider.messages.find((message) => message.template === "viewing_cancelled")).toMatchObject({ subjectType: "appointment", subjectId: appointment.id });
  });

  it("rolls back appointment creation when its durable notification cannot be enqueued", async () => {
    const payload = { applicationId: ids.applicationA, startsAt: "2098-10-10T18:00:00+02:00", durationMinutes: 30, responsibleUserId: ids.adminA, instructions: null, internalNote: null };
    const headers = { cookie: cookies.adminA, "idempotency-key": "appointment-atomic-0001" };
    context.emailProvider.failTemplateOnce = "viewing_created";
    const failed = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers, payload });
    expect(failed.statusCode).toBe(500);
    expect(await context.db.select().from(appointments)).toHaveLength(0);
    expect((await context.db.select().from(auditEvents)).filter((event) => event.action === "appointment_scheduled")).toHaveLength(0);
    const retry = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers, payload });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().data.idempotentReplay).toBe(false);
  });

  it("prevents a retained application from being reopened while external deletion is in flight", async () => {
    const pdf = Buffer.from("%PDF-retention-race").toString("base64");
    expect((await context.app.inject({ method: "POST", url: `/api/v1/tenant/applications/${ids.applicationA}/documents`, headers: { cookie: cookies.tenantA }, payload: { category: "payslips", originalName: "nominas.pdf", contentType: "application/pdf", dataBase64: pdf } })).statusCode).toBe(201);
    await context.db.update(applications).set({ status: "rejected", updatedAt: new Date("2025-01-01T00:00:00.000Z") }).where(eq(applications.id, ids.applicationA));
    const claimed = await runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T12:00:00.000Z"), retentionDays: 30 });
    expect(claimed).toMatchObject({ applicationsDeleted: 0, applicationsDeferred: 1 });
    const barrier = storage.blockNextDelete();
    const lifecycle = runDataLifecycle(context.db, storage, { now: new Date("2098-08-08T12:01:00.000Z"), retentionDays: 30 });
    await barrier.entered;
    const reopen = await context.app.inject({ method: "PATCH", url: `/api/v1/agency/applications/${ids.applicationA}/status`, headers: { cookie: cookies.adminA }, payload: { status: "selected", expectedStatus: "rejected" } });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error.code).toBe("APPLICATION_RETENTION_IN_PROGRESS");
    // PGlite wraps trigger failures without preserving the PostgreSQL cause
    // message. The invariant is the rejection; the route assertion above
    // independently verifies the stable public 409/code mapping.
    await expect(context.db.update(applications).set({ status: "selected" }).where(eq(applications.id, ids.applicationA))).rejects.toBeTruthy();
    barrier.release();
    expect(await lifecycle).toMatchObject({ applicationsDeleted: 1, applicationsDeferred: 0 });
    expect((await context.db.select().from(applications).where(eq(applications.id, ids.applicationA)))).toHaveLength(0);
  });

  it("allows only one concurrent appointment mutation for the same version", async () => {
    const created = await context.app.inject({ method: "POST", url: "/api/v1/agency/appointments", headers: { cookie: cookies.adminA, "idempotency-key": "appointment-concurrency-0001" }, payload: { applicationId: ids.applicationA, startsAt: "2098-09-10T18:00:00+02:00", durationMinutes: 30, responsibleUserId: ids.adminA, instructions: null, internalNote: null } });
    const appointment = created.json().data.appointment;
    const [reschedule, cancel] = await Promise.all([
      context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointment.id}`, headers: { cookie: cookies.adminA }, payload: { action: "reschedule", expectedUpdatedAt: appointment.updatedAt, startsAt: "2098-09-10T19:00:00+02:00" } }),
      context.app.inject({ method: "PATCH", url: `/api/v1/agency/appointments/${appointment.id}`, headers: { cookie: cookies.collaboratorA }, payload: { action: "cancel", expectedUpdatedAt: appointment.updatedAt } }),
    ]);
    expect([reschedule.statusCode, cancel.statusCode].sort()).toEqual([200, 409]);
    const appointmentAudits = (await context.db.select().from(auditEvents)).filter((event) => event.subjectId === appointment.id && event.action !== "appointment_scheduled");
    expect(appointmentAudits).toHaveLength(1);
  });
});
