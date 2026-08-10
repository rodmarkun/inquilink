import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAgency, requireTenant, requireUser } from "../../auth/session.js";
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
  properties,
  users,
} from "../../db/schema.js";
import type { Database } from "../../db/client.js";
import { ApiError } from "../../lib/errors.js";
import { hashSecret, newId, newSecret } from "../../lib/ids.js";
import type { AppDependencies } from "../../types.js";
import { lockActiveAgency, lockAgencyForSystem } from "../agency-lock.js";
import { expireScheduledSubjectEmails } from "../email/subjects.js";
import { enforceListingActivationAllowance } from "../plan-allowances.js";
import { AesGcmPublicLinkTokenVault, type PublicLinkTokenVault } from "./public-link-vault.js";
import {
  decodeDocument,
  DocumentAccessTokens,
  LocalDeterministicDocumentScanner,
  LocalPrivateDocumentStorage,
  stableStorageKey,
  type DocumentScanner,
  type PrivateDocumentStorage,
} from "./storage.js";
import {
  adultProfilesFromApplication,
  DOCUMENT_CATEGORIES,
  missingDocumentsByAdult,
  normalizeCandidateEmail,
  normalizeCandidatePhone,
} from "./spanish-market.js";

const propertyStates = ["draft", "published", "paused", "archived"] as const;
const applicantStatuses = ["new", "preselected", "selected", "rejected", "withdrawn"] as const;
const agencyApplicantStatuses = ["new", "preselected", "selected", "rejected"] as const;
const documentStates = ["complete", "missing", "not_requested"] as const;
const documentCategories = DOCUMENT_CATEGORIES;
const appointmentStates = ["scheduled", "completed", "cancelled", "no_show"] as const;
const CURRENT_CONSENT_VERSION = "privacy-2026-08-v1";
const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

function pagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.ceil(total / pageSize);
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

const idParam = z.string().uuid();
const propertyInput = z.object({
  internalReference: z.string().trim().min(1).max(100),
  title: z.string().trim().min(2).max(240),
  address: z.string().trim().min(2).max(500),
  city: z.string().trim().min(2).max(120),
  province: z.string().trim().min(2).max(120),
  postalCode: z.string().trim().min(3).max(20),
  propertyType: z.string().trim().min(2).max(80),
  bedrooms: z.number().int().min(0).max(100),
  bathrooms: z.number().int().min(0).max(100),
  floorAreaSqm: z.number().int().positive().max(100_000),
  availableFrom: z.iso.date(),
  description: z.string().trim().min(2).max(5_000),
  publicLocation: z.string().trim().min(2).max(240),
  coverImageUrl: z.url().max(2_000).nullable().default(null),
  galleryUrls: z.array(z.url().max(2_000)).max(20).default([]),
  monthlyRentCents: z.number().int().positive().max(100_000_000),
  responsibleUserId: z.string().uuid().nullable().default(null),
  requestedDocumentCategories: z.array(z.enum(documentCategories)).max(documentCategories.length).default([]),
});
const propertyUpdateInput = z.object({
  internalReference: z.string().trim().min(1).max(100).optional(), title: z.string().trim().min(2).max(240).optional(),
  address: z.string().trim().min(2).max(500).optional(), city: z.string().trim().min(2).max(120).optional(), province: z.string().trim().min(2).max(120).optional(), postalCode: z.string().trim().min(3).max(20).optional(),
  propertyType: z.string().trim().min(2).max(80).optional(), bedrooms: z.number().int().min(0).max(100).optional(), bathrooms: z.number().int().min(0).max(100).optional(), floorAreaSqm: z.number().int().positive().max(100_000).optional(),
  availableFrom: z.iso.date().optional(), description: z.string().trim().min(2).max(5_000).optional(), publicLocation: z.string().trim().min(2).max(240).optional(),
  coverImageUrl: z.url().max(2_000).nullable().optional(), galleryUrls: z.array(z.url().max(2_000)).max(20).optional(), monthlyRentCents: z.number().int().positive().max(100_000_000).optional(),
  responsibleUserId: z.string().uuid().nullable().optional(), requestedDocumentCategories: z.array(z.enum(documentCategories)).max(documentCategories.length).optional(),
  expectedVersion: z.number().int().positive().optional(),
}).refine((value) => Object.entries(value).some(([key, item]) => key !== "expectedVersion" && item !== undefined), "Incluye al menos un cambio.");

const additionalAdult = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().min(2).max(200),
  email: z.email().max(320).nullable().default(null),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).nullable().default(null),
  employmentStatus: z.string().trim().min(1).max(100),
  employerOrActivity: z.string().trim().min(1).max(200),
  contractType: z.string().trim().min(1).max(100),
  netMonthlyIncomeCents: z.number().int().min(0).max(100_000_000),
}).strict();
const additionalAdultDraft = z.object({
  id: z.string().uuid(),
  fullName: z.string().trim().max(200).optional(),
  email: z.union([z.email().max(320), z.literal("")]).nullable().optional(),
  phone: z.union([z.string().trim().regex(/^\+[1-9]\d{7,14}$/), z.literal("")]).nullable().optional(),
  employmentStatus: z.string().trim().max(100).optional(),
  employerOrActivity: z.string().trim().max(200).optional(),
  contractType: z.string().trim().max(100).optional(),
  netMonthlyIncomeCents: z.number().int().min(0).max(100_000_000).optional(),
}).strict();

const applicationFormFields = z.object({
  fullName: z.string().trim().min(2).max(200),
  email: z.email().max(320),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  preferredContactChannel: z.enum(["whatsapp", "phone", "email"]),
  adultOccupants: z.number().int().min(1).max(20),
  additionalAdults: z.array(additionalAdult).max(19).default([]),
  minorOccupants: z.number().int().min(0).max(20),
  intendedMoveInDate: z.iso.date(),
  pets: z.enum(["yes", "no"]),
  petDetails: z.string().trim().max(500).nullable().default(null),
  message: z.string().trim().max(2_000).nullable().default(null),
  employmentStatus: z.string().trim().min(1).max(100),
  employerOrActivity: z.string().trim().min(1).max(200),
  contractType: z.string().trim().min(1).max(100),
  individualNetMonthlyIncomeCents: z.number().int().min(0).max(100_000_000),
  householdNetMonthlyIncomeCents: z.number().int().min(0).max(100_000_000),
  guarantorAvailability: z.enum(["yes", "no", "unsure"]),
  viewingAvailability: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  availabilityNote: z.string().trim().max(1_000).nullable().default(null),
  marketingConsent: z.boolean().default(false),
});
const applicationForm = applicationFormFields.superRefine((value, context) => {
  if (value.adultOccupants !== value.additionalAdults.length + 1) {
    context.addIssue({
      code: "custom",
      message: "Incluye los datos de cada persona adulta que formará parte de la solicitud.",
      path: ["additionalAdults"],
    });
  }
  const ids = value.additionalAdults.map((adult) => adult.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Cada persona adulta debe tener un identificador distinto.", path: ["additionalAdults"] });
  }
});

const applicationDraft = applicationFormFields.partial().extend({
  additionalAdults: z.array(additionalAdultDraft).max(19).optional(),
  viewingAvailability: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

function adultProfilesForDraft(draft: z.infer<typeof applicationDraft>) {
  if (!draft.fullName || !draft.email || !draft.phone || !draft.employmentStatus || !draft.employerOrActivity || !draft.contractType || draft.individualNetMonthlyIncomeCents === undefined) return null;
  const additionalAdults = z.array(additionalAdult).safeParse(draft.additionalAdults ?? []);
  if (!additionalAdults.success) return null;
  return adultProfilesFromApplication({
    fullName: draft.fullName, email: draft.email, phone: draft.phone,
    employmentStatus: draft.employmentStatus, employerOrActivity: draft.employerOrActivity,
    contractType: draft.contractType, individualNetMonthlyIncomeCents: draft.individualNetMonthlyIncomeCents,
    additionalAdults: additionalAdults.data,
  });
}
const appointmentInput = z.object({
  applicationId: z.string().uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(480),
  responsibleUserId: z.string().uuid().nullable().default(null),
  instructions: z.string().trim().max(1_000).nullable().default(null),
  internalNote: z.string().trim().max(2_000).nullable().default(null),
});

export interface RentalRouteOptions {
  storage?: PrivateDocumentStorage;
  scanner?: DocumentScanner;
  accessTokens?: DocumentAccessTokens;
  publicLinkVault?: PublicLinkTokenVault;
  maxDocumentBytes?: number;
  documentAccessTtlSeconds?: number;
  /** Deterministic integration-test seam immediately before draft/submit write locking. */
  beforeApplicationWrite?: (operation: "draft" | "submit") => Promise<void>;
  /** Deterministic integration-test seam immediately before an agency mutation acquires its closure fence. */
  beforeAgencyWrite?: (operation: "property" | "applicant" | "document_access" | "appointment") => Promise<void>;
  /** Deterministic integration-test seam immediately before a sensitive agency read revalidates membership. */
  beforeAgencySensitiveRead?: (operation: "applicant") => Promise<void>;
  /** Deterministic integration-test seam after document state is derived but before it is persisted under the agency fence. */
  beforeDocumentStateWrite?: (applicationId: string) => Promise<void>;
}

export const AGENCY_RENTAL_MUTATION_ROUTES = [
  "POST /api/v1/agency/properties",
  "PATCH /api/v1/agency/properties/:propertyId",
  "POST /api/v1/agency/properties/:propertyId/publish",
  "POST /api/v1/agency/properties/:propertyId/pause",
  "POST /api/v1/agency/properties/:propertyId/archive",
  "POST /api/v1/agency/properties/:propertyId/public-link/regenerate",
  "DELETE /api/v1/agency/properties/:propertyId/public-link",
  "PATCH /api/v1/agency/applications/:applicationId/status",
  "PATCH /api/v1/agency/applications/:applicationId/responsible-user",
  "POST /api/v1/agency/applications/:applicationId/notes",
  "POST /api/v1/agency/applications/:applicationId/whatsapp",
  "POST /api/v1/agency/applications/:applicationId/documents/:documentId/access",
  "GET /api/v1/documents/:documentId/content (agency audit write)",
  "POST /api/v1/agency/appointments",
  "PATCH /api/v1/agency/appointments/:appointmentId",
] as const;

function nowFor(deps: AppDependencies): Date {
  return (deps.now ?? (() => new Date()))();
}

function databaseConstraint(error: unknown): { code: string | null; constraint: string | null } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof value.code === "string" || typeof value.constraint === "string") {
      return { code: typeof value.code === "string" ? value.code : null, constraint: typeof value.constraint === "string" ? value.constraint : null };
    }
    current = value.cause;
  }
  return { code: null, constraint: null };
}

function rethrowPropertyReferenceConflict(error: unknown): never {
  const database = databaseConstraint(error);
  if (database.code === "23505" && database.constraint === "properties_agency_reference_unique") {
    throw new ApiError(409, "PROPERTY_REFERENCE_EXISTS", "Ya existe un anuncio con esa referencia interna en la agencia.");
  }
  throw error;
}

function idempotencyKey(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = z.string().trim().min(16).max(200).safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Incluye una clave Idempotency-Key válida para poder reintentar la operación con seguridad.");
  }
  return parsed.data;
}

function publicLink(deps: AppDependencies, token: string): string {
  return `${deps.config.APP_ORIGIN.replace(/\/$/, "")}/solicitud/${token}`;
}

async function assertAgencyMember(db: Database, agencyId: string, userId: string): Promise<void> {
  const rows = await db.select({ userId: agencyMemberships.userId }).from(agencyMemberships)
    .where(and(eq(agencyMemberships.agencyId, agencyId), eq(agencyMemberships.userId, userId))).limit(1);
  if (!rows[0]) throw new ApiError(400, "INVALID_RESPONSIBLE_USER", "La persona responsable no pertenece a esta agencia.");
}

async function agencyProperty(deps: AppDependencies, agencyId: string, propertyId: string) {
  const rows = await deps.db.select().from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agencyId))).limit(1);
  if (!rows[0]) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");
  return rows[0];
}

async function agencyApplication(deps: AppDependencies, agencyId: string, applicationId: string) {
  const rows = await deps.db.select().from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.agencyId, agencyId), isNotNull(applications.submittedAt))).limit(1);
  if (!rows[0]) throw new ApiError(404, "APPLICATION_NOT_FOUND", "No se ha encontrado la solicitud.");
  return rows[0];
}

async function tenantApplication(deps: AppDependencies, tenantUserId: string, applicationId: string) {
  const rows = await deps.db.select().from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.tenantUserId, tenantUserId))).limit(1);
  if (!rows[0]) throw new ApiError(404, "APPLICATION_NOT_FOUND", "No se ha encontrado la solicitud.");
  return rows[0];
}

async function propertyForToken(deps: AppDependencies, token: string) {
  const tokenHash = hashSecret(token);
  const rows = await deps.db.select({ property: properties, agencyName: agencies.name, agencyAccountState: agencies.accountState })
    .from(properties).innerJoin(agencies, eq(agencies.id, properties.agencyId))
    .where(eq(properties.publicLinkTokenHash, tokenHash)).limit(1);
  const row = rows[0];
  if (!row) throw new ApiError(404, "PUBLIC_LINK_INVALID", "Este enlace no es válido.");
  if (row.property.state !== "published") {
    throw new ApiError(410, "PUBLIC_LINK_INACTIVE", "Esta solicitud ya no está activa.");
  }
  if (row.agencyAccountState !== "active") {
    throw new ApiError(410, "AGENCY_ACCOUNT_CLOSED", "La agencia ya no acepta solicitudes mediante este enlace.");
  }
  return { ...row, tokenHash };
}

async function lockPublishedPropertyForToken(
  db: Database,
  propertyId: string,
  agencyId: string,
  tokenHash: string,
): Promise<typeof properties.$inferSelect> {
  const rows = await db.select().from(properties).where(and(
    eq(properties.id, propertyId), eq(properties.agencyId, agencyId),
  )).for("update").limit(1);
  const property = rows[0];
  if (!property || property.publicLinkTokenHash !== tokenHash) {
    throw new ApiError(404, "PUBLIC_LINK_INVALID", "Este enlace no es válido.");
  }
  if (property.state !== "published") {
    throw new ApiError(410, "PUBLIC_LINK_INACTIVE", "Esta solicitud ya no está activa.");
  }
  return property;
}

function publicProperty(record: Awaited<ReturnType<typeof propertyForToken>>) {
  const property = record.property;
  return {
    id: property.id,
    agencyName: record.agencyName,
    internalReference: property.internalReference,
    title: property.title,
    publicLocation: property.publicLocation ?? property.city,
    monthlyRentCents: property.monthlyRentCents,
    propertyType: property.propertyType,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    floorAreaSqm: property.floorAreaSqm,
    availableFrom: property.availableFrom,
    description: property.description,
    coverImageUrl: property.coverImageUrl,
    galleryUrls: property.galleryUrls,
    requestedDocumentCategories: property.requestedDocumentCategories,
    consentVersion: CURRENT_CONSENT_VERSION,
  };
}

function safeApplication<T extends typeof applications.$inferSelect>(application: T) {
  const { sourceLinkTokenHash: _sourceLinkTokenHash, submissionKeyHash: _submissionKeyHash, normalizedEmail: _normalizedEmail, normalizedPhone: _normalizedPhone, ...safe } = application;
  return safe;
}

function assertApplicationActive(application: typeof applications.$inferSelect): void {
  if (application.retentionState === "deleting") {
    throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
  }
}

function safeProperty<T extends typeof properties.$inferSelect>(property: T) {
  const {
    publicLinkTokenHash: _publicLinkTokenHash,
    publicLinkTokenCiphertext: _publicLinkTokenCiphertext,
    lastMutationKeyHash: _lastMutationKeyHash,
    lastMutationOperation: _lastMutationOperation,
    lastMutationVersion: _lastMutationVersion,
    ...safe
  } = property;
  return safe;
}

function safeAppointment<T extends typeof appointments.$inferSelect>(appointment: T) {
  const { idempotencyKeyHash: _idempotencyKeyHash, requestFingerprint: _requestFingerprint, ...safe } = appointment;
  return safe;
}

function openPublicLinkToken(providers: ReturnType<typeof providerConfig>, property: typeof properties.$inferSelect): string {
  if (!property.publicLinkTokenHash || !property.publicLinkTokenCiphertext || !property.publicLinkIssuedAt) {
    throw new ApiError(409, "PUBLIC_LINK_NOT_RECOVERABLE", "El enlace actual no se puede recuperar. Regénéralo antes de volver a publicar.");
  }
  const token = providers.publicLinkVault.open(property.id, property.publicLinkTokenCiphertext);
  if (hashSecret(token) !== property.publicLinkTokenHash) {
    throw new ApiError(500, "PUBLIC_LINK_VAULT_INTEGRITY", "No se ha podido recuperar el enlace público.");
  }
  return token;
}

function safeDocument<T extends typeof applicationDocuments.$inferSelect>(document: T) {
  const { storageKey: _storageKey, tenantUserId: _tenantUserId, agencyId: _agencyId, ...safe } = document;
  return safe;
}

type DuplicateApplication = Pick<typeof applications.$inferSelect, "id" | "normalizedEmail" | "normalizedPhone">;

async function duplicateSignals(db: Database, propertyId: string, candidates: DuplicateApplication[]) {
  const phones = [...new Set(candidates.map((item) => item.normalizedPhone).filter((value): value is string => Boolean(value)))];
  const emails = [...new Set(candidates.map((item) => item.normalizedEmail).filter((value): value is string => Boolean(value)))];
  if (!phones.length && !emails.length) return new Map<string, { matchedOn: Array<"email" | "phone">; applicationIds: string[] }>();
  const matching = await db.select({ id: applications.id, normalizedEmail: applications.normalizedEmail, normalizedPhone: applications.normalizedPhone })
    .from(applications).where(and(
      eq(applications.propertyId, propertyId),
      isNotNull(applications.submittedAt),
      or(phones.length ? inArray(applications.normalizedPhone, phones) : undefined, emails.length ? inArray(applications.normalizedEmail, emails) : undefined)!,
    ));
  const result = new Map<string, { matchedOn: Array<"email" | "phone">; applicationIds: string[] }>();
  for (const candidate of candidates) {
    const peers = matching.filter((item) => item.id !== candidate.id && (
      (candidate.normalizedEmail && item.normalizedEmail === candidate.normalizedEmail)
      || (candidate.normalizedPhone && item.normalizedPhone === candidate.normalizedPhone)
    ));
    if (!peers.length) continue;
    result.set(candidate.id, {
      matchedOn: [
        ...(candidate.normalizedEmail && peers.some((peer) => peer.normalizedEmail === candidate.normalizedEmail) ? ["email" as const] : []),
        ...(candidate.normalizedPhone && peers.some((peer) => peer.normalizedPhone === candidate.normalizedPhone) ? ["phone" as const] : []),
      ],
      applicationIds: peers.map((peer) => peer.id),
    });
  }
  return result;
}

async function refreshDocumentStateLocked(
  db: Database,
  applicationId: string,
  agencyId: string,
  changedAt: Date,
  beforeWrite?: (applicationId: string) => Promise<void>,
): Promise<void> {
  const applicationRows = await db.select({ propertyId: applications.propertyId, retentionState: applications.retentionState, adultProfiles: applications.adultProfiles })
    .from(applications).where(and(eq(applications.id, applicationId), eq(applications.agencyId, agencyId))).for("update").limit(1);
  const application = applicationRows[0];
  if (!application || application.retentionState !== "active") return;
  const propertyRows = await db.select({ requested: properties.requestedDocumentCategories }).from(properties)
    .where(and(eq(properties.id, application.propertyId), eq(properties.agencyId, agencyId))).for("update").limit(1);
  const requested = propertyRows[0]?.requested ?? [];
  let state: (typeof documentStates)[number] = "not_requested";
  if (requested.length > 0) {
    const docs = await db.select({ category: applicationDocuments.category, adultProfileId: applicationDocuments.adultProfileId }).from(applicationDocuments)
      .where(and(eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.agencyId, agencyId), eq(applicationDocuments.malwareScanState, "clean"), eq(applicationDocuments.deletionState, "active")));
    state = missingDocumentsByAdult(requested, application.adultProfiles.length ? application.adultProfiles : [{ id: "primary" }], docs).length === 0 ? "complete" : "missing";
  }
  await beforeWrite?.(applicationId);
  await db.update(applications).set({ documentState: state, updatedAt: changedAt })
    .where(and(eq(applications.id, applicationId), eq(applications.agencyId, agencyId), eq(applications.retentionState, "active")));
}

async function overlapWarnings(db: Database, input: {
  agencyId: string;
  responsibleUserId: string | null;
  startsAt: Date;
  durationMinutes: number;
  excludeId?: string;
}) {
  if (!input.responsibleUserId) return [];
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const clauses = [
    eq(appointments.agencyId, input.agencyId),
    eq(appointments.responsibleUserId, input.responsibleUserId),
    eq(appointments.state, "scheduled" as const),
    sql`${appointments.startsAt} < ${endsAt}`,
    sql`${appointments.startsAt} + (${appointments.durationMinutes} * interval '1 minute') > ${input.startsAt}`,
  ];
  if (input.excludeId) clauses.push(ne(appointments.id, input.excludeId));
  return db.select({ appointmentId: appointments.id, startsAt: appointments.startsAt, durationMinutes: appointments.durationMinutes })
    .from(appointments).where(and(...clauses));
}

function providerConfig(deps: AppDependencies, options: RentalRouteOptions) {
  if ((!options.storage || !options.scanner) && !deps.config.ALLOW_LOCAL_PROVIDERS) {
    throw new Error("PRIVATE_DOCUMENT_PROVIDERS_REQUIRED");
  }
  return {
    storage: options.storage ?? new LocalPrivateDocumentStorage(deps.config.DOCUMENT_STORAGE_PATH),
    scanner: options.scanner ?? new LocalDeterministicDocumentScanner(),
    accessTokens: options.accessTokens ?? new DocumentAccessTokens(),
    publicLinkVault: options.publicLinkVault ?? new AesGcmPublicLinkTokenVault(deps.config.PUBLIC_LINK_VAULT_SECRET),
    maxBytes: options.maxDocumentBytes ?? deps.config.DOCUMENT_MAX_BYTES,
    accessTtlSeconds: options.documentAccessTtlSeconds ?? deps.config.DOCUMENT_ACCESS_TTL_SECONDS,
  };
}

export function registerRentalRoutes(app: FastifyInstance, deps: AppDependencies, options: RentalRouteOptions = {}): void {
  const providers = providerConfig(deps, options);

  async function enqueueApplicationNotifications(
    transaction: Pick<Database, "insert">,
    input: { applicationId: string; tenantUserId: string; agencyId: string; tenantEmail: string; propertyTitle: string; agencyName: string; administrators: Array<{ userId: string; email: string }> },
  ): Promise<void> {
    await deps.emailProvider.send({
      userId: input.tenantUserId,
      agencyId: input.agencyId,
      recipient: input.tenantEmail,
      template: "application_received",
      variables: { propertyTitle: input.propertyTitle, agencyName: input.agencyName },
      dedupeKey: `application:${input.applicationId}:tenant-received`,
    }, { transaction });
    for (const administrator of input.administrators) {
      await deps.emailProvider.send({
        userId: administrator.userId,
        agencyId: input.agencyId,
        recipient: administrator.email,
        template: "new_applicant",
        variables: { propertyTitle: input.propertyTitle },
        dedupeKey: `application:${input.applicationId}:agency-admin:${administrator.userId}`,
      }, { transaction });
    }
  }

  app.post("/api/v1/agency/properties", { schema: { tags: ["Agencia"], summary: "Crear un anuncio" } }, async (request, reply) => {
    const { user, agency } = requireAgency(request);
    const input = propertyInput.parse(request.body);
    if (input.responsibleUserId) await assertAgencyMember(deps.db, agency.id, input.responsibleUserId);
    const createdAt = nowFor(deps);
    const id = newId();
    await options.beforeAgencyWrite?.("property");
    try {
      await deps.db.transaction(async (tx) => {
        await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
        if (input.responsibleUserId) await assertAgencyMember(tx as unknown as Database, agency.id, input.responsibleUserId);
        await tx.insert(properties).values({ id, agencyId: agency.id, ...input, state: "draft", createdAt, updatedAt: createdAt });
      });
    } catch (error) { rethrowPropertyReferenceConflict(error); }
    return reply.status(201).send({ data: { property: safeProperty(await agencyProperty(deps, agency.id, id)) } });
  });

  app.get("/api/v1/agency/properties", { schema: { tags: ["Agencia"], summary: "Listar anuncios" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const query = z.object({ propertyId: z.string().uuid().optional(), search: z.string().trim().max(200).optional(), state: z.enum(propertyStates).optional(), hasRecentNewApplicants: z.literal("true").optional(), ...paginationQuery }).parse(request.query);
    const clauses = [eq(properties.agencyId, agency.id)];
    if (query.propertyId) clauses.push(eq(properties.id, query.propertyId));
    if (query.state) clauses.push(eq(properties.state, query.state));
    if (query.search) {
      const term = `%${query.search}%`;
      clauses.push(or(ilike(properties.title, term), ilike(properties.internalReference, term), ilike(properties.address, term))!);
    }
    const recentApplicantCutoff = new Date(nowFor(deps).getTime() - (30 * 24 * 60 * 60 * 1000));
    if (query.hasRecentNewApplicants) clauses.push(sql`exists (select 1 from ${applications} recent_application where recent_application.property_id = ${properties.id} and recent_application.agency_id = ${agency.id} and recent_application.status = 'new' and recent_application.submitted_at >= ${recentApplicantCutoff})`);
    const totalRows = await deps.db.select({ total: count() }).from(properties).where(and(...clauses));
    const total = totalRows[0]?.total ?? 0;
    const rows = await deps.db.select({
      property: properties,
      applicantCount: sql<number>`count(${applications.id})::int`,
      newApplicantCount: sql<number>`count(${applications.id}) filter (where ${applications.status} = 'new' and ${applications.submittedAt} is not null)::int`,
      recentNewApplicantCount: sql<number>`count(${applications.id}) filter (where ${applications.status} = 'new' and ${applications.submittedAt} >= ${recentApplicantCutoff.toISOString()}::timestamptz)::int`,
    }).from(properties).leftJoin(applications, and(eq(applications.propertyId, properties.id), eq(applications.agencyId, agency.id), isNotNull(applications.submittedAt)))
      .where(and(...clauses)).groupBy(properties.id).orderBy(desc(properties.updatedAt), asc(properties.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const propertyIds = rows.map((row) => row.property.id);
    const viewingRows = propertyIds.length ? await deps.db.select({ appointment: appointments }).from(appointments)
      .innerJoin(applications, and(
        eq(applications.id, appointments.applicationId), eq(applications.agencyId, appointments.agencyId), eq(applications.propertyId, appointments.propertyId),
      ))
      .where(and(eq(appointments.agencyId, agency.id), inArray(appointments.propertyId, propertyIds), eq(appointments.state, "scheduled"), gte(appointments.startsAt, nowFor(deps))))
      .orderBy(asc(appointments.startsAt)) : [];
    const nextViewingByProperty = new Map<string, typeof appointments.$inferSelect>();
    for (const row of viewingRows) if (!nextViewingByProperty.has(row.appointment.propertyId)) nextViewingByProperty.set(row.appointment.propertyId, row.appointment);
    return { data: { properties: rows.map((row) => {
      const nextViewing = nextViewingByProperty.get(row.property.id);
      return { ...row, property: safeProperty(row.property), nextViewing: nextViewing ? safeAppointment(nextViewing) : null };
    }), pagination: pagination(query.page, query.pageSize, total) } };
  });

  app.patch("/api/v1/agency/properties/:propertyId", { schema: { tags: ["Agencia"], summary: "Editar un anuncio" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const propertyId = idParam.parse((request.params as { propertyId?: unknown }).propertyId);
    await agencyProperty(deps, agency.id, propertyId);
    const input = propertyUpdateInput.parse(request.body);
    const { expectedVersion, ...changes } = input;
    if (changes.responsibleUserId) await assertAgencyMember(deps.db, agency.id, changes.responsibleUserId);
    const changedAt = nowFor(deps);
    await options.beforeAgencyWrite?.("property");
    try { await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      if (changes.responsibleUserId) await assertAgencyMember(tx as unknown as Database, agency.id, changes.responsibleUserId);
      if (expectedVersion !== undefined) {
        const current = await tx.select({ version: properties.version }).from(properties)
          .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).for("update").limit(1);
        if (!current[0] || current[0].version !== expectedVersion) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        const updated = await tx.update(properties).set({ ...changes, version: expectedVersion + 1, updatedAt: changedAt })
          .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id), eq(properties.version, expectedVersion))).returning({ id: properties.id });
        if (!updated[0]) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
      } else {
        await tx.update(properties).set({ ...changes, updatedAt: changedAt })
          .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id)));
      }
      if (changes.requestedDocumentCategories !== undefined) {
        const applicationRows = await tx.select({ id: applications.id, adultProfiles: applications.adultProfiles }).from(applications)
          .where(and(eq(applications.propertyId, propertyId), eq(applications.agencyId, agency.id), eq(applications.retentionState, "active")));
        const applicationIds = applicationRows.map((application) => application.id);
        const documentRows = applicationIds.length ? await tx.select({ applicationId: applicationDocuments.applicationId, category: applicationDocuments.category, adultProfileId: applicationDocuments.adultProfileId }).from(applicationDocuments)
          .where(and(eq(applicationDocuments.agencyId, agency.id), inArray(applicationDocuments.applicationId, applicationIds), eq(applicationDocuments.malwareScanState, "clean"), eq(applicationDocuments.deletionState, "active"))) : [];
        const documentsByApplication = new Map<string, Array<{ category: string; adultProfileId: string }>>();
        for (const document of documentRows) {
          const grouped = documentsByApplication.get(document.applicationId) ?? [];
          grouped.push(document);
          documentsByApplication.set(document.applicationId, grouped);
        }
        for (const application of applicationRows) {
          const documentState = changes.requestedDocumentCategories.length === 0 ? "not_requested"
            : missingDocumentsByAdult(changes.requestedDocumentCategories, application.adultProfiles.length ? application.adultProfiles : [{ id: "primary" }], documentsByApplication.get(application.id) ?? []).length === 0 ? "complete" : "missing";
          await tx.update(applications).set({ documentState, updatedAt: changedAt })
            .where(and(eq(applications.id, application.id), eq(applications.agencyId, agency.id)));
        }
      }
    }); } catch (error) { rethrowPropertyReferenceConflict(error); }
    return { data: { property: safeProperty(await agencyProperty(deps, agency.id, propertyId)) } };
  });

  const changePropertyState = (state: "published" | "paused" | "archived") => async (request: FastifyRequest) => {
    const { user, agency } = requireAgency(request);
    const propertyId = idParam.parse((request.params as { propertyId?: unknown }).propertyId);
    await agencyProperty(deps, agency.id, propertyId);
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(request.body);
    const changedAt = nowFor(deps);
    const mutationKeyHash = state === "published" ? hashSecret(`${agency.id}:${propertyId}:publish:${idempotencyKey(request)}`) : null;
    await options.beforeAgencyWrite?.("property");
    return deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      const records = await tx.select().from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).for("update").limit(1);
      const record = records[0];
      if (!record) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");
      if (state === "published") {
        if (record.lastMutationOperation === "publish" && record.lastMutationKeyHash === mutationKeyHash && record.lastMutationVersion === record.version) {
          const token = openPublicLinkToken(providers, record);
          return { data: { property: safeProperty(record), publicLink: publicLink(deps, token), linkRotated: record.version === 2, idempotentReplay: true } };
        }
        if (record.version !== expectedVersion) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        if (record.state === "archived") throw new ApiError(409, "PROPERTY_ARCHIVED", "Un anuncio archivado no puede volver a publicarse.");
        if (record.state === "published") throw new ApiError(409, "PROPERTY_ALREADY_PUBLISHED", "El anuncio ya está publicado. Regenera el enlace solo si quieres revocar el anterior.");
        await enforceListingActivationAllowance(tx as unknown as Database, agency.id, record.state);
        const required = [record.address, record.postalCode, record.propertyType, record.bedrooms, record.bathrooms, record.floorAreaSqm, record.availableFrom, record.description, record.publicLocation];
        if (required.some((value) => value === null || value === "")) throw new ApiError(400, "PROPERTY_INCOMPLETE", "Completa los datos obligatorios antes de publicar.");
        const token = record.state === "paused" ? openPublicLinkToken(providers, record) : newSecret();
        const nextVersion = record.version + 1;
        const updated = await tx.update(properties).set({
          state,
          ...(record.state === "paused" ? {} : { publicLinkTokenHash: hashSecret(token), publicLinkTokenCiphertext: providers.publicLinkVault.seal(propertyId, token), publicLinkIssuedAt: changedAt }),
          version: nextVersion,
          lastMutationKeyHash: mutationKeyHash,
          lastMutationOperation: "publish",
          lastMutationVersion: nextVersion,
          updatedAt: changedAt,
        }).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id), eq(properties.state, record.state), eq(properties.version, expectedVersion))).returning();
        if (!updated[0]) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        return { data: { property: safeProperty(updated[0]), publicLink: publicLink(deps, token), linkRotated: record.state !== "paused", idempotentReplay: false } };
      }
      if (record.version !== expectedVersion) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
      if (record.state === state) return { data: { property: safeProperty(record), changed: false } };
      if (state === "paused" && record.state !== "published") throw new ApiError(409, "PROPERTY_NOT_PUBLISHED", "Solo se puede pausar un anuncio publicado.");
      const updated = await tx.update(properties).set({
        state,
        ...(state === "archived" ? { publicLinkTokenHash: null, publicLinkTokenCiphertext: null, publicLinkIssuedAt: null } : {}),
        version: record.version + 1,
        updatedAt: changedAt,
      }).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id), eq(properties.state, record.state), eq(properties.version, expectedVersion))).returning();
      if (!updated[0]) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
      return { data: { property: safeProperty(updated[0]), changed: true } };
    });
  };

  app.post("/api/v1/agency/properties/:propertyId/publish", { schema: { tags: ["Agencia"], summary: "Publicar y generar enlace" } }, changePropertyState("published"));
  app.post("/api/v1/agency/properties/:propertyId/pause", { schema: { tags: ["Agencia"], summary: "Pausar un anuncio" } }, changePropertyState("paused"));
  app.post("/api/v1/agency/properties/:propertyId/archive", { schema: { tags: ["Agencia"], summary: "Archivar un anuncio" } }, changePropertyState("archived"));

  app.post("/api/v1/agency/properties/:propertyId/public-link/regenerate", { schema: { tags: ["Agencia"], summary: "Regenerar el enlace público" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const propertyId = idParam.parse((request.params as { propertyId?: unknown }).propertyId);
    await agencyProperty(deps, agency.id, propertyId);
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(request.body);
    const mutationKeyHash = hashSecret(`${agency.id}:${propertyId}:regenerate:${idempotencyKey(request)}`);
    await options.beforeAgencyWrite?.("property");
    return deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      const records = await tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).for("update").limit(1);
      const record = records[0];
      if (!record) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");
      if (record.lastMutationOperation === "regenerate" && record.lastMutationKeyHash === mutationKeyHash && record.lastMutationVersion === record.version) {
        return { data: { publicLink: publicLink(deps, openPublicLinkToken(providers, record)), previousLinkRevoked: true, version: record.version, idempotentReplay: true } };
      }
      if (record.version !== expectedVersion) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
      if (record.state !== "published" && record.state !== "paused") throw new ApiError(409, "PROPERTY_NOT_PUBLISHED", "Publica el anuncio antes de regenerar el enlace.");
      const token = newSecret();
      const changedAt = nowFor(deps);
      const nextVersion = record.version + 1;
      const updated = await tx.update(properties).set({
        publicLinkTokenHash: hashSecret(token), publicLinkTokenCiphertext: providers.publicLinkVault.seal(propertyId, token), publicLinkIssuedAt: changedAt,
        version: nextVersion, lastMutationKeyHash: mutationKeyHash, lastMutationOperation: "regenerate", lastMutationVersion: nextVersion, updatedAt: changedAt,
      }).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id), eq(properties.state, record.state), eq(properties.version, expectedVersion))).returning();
      if (!updated[0]) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
      return { data: { publicLink: publicLink(deps, token), previousLinkRevoked: true, version: nextVersion, idempotentReplay: false } };
    });
  });

  app.get("/api/v1/agency/properties/:propertyId/public-link", { schema: { tags: ["Agencia"], summary: "Recuperar el enlace público actual" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const propertyId = idParam.parse((request.params as { propertyId?: unknown }).propertyId);
    const record = await agencyProperty(deps, agency.id, propertyId);
    if (!record.publicLinkTokenHash || !record.publicLinkTokenCiphertext || !record.publicLinkIssuedAt) throw new ApiError(404, "PUBLIC_LINK_NOT_FOUND", "Este anuncio no tiene un enlace público recuperable.");
    const token = providers.publicLinkVault.open(propertyId, record.publicLinkTokenCiphertext);
    if (hashSecret(token) !== record.publicLinkTokenHash) throw new ApiError(500, "PUBLIC_LINK_VAULT_INTEGRITY", "No se ha podido recuperar el enlace público.");
    return { data: { publicLink: publicLink(deps, token), issuedAt: record.publicLinkIssuedAt, active: record.state === "published" } };
  });

  app.delete("/api/v1/agency/properties/:propertyId/public-link", { schema: { tags: ["Agencia"], summary: "Revocar el enlace público" } }, async (request, reply) => {
    const { user, agency } = requireAgency(request);
    const propertyId = idParam.parse((request.params as { propertyId?: unknown }).propertyId);
    await agencyProperty(deps, agency.id, propertyId);
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(request.body);
    await options.beforeAgencyWrite?.("property");
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      const records = await tx.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).for("update").limit(1);
      const record = records[0];
      if (!record) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");
      if (record.version !== expectedVersion) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
      const updated = await tx.update(properties).set({ publicLinkTokenHash: null, publicLinkTokenCiphertext: null, publicLinkIssuedAt: null, version: record.version + 1, updatedAt: nowFor(deps) })
        .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id), eq(properties.version, expectedVersion))).returning({ id: properties.id });
      if (!updated[0]) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
    });
    return reply.status(204).send();
  });

  app.get("/api/v1/public/properties/:token", { schema: { tags: ["Inquilinos"], summary: "Consultar un anuncio mediante su enlace" } }, async (request) => {
    const token = z.string().min(20).max(200).parse((request.params as { token?: unknown }).token);
    return { data: { property: publicProperty(await propertyForToken(deps, token)) } };
  });

  app.get("/api/v1/tenant/application-drafts/by-link/:token", { schema: { tags: ["Inquilinos"], summary: "Recuperar un borrador propio" } }, async (request) => {
    const tenant = requireTenant(request);
    const token = z.string().min(20).max(200).parse((request.params as { token?: unknown }).token);
    const record = await propertyForToken(deps, token);
    const rows = await deps.db.select().from(applications).where(and(eq(applications.propertyId, record.property.id), eq(applications.tenantUserId, tenant.id))).limit(1);
    return { data: { property: publicProperty(record), application: rows[0] ? safeApplication(rows[0]) : null } };
  });

  app.put("/api/v1/tenant/application-drafts/by-link/:token", { schema: { tags: ["Inquilinos"], summary: "Guardar un borrador propio" } }, async (request, reply) => {
    const tenant = requireTenant(request);
    const token = z.string().min(20).max(200).parse((request.params as { token?: unknown }).token);
    const record = await propertyForToken(deps, token);
    const parsedDraft = applicationDraft.parse(request.body);
    const rawDraft = request.body as Record<string, unknown>;
    // Zod defaults are useful for final submission but autosave must distinguish
    // omission (preserve) from an explicit null/value (replace).
    const draftData = Object.fromEntries(Object.entries(parsedDraft).filter(([key]) => Object.hasOwn(rawDraft, key))) as typeof parsedDraft;
    const draftAdultProfiles = adultProfilesForDraft(parsedDraft);
    const changedAt = nowFor(deps);
    const applicationId = newId();
    await options.beforeApplicationWrite?.("draft");
    const saved = await deps.db.transaction(async (tx) => {
      const agencyLock = await tx.select({ accountState: agencies.accountState }).from(agencies).where(eq(agencies.id, record.property.agencyId)).for("update").limit(1);
      const tenantLock = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      if (agencyLock[0]?.accountState !== "active" || tenantLock[0]?.accountState !== "active") {
        throw new ApiError(409, "ACCOUNT_CLOSED", "La cuenta está cerrada o pendiente de eliminación.");
      }
      const property = await lockPublishedPropertyForToken(tx as unknown as Database, record.property.id, record.property.agencyId, record.tokenHash);
      const currentRows = await tx.select().from(applications).where(and(
        eq(applications.propertyId, property.id), eq(applications.tenantUserId, tenant.id),
      )).for("update").limit(1);
      const current = currentRows[0];
      if (current?.submittedAt) throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "Esta solicitud ya se ha enviado.");
      if (current) {
        assertApplicationActive(current);
        if (draftAdultProfiles) {
          const retainedIds = new Set(draftAdultProfiles.map((adult) => adult.id));
          const ownedDocuments = await tx.select({ adultProfileId: applicationDocuments.adultProfileId }).from(applicationDocuments).where(and(eq(applicationDocuments.applicationId, current.id), eq(applicationDocuments.deletionState, "active")));
          if (ownedDocuments.some((document) => !retainedIds.has(document.adultProfileId))) throw new ApiError(409, "ADULT_PROFILE_HAS_DOCUMENTS", "Elimina primero la documentación de la persona adulta que quieres quitar de la solicitud.");
        }
        const updated = await tx.update(applications).set({
          draftData: sql`${applications.draftData} || ${draftData}::jsonb`,
          ...(draftAdultProfiles ? { adultProfiles: draftAdultProfiles } : {}),
          sourceLinkTokenHash: record.tokenHash, updatedAt: changedAt,
        }).where(and(eq(applications.id, current.id), eq(applications.tenantUserId, tenant.id), eq(applications.retentionState, "active"), isNull(applications.submittedAt))).returning({ id: applications.id });
        if (!updated[0]) throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
        return { id: updated[0].id, created: false };
      }
      const inserted = await tx.insert(applications).values({
        id: applicationId, agencyId: record.property.agencyId, propertyId: record.property.id, tenantUserId: tenant.id,
        responsibleUserId: null, status: "new", documentState: property.requestedDocumentCategories.length ? "missing" : "not_requested",
        draftData, adultProfiles: draftAdultProfiles ?? [], sourceLinkTokenHash: record.tokenHash, createdAt: changedAt, updatedAt: changedAt,
      }).returning({ id: applications.id });
      return { id: inserted[0]!.id, created: true };
    });
    const response = { data: { applicationId: saved.id, savedAt: changedAt } };
    return saved.created ? reply.status(201).send(response) : response;
  });

  app.post("/api/v1/tenant/applications/by-link/:token/submit", { schema: { tags: ["Inquilinos"], summary: "Enviar una solicitud" } }, async (request, reply) => {
    const tenant = requireTenant(request);
    const token = z.string().min(20).max(200).parse((request.params as { token?: unknown }).token);
    const record = await propertyForToken(deps, token);
    const input = z.object({
      application: applicationForm,
      consentVersion: z.literal(CURRENT_CONSENT_VERSION),
      privacyConsent: z.literal(true),
      submissionKey: z.string().trim().min(16).max(200),
    }).parse(request.body);
    if (input.application.email.toLowerCase() !== tenant.email.toLowerCase()) {
      throw new ApiError(422, "VERIFIED_EMAIL_MISMATCH", "El correo de la solicitud debe coincidir con el correo verificado de tu cuenta.");
    }
    const adultProfiles = adultProfilesFromApplication(input.application);
    const submissionKeyHash = hashSecret(`${tenant.id}:${record.property.id}:${input.submissionKey}`);
    const changedAt = nowFor(deps);
    await options.beforeApplicationWrite?.("submit");
    const result = await deps.db.transaction(async (tx) => {
      const agencyLock = await tx.select({ accountState: agencies.accountState, name: agencies.name }).from(agencies).where(eq(agencies.id, record.property.agencyId)).for("update").limit(1);
      const tenantLock = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      if (agencyLock[0]?.accountState !== "active" || tenantLock[0]?.accountState !== "active") {
        throw new ApiError(409, "ACCOUNT_CLOSED", "La cuenta está cerrada o pendiente de eliminación.");
      }
      const property = await lockPublishedPropertyForToken(tx as unknown as Database, record.property.id, record.property.agencyId, record.tokenHash);
      const applicationRows = await tx.select().from(applications).where(and(
        eq(applications.propertyId, property.id), eq(applications.tenantUserId, tenant.id),
      )).for("update").limit(1);
      const application = applicationRows[0];
      if (application) assertApplicationActive(application);
      if (application?.submittedAt) {
        if (application.submissionKeyHash !== submissionKeyHash) {
          throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "Ya existe una solicitud enviada para este inmueble.", { applicationId: application.id });
        }
      } else if (property.requestedDocumentCategories.length > 0) {
        if (!application) throw new ApiError(409, "APPLICATION_DRAFT_REQUIRED", "Guarda el borrador antes de añadir la documentación solicitada.");
        const uploaded = await tx.select({ category: applicationDocuments.category, adultProfileId: applicationDocuments.adultProfileId }).from(applicationDocuments)
          .where(and(eq(applicationDocuments.applicationId, application.id), eq(applicationDocuments.tenantUserId, tenant.id), eq(applicationDocuments.malwareScanState, "clean"), eq(applicationDocuments.deletionState, "active")));
        const missing = missingDocumentsByAdult(property.requestedDocumentCategories, adultProfiles, uploaded);
        if (missing.length) {
          await tx.update(applications).set({ documentState: "missing", updatedAt: changedAt })
            .where(and(eq(applications.id, application.id), eq(applications.tenantUserId, tenant.id), eq(applications.retentionState, "active")));
          return { missing, application: null, idempotentReplay: false };
        }
      }
      const notificationAdministrators = await tx.select({ userId: users.id, email: users.email }).from(agencyMemberships)
        .innerJoin(users, eq(users.id, agencyMemberships.userId))
        .where(and(eq(agencyMemberships.agencyId, record.property.agencyId), eq(agencyMemberships.role, "admin"), eq(users.accountState, "active")));
      let persisted: typeof applications.$inferSelect;
      let idempotentReplay = Boolean(application?.submittedAt);
      if (application?.submittedAt) {
        persisted = application;
      } else if (application) {
        const updated = await tx.update(applications).set({
          draftData: input.application, consentVersion: input.consentVersion, consentedAt: changedAt,
          phone: input.application.phone, normalizedPhone: normalizeCandidatePhone(input.application.phone), normalizedEmail: normalizeCandidateEmail(input.application.email), adultProfiles,
          individualNetMonthlyIncomeCents: input.application.individualNetMonthlyIncomeCents,
          householdNetMonthlyIncomeCents: input.application.householdNetMonthlyIncomeCents, adultOccupants: input.application.adultOccupants,
          minorOccupants: input.application.minorOccupants, intendedMoveInDate: input.application.intendedMoveInDate,
          applicationDataPromotedAt: changedAt,
          submittedAt: changedAt, documentState: property.requestedDocumentCategories.length ? "complete" : "not_requested",
          responsibleUserId: null, sourceLinkTokenHash: record.tokenHash, submissionKeyHash, updatedAt: changedAt,
        }).where(and(eq(applications.id, application.id), eq(applications.tenantUserId, tenant.id), eq(applications.retentionState, "active"), isNull(applications.submittedAt))).returning();
        if (!updated[0]) throw new ApiError(409, "APPLICATION_ALREADY_SUBMITTED", "La solicitud se ha enviado con otra operación.", { applicationId: application.id });
        persisted = updated[0];
      } else {
        const applicationId = newId();
        const inserted = await tx.insert(applications).values({
          id: applicationId, agencyId: property.agencyId, propertyId: property.id, tenantUserId: tenant.id,
          responsibleUserId: null, status: "new", documentState: "not_requested",
          submittedAt: changedAt, draftData: input.application, consentVersion: input.consentVersion, consentedAt: changedAt,
          phone: input.application.phone, normalizedPhone: normalizeCandidatePhone(input.application.phone), normalizedEmail: normalizeCandidateEmail(input.application.email), adultProfiles,
          individualNetMonthlyIncomeCents: input.application.individualNetMonthlyIncomeCents,
          householdNetMonthlyIncomeCents: input.application.householdNetMonthlyIncomeCents, adultOccupants: input.application.adultOccupants,
          minorOccupants: input.application.minorOccupants, intendedMoveInDate: input.application.intendedMoveInDate,
          applicationDataPromotedAt: changedAt,
          sourceLinkTokenHash: record.tokenHash, submissionKeyHash, createdAt: changedAt, updatedAt: changedAt,
        }).returning();
        persisted = inserted[0]!;
      }
      await enqueueApplicationNotifications(tx, {
        applicationId: persisted.id,
        tenantUserId: tenant.id,
        agencyId: record.property.agencyId,
        tenantEmail: tenant.email,
        propertyTitle: property.title,
        agencyName: agencyLock[0]!.name,
        administrators: notificationAdministrators,
      });
      return { missing: null, application: persisted, idempotentReplay };
    });
    if (result.missing) {
      throw new ApiError(422, "REQUESTED_DOCUMENTS_MISSING", "Añade la documentación solicitada de cada persona adulta antes de enviar.", { missingCategories: [...new Set(result.missing.flatMap((item) => item.categories))], missingByAdult: result.missing });
    }
    const response = { data: { application: safeApplication(result.application!), idempotentReplay: result.idempotentReplay } };
    return result.idempotentReplay ? response : reply.status(201).send(response);
  });

  app.get("/api/v1/tenant/applications", { schema: { tags: ["Inquilinos"], summary: "Listar solicitudes propias" } }, async (request) => {
    const tenant = requireTenant(request);
    const rows = await deps.db.select({ application: applications, property: properties })
      .from(applications).innerJoin(properties, eq(properties.id, applications.propertyId))
      .where(eq(applications.tenantUserId, tenant.id)).orderBy(desc(applications.updatedAt));
    return { data: { applications: rows.map((row) => ({
      application: {
        id: row.application.id,
        status: row.application.status,
        documentState: row.application.documentState,
        submittedAt: row.application.submittedAt,
        updatedAt: row.application.updatedAt,
      },
      property: { id: row.property.id, title: row.property.title, publicLocation: row.property.publicLocation, coverImageUrl: row.property.coverImageUrl },
      resumePath: (() => {
        if (row.application.submittedAt || row.property.state !== "published" || row.application.sourceLinkTokenHash !== row.property.publicLinkTokenHash) return null;
        try {
          return `/solicitud/${openPublicLinkToken(providers, row.property)}`;
        } catch {
          return null;
        }
      })(),
    })) } };
  });

  app.get("/api/v1/tenant/applications/:applicationId", { schema: { tags: ["Inquilinos"], summary: "Consultar una solicitud propia" } }, async (request) => {
    const tenant = requireTenant(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const application = await tenantApplication(deps, tenant.id, applicationId);
    assertApplicationActive(application);
    const [contextRows, documents] = await Promise.all([
      deps.db.select({ property: properties, agencyName: agencies.name }).from(properties)
        .innerJoin(agencies, eq(agencies.id, properties.agencyId))
        .where(and(eq(properties.id, application.propertyId), eq(properties.agencyId, application.agencyId))).limit(1),
      deps.db.select().from(applicationDocuments).where(and(
        eq(applicationDocuments.applicationId, application.id),
        eq(applicationDocuments.tenantUserId, tenant.id),
        eq(applicationDocuments.deletionState, "active"),
      )).orderBy(desc(applicationDocuments.createdAt)),
    ]);
    const context = contextRows[0];
    if (!context) throw new ApiError(404, "APPLICATION_NOT_FOUND", "No se ha encontrado la solicitud.");
    return { data: {
      application: {
        id: application.id,
        status: application.status,
        documentState: application.documentState,
        submittedAt: application.submittedAt,
        updatedAt: application.updatedAt,
      },
      property: {
        id: context.property.id,
        agencyName: context.agencyName,
        internalReference: context.property.internalReference,
        title: context.property.title,
        publicLocation: context.property.publicLocation ?? context.property.city,
        monthlyRentCents: context.property.monthlyRentCents,
        propertyType: context.property.propertyType,
        bedrooms: context.property.bedrooms,
        bathrooms: context.property.bathrooms,
        floorAreaSqm: context.property.floorAreaSqm,
        availableFrom: context.property.availableFrom,
        coverImageUrl: context.property.coverImageUrl,
        requestedDocumentCategories: context.property.requestedDocumentCategories,
      },
      documents: documents.map(safeDocument),
    } };
  });

  app.post("/api/v1/tenant/applications/:applicationId/withdraw", { schema: { tags: ["Inquilinos"], summary: "Retirar una solicitud propia" } }, async (request) => {
    const tenant = requireTenant(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const application = await tenantApplication(deps, tenant.id, applicationId);
    assertApplicationActive(application);
    if (!application.submittedAt) throw new ApiError(409, "APPLICATION_NOT_SUBMITTED", "La solicitud todavía no se ha enviado.");
    if (application.status === "withdrawn") return { data: { application: safeApplication(application), idempotentReplay: true } };
    const changedAt = nowFor(deps);
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, application.agencyId);
      const tenantRows = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "Tu cuenta está cerrada o pendiente de eliminación.");
      const updated = await tx.update(applications).set({ status: "withdrawn", updatedAt: changedAt })
        .where(and(eq(applications.id, applicationId), eq(applications.tenantUserId, tenant.id), eq(applications.status, application.status), eq(applications.retentionState, "active"))).returning({ id: applications.id });
      if (!updated[0]) throw new ApiError(409, "APPLICATION_STATUS_CHANGED", "El estado ha cambiado. Actualiza la solicitud antes de volver a intentarlo.");
      await tx.insert(applicationStatusHistory).values({ id: newId(), applicationId, agencyId: application.agencyId, actorUserId: tenant.id, fromStatus: application.status, toStatus: "withdrawn", createdAt: changedAt });
    });
    return { data: { application: safeApplication(await tenantApplication(deps, tenant.id, applicationId)), idempotentReplay: false } };
  });

  app.get("/api/v1/agency/properties/:propertyId/applications", { schema: { tags: ["Agencia"], summary: "Listar interesados de un anuncio" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    await options.beforeAgencySensitiveRead?.("applicant");
    await deps.db.transaction(async (tx) => lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id }));
    const propertyId = idParam.parse((request.params as { propertyId?: unknown }).propertyId);
    await agencyProperty(deps, agency.id, propertyId);
    const query = z.object({
      search: z.string().trim().max(200).optional(), status: z.enum(applicantStatuses).optional(), documentState: z.enum(documentStates).optional(),
      viewingState: z.enum(["none", "scheduled", "completed"]).optional(), responsibleUserId: z.string().uuid().optional(),
      responsibility: z.enum(["assigned", "unassigned"]).optional(),
      submittedFrom: z.iso.datetime({ offset: true }).optional(), submittedTo: z.iso.datetime({ offset: true }).optional(),
      sort: z.enum(["newest", "oldest", "income", "status", "next_viewing"]).default("newest"),
      ...paginationQuery,
    }).parse(request.query);
    const clauses = [eq(applications.agencyId, agency.id), eq(applications.propertyId, propertyId), isNotNull(applications.submittedAt)];
    if (query.status) clauses.push(eq(applications.status, query.status));
    if (query.documentState) clauses.push(eq(applications.documentState, query.documentState));
    if (query.responsibleUserId) clauses.push(eq(applications.responsibleUserId, query.responsibleUserId));
    if (query.responsibility === "assigned") clauses.push(isNotNull(applications.responsibleUserId));
    if (query.responsibility === "unassigned") clauses.push(isNull(applications.responsibleUserId));
    if (query.submittedFrom) clauses.push(gte(applications.submittedAt, new Date(query.submittedFrom)));
    if (query.submittedTo) clauses.push(lte(applications.submittedAt, new Date(query.submittedTo)));
    if (query.search) {
      const term = `%${query.search}%`;
      const normalizedPhonePrefix = query.search.replace(/\s/g, "");
      clauses.push(or(
        ilike(users.fullName, term),
        ilike(users.email, term),
        /^\+?\d+$/.test(normalizedPhonePrefix) ? sql`${applications.phone} like ${`${normalizedPhonePrefix}%`}` : undefined,
      )!);
    }
    if (query.viewingState === "scheduled") clauses.push(sql`exists (select 1 from ${appointments} ap where ap.application_id = ${applications.id} and ap.agency_id = ${agency.id} and ap.state = 'scheduled')`);
    if (query.viewingState === "completed") clauses.push(sql`exists (select 1 from ${appointments} ap where ap.application_id = ${applications.id} and ap.agency_id = ${agency.id} and ap.state = 'completed')`);
    if (query.viewingState === "none") clauses.push(sql`not exists (select 1 from ${appointments} ap where ap.application_id = ${applications.id} and ap.agency_id = ${agency.id} and ap.state in ('scheduled','completed'))`);
    const ordering = query.sort === "oldest" ? [asc(applications.submittedAt), asc(applications.id)]
      : query.sort === "income" ? [sql`${applications.householdNetMonthlyIncomeCents} desc nulls last`, desc(applications.submittedAt), asc(applications.id)]
      : query.sort === "status" ? [asc(applications.status), desc(applications.submittedAt), asc(applications.id)]
      : query.sort === "next_viewing" ? [sql`(select min(ap.starts_at) from appointments ap where ap.application_id = ${applications.id} and ap.agency_id = ${agency.id} and ap.state = 'scheduled') asc nulls last`, desc(applications.submittedAt), asc(applications.id)]
      : [desc(applications.submittedAt), asc(applications.id)];
    const totalRows = await deps.db.select({ total: count() }).from(applications)
      .innerJoin(users, eq(users.id, applications.tenantUserId)).where(and(...clauses));
    const total = totalRows[0]?.total ?? 0;
    const rows = await deps.db.select({ application: applications, tenantName: users.fullName, tenantEmail: users.email })
      .from(applications).innerJoin(users, eq(users.id, applications.tenantUserId)).where(and(...clauses)).orderBy(...ordering)
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const ids = rows.map((row) => row.application.id);
    const responsibleUserIds = [...new Set(rows.map((row) => row.application.responsibleUserId).filter((id): id is string => Boolean(id)))];
    const responsibleUsers = responsibleUserIds.length
      ? await deps.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, responsibleUserIds))
      : [];
    const responsibleNameById = new Map(responsibleUsers.map((responsibleUser) => [responsibleUser.id, responsibleUser.fullName]));
    const upcoming = ids.length ? await deps.db.select().from(appointments).where(and(eq(appointments.agencyId, agency.id), inArray(appointments.applicationId, ids), eq(appointments.state, "scheduled"))).orderBy(asc(appointments.startsAt)) : [];
    const duplicateByApplication = await duplicateSignals(deps.db, propertyId, rows.map((row) => row.application));
    const nextByApplication = new Map<string, typeof upcoming[number]>();
    for (const appointment of upcoming) if (!nextByApplication.has(appointment.applicationId)) nextByApplication.set(appointment.applicationId, appointment);
    return { data: { applications: rows.map((row) => ({
      ...row,
      application: safeApplication(row.application),
      responsibleUserName: row.application.responsibleUserId ? responsibleNameById.get(row.application.responsibleUserId) ?? "Usuario eliminado" : null,
      nextViewing: nextByApplication.has(row.application.id) ? safeAppointment(nextByApplication.get(row.application.id)!) : null,
      possibleDuplicate: duplicateByApplication.get(row.application.id) ?? null,
    })), pagination: pagination(query.page, query.pageSize, total) } };
  });

  app.get("/api/v1/agency/applications/:applicationId", { schema: { tags: ["Agencia"], summary: "Consultar el detalle de un interesado" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    await options.beforeAgencySensitiveRead?.("applicant");
    await deps.db.transaction(async (tx) => lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id }));
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const application = await agencyApplication(deps, agency.id, applicationId);
    const duplicateByApplication = await duplicateSignals(deps.db, application.propertyId, [application]);
    const [property, applicantRows, responsibleRows, documents, notes, history, viewingHistory, audits] = await Promise.all([
      agencyProperty(deps, agency.id, application.propertyId),
      deps.db.select({ fullName: users.fullName, email: users.email }).from(users).where(and(eq(users.id, application.tenantUserId), eq(users.kind, "tenant"))).limit(1),
      application.responsibleUserId ? deps.db.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.id, application.responsibleUserId)).limit(1) : Promise.resolve([]),
      deps.db.select().from(applicationDocuments).where(and(eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.agencyId, agency.id), eq(applicationDocuments.deletionState, "active"))).orderBy(desc(applicationDocuments.createdAt)),
      deps.db.select({ note: applicationNotes, authorName: users.fullName }).from(applicationNotes).leftJoin(users, eq(users.id, applicationNotes.authorUserId)).where(and(eq(applicationNotes.applicationId, applicationId), eq(applicationNotes.agencyId, agency.id))).orderBy(desc(applicationNotes.createdAt)),
      deps.db.select().from(applicationStatusHistory).where(and(eq(applicationStatusHistory.applicationId, applicationId), eq(applicationStatusHistory.agencyId, agency.id))).orderBy(desc(applicationStatusHistory.createdAt)),
      deps.db.select().from(appointments).where(and(eq(appointments.applicationId, applicationId), eq(appointments.agencyId, agency.id))).orderBy(desc(appointments.startsAt)),
      deps.db.select().from(auditEvents).where(and(
        eq(auditEvents.agencyId, agency.id),
        or(and(eq(auditEvents.subjectType, "application"), eq(auditEvents.subjectId, applicationId)), sql`${auditEvents.metadata}->>'applicationId' = ${applicationId}`),
      )).orderBy(desc(auditEvents.createdAt)),
    ]);
    const activity = [
      ...(application.submittedAt ? [{ id: `submitted:${application.id}`, type: "application_submitted", actorUserId: application.tenantUserId, createdAt: application.submittedAt, metadata: {} }] : []),
      ...history.map((item) => ({ id: item.id, type: "status_changed", actorUserId: item.actorUserId, createdAt: item.createdAt, metadata: { fromStatus: item.fromStatus, toStatus: item.toStatus } })),
      ...notes.map((item) => ({ id: item.note.id, type: "note_added", actorUserId: item.note.authorUserId, createdAt: item.note.createdAt, metadata: {} })),
      ...audits.filter((event) => event.action !== "application_status_changed").map((event) => ({ id: event.id, type: event.action, actorUserId: event.actorUserId, createdAt: event.createdAt, metadata: event.metadata })),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    return { data: { application: safeApplication(application), applicant: applicantRows[0] ?? null, responsibleUser: responsibleRows[0] ?? null, property: safeProperty(property), documents: documents.map(safeDocument), possibleDuplicate: duplicateByApplication.get(application.id) ?? null, notes: notes.map((item) => ({ ...item, authorName: item.authorName ?? "Usuario eliminado" })), statusHistory: history, appointments: viewingHistory.map(safeAppointment), activity } };
  });

  app.patch("/api/v1/agency/applications/:applicationId/status", { schema: { tags: ["Agencia"], summary: "Cambiar el estado de un interesado" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const { status, expectedStatus } = z.object({ status: z.enum(agencyApplicantStatuses), expectedStatus: z.enum(applicantStatuses) }).parse(request.body);
    const changedAt = nowFor(deps);
    let changed = false;
    await options.beforeAgencyWrite?.("applicant");
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      const rows = await tx.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.agencyId, agency.id), isNotNull(applications.submittedAt))).for("update").limit(1);
      const application = rows[0];
      if (!application) throw new ApiError(404, "APPLICATION_NOT_FOUND", "No se ha encontrado la solicitud.");
      assertApplicationActive(application);
      if (application.status !== expectedStatus) throw new ApiError(409, "APPLICATION_STATUS_CHANGED", "El estado ha cambiado. Actualiza la solicitud antes de volver a intentarlo.");
      if (application.status === "withdrawn") throw new ApiError(409, "APPLICATION_WITHDRAWN", "Una solicitud retirada no puede reabrirse desde la agencia.");
      if (application.status === status) return;
      const updated = await tx.update(applications).set({ status, updatedAt: changedAt })
        .where(and(eq(applications.id, applicationId), eq(applications.agencyId, agency.id), eq(applications.status, expectedStatus), eq(applications.retentionState, "active"))).returning({ id: applications.id });
      if (!updated[0]) throw new ApiError(409, "APPLICATION_STATUS_CHANGED", "El estado ha cambiado. Actualiza la solicitud antes de volver a intentarlo.");
      await tx.insert(applicationStatusHistory).values({ id: newId(), applicationId, agencyId: agency.id, actorUserId: user.id, fromStatus: application.status, toStatus: status, createdAt: changedAt });
      await tx.insert(auditEvents).values({ id: newId(), agencyId: agency.id, actorUserId: user.id, action: "application_status_changed", subjectType: "application", subjectId: applicationId, metadata: { fromStatus: application.status, toStatus: status }, createdAt: changedAt });
      changed = true;
    });
    return { data: { application: safeApplication(await agencyApplication(deps, agency.id, applicationId)), changed } };
  });

  app.patch("/api/v1/agency/applications/:applicationId/responsible-user", { schema: { tags: ["Agencia"], summary: "Asignar una persona responsable" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const application = await agencyApplication(deps, agency.id, applicationId);
    assertApplicationActive(application);
    const { responsibleUserId } = z.object({ responsibleUserId: z.string().uuid().nullable() }).parse(request.body);
    if (responsibleUserId) await assertAgencyMember(deps.db, agency.id, responsibleUserId);
    const changedAt = nowFor(deps);
    await options.beforeAgencyWrite?.("applicant");
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      if (responsibleUserId) await assertAgencyMember(tx as unknown as Database, agency.id, responsibleUserId);
      const updated = await tx.update(applications).set({ responsibleUserId, updatedAt: changedAt }).where(and(eq(applications.id, applicationId), eq(applications.agencyId, agency.id), eq(applications.retentionState, "active"))).returning({ id: applications.id });
      if (!updated[0]) throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
      await tx.insert(auditEvents).values({ id: newId(), agencyId: agency.id, actorUserId: user.id, action: "application_responsible_user_changed", subjectType: "application", subjectId: applicationId, metadata: { responsibleUserId }, createdAt: changedAt });
    });
    return { data: { application: safeApplication(await agencyApplication(deps, agency.id, applicationId)) } };
  });

  app.post("/api/v1/agency/applications/:applicationId/notes", { schema: { tags: ["Agencia"], summary: "Añadir una nota interna" } }, async (request, reply) => {
    const { user, agency } = requireAgency(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    assertApplicationActive(await agencyApplication(deps, agency.id, applicationId));
    const { body } = z.object({ body: z.string().trim().min(1).max(5_000) }).parse(request.body);
    const note = { id: newId(), applicationId, agencyId: agency.id, authorUserId: user.id, body, createdAt: nowFor(deps) };
    await options.beforeAgencyWrite?.("applicant");
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      const locked = await tx.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.agencyId, agency.id))).for("update").limit(1);
      if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
      await tx.insert(applicationNotes).values(note);
    });
    return reply.status(201).send({ data: { note: { ...note, authorName: user.fullName } } });
  });

  app.post("/api/v1/agency/applications/:applicationId/whatsapp", { schema: { tags: ["Agencia"], summary: "Iniciar contacto por WhatsApp" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const application = await agencyApplication(deps, agency.id, applicationId);
    assertApplicationActive(application);
    const property = await agencyProperty(deps, agency.id, application.propertyId);
    const data = application.draftData as Record<string, unknown>;
    const phone = (application.phone ?? (typeof data.phone === "string" ? data.phone : "")).replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(phone)) throw new ApiError(422, "INVALID_PHONE", "El teléfono del interesado no es válido para WhatsApp.");
    const tenantName = typeof data.fullName === "string" ? data.fullName : "";
    const defaultMessage = `Hola, ${tenantName}. Soy ${user.fullName} de ${agency.name}. Te contacto por tu interés en el inmueble ${property.internalReference}.`;
    const { message } = z.object({ message: z.string().trim().min(1).max(2_000).optional() }).parse(request.body ?? {});
    const deepLink = `https://wa.me/${phone}?text=${encodeURIComponent(message ?? defaultMessage)}`;
    await options.beforeAgencyWrite?.("applicant");
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      const locked = await tx.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.agencyId, agency.id))).for("update").limit(1);
      if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
      await tx.insert(auditEvents).values({ id: newId(), agencyId: agency.id, actorUserId: user.id, action: "whatsapp_contact_initiated", subjectType: "application", subjectId: applicationId, metadata: { propertyId: property.id }, createdAt: nowFor(deps) });
    });
    return { data: { deepLink, auditLabel: "Contacto por WhatsApp iniciado", deliveryClaimed: false } };
  });

  app.post("/api/v1/tenant/applications/:applicationId/documents", { schema: { tags: ["Inquilinos"], summary: "Subir documentación privada" } }, async (request, reply) => {
    const tenant = requireTenant(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    const application = await tenantApplication(deps, tenant.id, applicationId);
    assertApplicationActive(application);
    const input = z.object({ adultProfileId: z.string().trim().min(1).max(50).default("primary"), category: z.enum(documentCategories), originalName: z.string().trim().min(1).max(255), contentType: z.string(), dataBase64: z.string().min(4) }).parse(request.body);
    if (!(application.adultProfiles.length ? application.adultProfiles : [{ id: "primary" }]).some((adult) => adult.id === input.adultProfileId)) {
      throw new ApiError(422, "ADULT_PROFILE_NOT_FOUND", "La persona adulta indicada no forma parte de esta solicitud.");
    }
    const property = await agencyProperty(deps, application.agencyId, application.propertyId);
    if (!property.requestedDocumentCategories.includes(input.category)) throw new ApiError(422, "DOCUMENT_NOT_REQUESTED", "Este tipo de documento no se ha solicitado para el inmueble.");
    const expectedExtension = input.contentType === "application/pdf" ? /\.pdf$/i : input.contentType === "image/jpeg" ? /\.jpe?g$/i : input.contentType === "image/png" ? /\.png$/i : null;
    if (expectedExtension && !expectedExtension.test(input.originalName)) throw new ApiError(422, "CONTENT_TYPE_MISMATCH", "La extensión del archivo no coincide con su formato.");
    let decoded: ReturnType<typeof decodeDocument>;
    try {
      decoded = decodeDocument({ dataBase64: input.dataBase64, contentType: input.contentType, maxBytes: providers.maxBytes });
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_FILE";
      const messages: Record<string, string> = { UNSUPPORTED_CONTENT_TYPE: "El formato no está permitido. Usa PDF, JPG o PNG.", INVALID_BASE64: "El archivo no es válido.", EMPTY_FILE: "El archivo está vacío.", FILE_TOO_LARGE: `El archivo supera el límite de ${providers.maxBytes} bytes.`, CONTENT_TYPE_MISMATCH: "El contenido del archivo no coincide con el formato indicado." };
      throw new ApiError(422, code, messages[code] ?? "No se ha podido procesar el archivo.");
    }
    const documentId = newId();
    const storageKey = stableStorageKey({ applicationId, documentId });
    const createdAt = nowFor(deps);
    // Persist a non-downloadable staging row before writing bytes. If this
    // transaction fails, the object store has never been touched.
    await deps.db.transaction(async (tx) => {
      const agencyLock = await tx.select({ id: agencies.id, accountState: agencies.accountState }).from(agencies).where(eq(agencies.id, application.agencyId)).for("update").limit(1);
      if (!agencyLock[0] || agencyLock[0].accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "La cuenta de la agencia está cerrada o pendiente de eliminación.");
      const tenantLock = await tx.select({ id: users.id, accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      if (!tenantLock[0] || tenantLock[0].accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "Tu cuenta está cerrada o pendiente de eliminación.");
      const propertyRows = await tx.select({ requested: properties.requestedDocumentCategories }).from(properties).where(and(
        eq(properties.id, application.propertyId), eq(properties.agencyId, application.agencyId),
      )).for("update").limit(1);
      if (!propertyRows[0]?.requested.includes(input.category)) throw new ApiError(422, "DOCUMENT_NOT_REQUESTED", "Este tipo de documento no se ha solicitado para el inmueble.");
      const locked = await tx.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.tenantUserId, tenant.id))).for("update").limit(1);
      if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
      if (!(locked[0].adultProfiles.length ? locked[0].adultProfiles : [{ id: "primary" }]).some((adult) => adult.id === input.adultProfileId)) throw new ApiError(422, "ADULT_PROFILE_NOT_FOUND", "La persona adulta indicada no forma parte de esta solicitud.");
      await tx.insert(applicationDocuments).values({ id: documentId, applicationId, agencyId: application.agencyId, tenantUserId: tenant.id, adultProfileId: input.adultProfileId, category: input.category, storageKey, originalName: input.originalName, contentType: decoded.contentType, byteSize: decoded.body.length, malwareScanState: "pending", createdAt, updatedAt: createdAt });
    });

    const tombstoneStaging = async (): Promise<void> => {
      const requestedAt = nowFor(deps);
      await deps.db.update(applicationDocuments).set({
        deletionState: "deleting", deleteRequestedAt: requestedAt,
        deletionAttempts: sql`${applicationDocuments.deletionAttempts} + 1`, updatedAt: requestedAt,
      }).where(eq(applicationDocuments.id, documentId));
      await deps.db.insert(documentStorageCleanup).values({
        id: newId(), storageKey, agencyId: application.agencyId, applicationId,
        reason: "DOCUMENT_STAGING_CLEANUP", attempts: 1, createdAt: requestedAt, updatedAt: requestedAt,
      }).onConflictDoNothing({ target: documentStorageCleanup.storageKey });
      try {
        await providers.storage.delete(storageKey);
        await deps.db.transaction(async (tx) => {
          await tx.delete(applicationDocuments).where(eq(applicationDocuments.id, documentId));
          await tx.delete(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, storageKey));
        });
      } catch {
        await deps.db.update(applicationDocuments).set({ lastDeleteErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED", updatedAt: nowFor(deps) }).where(eq(applicationDocuments.id, documentId));
        await deps.db.update(documentStorageCleanup).set({ lastErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED", updatedAt: nowFor(deps) }).where(eq(documentStorageCleanup.storageKey, storageKey));
      }
    };

    try {
      await providers.storage.put({ key: storageKey, ...decoded });
    } catch {
      await tombstoneStaging();
      throw new ApiError(503, "DOCUMENT_STORAGE_UNAVAILABLE", "No se ha podido guardar el archivo. Inténtalo de nuevo más tarde.");
    }
    let scan: Awaited<ReturnType<typeof providers.scanner.scan>>;
    try {
      scan = await providers.scanner.scan({ body: decoded.body, contentType: decoded.contentType, originalName: input.originalName });
    } catch {
      await tombstoneStaging();
      throw new ApiError(503, "DOCUMENT_SCAN_UNAVAILABLE", "No se ha podido comprobar el archivo. Inténtalo de nuevo más tarde.");
    }
    if (scan.state !== "clean") {
      await tombstoneStaging();
      if (scan.state === "infected") throw new ApiError(422, "DOCUMENT_INFECTED", "El archivo no ha superado la comprobación de seguridad.");
      throw new ApiError(503, "DOCUMENT_SCAN_UNAVAILABLE", "No se ha podido comprobar el archivo. Inténtalo de nuevo más tarde.");
    }
    const published = await deps.db.transaction(async (tx) => {
      const agencyLock = await tx.select({ accountState: agencies.accountState }).from(agencies).where(eq(agencies.id, application.agencyId)).for("update").limit(1);
      const tenantLock = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      const propertyRows = await tx.select({ requested: properties.requestedDocumentCategories }).from(properties).where(and(
        eq(properties.id, application.propertyId), eq(properties.agencyId, application.agencyId),
      )).for("update").limit(1);
      const applicationLock = await tx.select({ retentionState: applications.retentionState }).from(applications).where(eq(applications.id, applicationId)).for("update").limit(1);
      if (agencyLock[0]?.accountState !== "active" || tenantLock[0]?.accountState !== "active" || applicationLock[0]?.retentionState !== "active" || !propertyRows[0]?.requested.includes(input.category)) return [];
      const changedAt = nowFor(deps);
      const updated = await tx.update(applicationDocuments).set({ malwareScanState: "clean", updatedAt: changedAt })
        .where(and(eq(applicationDocuments.id, documentId), eq(applicationDocuments.malwareScanState, "pending"), eq(applicationDocuments.deletionState, "active")))
        .returning({ id: applicationDocuments.id });
      if (updated[0]) await refreshDocumentStateLocked(tx as unknown as Database, applicationId, application.agencyId, changedAt, options.beforeDocumentStateWrite);
      return updated;
    });
    if (!published[0]) {
      await tombstoneStaging();
      throw new ApiError(409, "DOCUMENT_UPLOAD_INTERRUPTED", "La carga ya no puede completarse de forma segura. Vuelve a intentarlo.");
    }
    return reply.status(201).send({ data: { document: { id: documentId, applicationId, adultProfileId: input.adultProfileId, category: input.category, originalName: input.originalName, contentType: decoded.contentType, byteSize: decoded.body.length, malwareScanState: "clean", scanProvider: scan.provider, createdAt } } });
  });

  app.get("/api/v1/tenant/applications/:applicationId/documents", { schema: { tags: ["Inquilinos"], summary: "Listar documentación propia" } }, async (request) => {
    const tenant = requireTenant(request);
    const applicationId = idParam.parse((request.params as { applicationId?: unknown }).applicationId);
    await tenantApplication(deps, tenant.id, applicationId);
    const documents = await deps.db.select().from(applicationDocuments)
      .where(and(eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.tenantUserId, tenant.id)))
      .orderBy(desc(applicationDocuments.createdAt));
    return { data: { documents: documents.map(safeDocument) } };
  });

  app.delete("/api/v1/tenant/applications/:applicationId/documents/:documentId", { schema: { tags: ["Inquilinos"], summary: "Eliminar un documento propio" } }, async (request, reply) => {
    const tenant = requireTenant(request);
    const params = z.object({ applicationId: z.string().uuid(), documentId: z.string().uuid() }).parse(request.params);
    const application = await tenantApplication(deps, tenant.id, params.applicationId);
    assertApplicationActive(application);
    const rows = await deps.db.select().from(applicationDocuments).where(and(eq(applicationDocuments.id, params.documentId), eq(applicationDocuments.applicationId, params.applicationId), eq(applicationDocuments.tenantUserId, tenant.id))).limit(1);
    const document = rows[0];
    if (!document) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "No se ha encontrado el documento.");
    const requestedAt = nowFor(deps);
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, application.agencyId);
      const tenantRows = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "Tu cuenta está cerrada o pendiente de eliminación.");
      const locked = await tx.select().from(applications).where(and(eq(applications.id, params.applicationId), eq(applications.tenantUserId, tenant.id))).for("update").limit(1);
      if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
      await tx.update(applicationDocuments).set({
        deletionState: "deleting",
        deletionAttempts: sql`${applicationDocuments.deletionAttempts} + 1`,
        deleteRequestedAt: document.deleteRequestedAt ?? requestedAt,
        lastDeleteErrorCode: null,
        updatedAt: requestedAt,
      }).where(and(eq(applicationDocuments.id, params.documentId), eq(applicationDocuments.tenantUserId, tenant.id)));
      await tx.insert(documentStorageCleanup).values({
        id: newId(), storageKey: document.storageKey, agencyId: application.agencyId,
        applicationId: application.id, reason: "DOCUMENT_TOMBSTONE",
        attempts: document.deletionAttempts + 1, createdAt: document.deleteRequestedAt ?? requestedAt, updatedAt: requestedAt,
      }).onConflictDoNothing({ target: documentStorageCleanup.storageKey });
    });
    try {
      await providers.storage.delete(document.storageKey);
    } catch {
      await deps.db.update(applicationDocuments).set({ lastDeleteErrorCode: "DOCUMENT_STORAGE_DELETE_FAILED", updatedAt: nowFor(deps) })
        .where(and(eq(applicationDocuments.id, params.documentId), eq(applicationDocuments.tenantUserId, tenant.id)));
      throw new ApiError(503, "DOCUMENT_DELETE_PENDING", "No se ha podido completar la eliminación. El sistema conservará la referencia para volver a intentarlo con seguridad.");
    }
    await deps.db.transaction(async (tx) => {
      await lockAgencyForSystem(tx as unknown as Database, application.agencyId);
      await tx.delete(applicationDocuments).where(and(eq(applicationDocuments.id, params.documentId), eq(applicationDocuments.tenantUserId, tenant.id), eq(applicationDocuments.deletionState, "deleting")));
      await tx.delete(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, document.storageKey));
      await refreshDocumentStateLocked(tx as unknown as Database, application.id, application.agencyId, nowFor(deps), options.beforeDocumentStateWrite);
    });
    return reply.status(204).send();
  });

  async function issueDocumentAccess(request: FastifyRequest, documentId: string, applicationId: string, db: Database = deps.db) {
    const user = requireUser(request);
    const clauses = [eq(applicationDocuments.id, documentId), eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.deletionState, "active")];
    if (user.kind === "tenant") clauses.push(eq(applicationDocuments.tenantUserId, user.id));
    else {
      const { agency } = requireAgency(request);
      clauses.push(eq(applicationDocuments.agencyId, agency.id));
    }
    const rows = await db.select().from(applicationDocuments).where(and(...clauses)).limit(1);
    const document = rows[0];
    if (!document) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "No se ha encontrado el documento.");
    const activeApplication = await db.select({ id: applications.id }).from(applications).where(and(
      eq(applications.id, applicationId), eq(applications.agencyId, document.agencyId), eq(applications.retentionState, "active"),
    )).limit(1);
    if (!activeApplication[0]) throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite accesos.");
    if (user.kind === "agency") {
      const { agency } = requireAgency(request);
      const submitted = await db.select({ id: applications.id }).from(applications).where(and(
        eq(applications.id, applicationId), eq(applications.agencyId, agency.id),
        isNotNull(applications.submittedAt), isNotNull(applications.consentedAt),
      )).limit(1);
      if (!submitted[0]) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "No se ha encontrado el documento.");
    }
    const issuedAt = nowFor(deps);
    if (document.malwareScanState !== "clean") throw new ApiError(423, "DOCUMENT_NOT_CLEAN", "El documento todavía no está disponible por motivos de seguridad.");
    const expiresAt = new Date(issuedAt.getTime() + providers.accessTtlSeconds * 1_000);
    const token = providers.accessTokens.issue({ documentId, userId: user.id, expiresAtEpochSeconds: Math.floor(expiresAt.getTime() / 1_000) });
    return { document, accessUrl: `/api/v1/documents/${documentId}/content`, accessToken: token, expiresAt };
  }

  app.post("/api/v1/tenant/applications/:applicationId/documents/:documentId/access", { schema: { tags: ["Inquilinos"], summary: "Crear acceso temporal a un documento propio" } }, async (request) => {
    const tenant = requireTenant(request);
    const params = z.object({ applicationId: z.string().uuid(), documentId: z.string().uuid() }).parse(request.params);
    const preliminary = await deps.db.select({ agencyId: applicationDocuments.agencyId }).from(applicationDocuments).where(and(
      eq(applicationDocuments.id, params.documentId), eq(applicationDocuments.applicationId, params.applicationId), eq(applicationDocuments.tenantUserId, tenant.id), eq(applicationDocuments.deletionState, "active"),
    )).limit(1);
    if (!preliminary[0]) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "No se ha encontrado el documento.");
    await options.beforeAgencyWrite?.("document_access");
    const result = await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, preliminary[0]!.agencyId);
      const tenantRows = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, tenant.id)).for("update").limit(1);
      if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "Tu cuenta está cerrada o pendiente de eliminación.");
      const applicationRows = await tx.select({ retentionState: applications.retentionState }).from(applications).where(and(
        eq(applications.id, params.applicationId), eq(applications.agencyId, preliminary[0]!.agencyId), eq(applications.tenantUserId, tenant.id),
      )).for("update").limit(1);
      if (applicationRows[0]?.retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite accesos.");
      return issueDocumentAccess(request, params.documentId, params.applicationId, tx as unknown as Database);
    });
    return { data: { accessUrl: result.accessUrl, accessToken: result.accessToken, expiresAt: result.expiresAt } };
  });

  app.post("/api/v1/agency/applications/:applicationId/documents/:documentId/access", { schema: { tags: ["Agencia"], summary: "Crear acceso temporal a documentación" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const params = z.object({ applicationId: z.string().uuid(), documentId: z.string().uuid() }).parse(request.params);
    await options.beforeAgencyWrite?.("document_access");
    const result = await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      return issueDocumentAccess(request, params.documentId, params.applicationId, tx as unknown as Database);
    });
    return { data: { accessUrl: result.accessUrl, accessToken: result.accessToken, expiresAt: result.expiresAt } };
  });

  app.get("/api/v1/documents/:documentId/content", { schema: { tags: ["Inquilinos", "Agencia"], summary: "Descargar un documento mediante acceso temporal" } }, async (request, reply) => {
    const user = requireUser(request);
    const documentId = idParam.parse((request.params as { documentId?: unknown }).documentId);
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (token.length < 20) throw new ApiError(401, "DOCUMENT_ACCESS_REQUIRED", "Solicita un acceso temporal al documento.");
    if (!providers.accessTokens.verify(token, { documentId, userId: user.id, now: nowFor(deps) })) throw new ApiError(403, "DOCUMENT_ACCESS_INVALID", "El acceso al documento no es válido o ha caducado.");
    const clauses = [eq(applicationDocuments.id, documentId), eq(applicationDocuments.deletionState, "active")];
    if (user.kind === "tenant") clauses.push(eq(applicationDocuments.tenantUserId, user.id));
    else clauses.push(eq(applicationDocuments.agencyId, requireAgency(request).agency.id));
    const preliminaryRows = await deps.db.select().from(applicationDocuments).where(and(...clauses)).limit(1);
    const preliminary = preliminaryRows[0];
    if (!preliminary) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "No se ha encontrado el documento.");
    await options.beforeAgencyWrite?.("document_access");
    const document = await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, preliminary.agencyId, user.kind === "agency" ? { userId: user.id } : undefined);
      if (user.kind === "tenant") {
        const tenantRows = await tx.select({ accountState: users.accountState }).from(users).where(eq(users.id, user.id)).for("update").limit(1);
        if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "ACCOUNT_CLOSED", "Tu cuenta está cerrada o pendiente de eliminación.");
      }
      const locked = await tx.select().from(applications).where(and(eq(applications.id, preliminary.applicationId), eq(applications.agencyId, preliminary.agencyId))).for("update").limit(1);
      if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite accesos.");
      const freshRows = await tx.select().from(applicationDocuments).where(and(...clauses)).limit(1);
      const fresh = freshRows[0];
      if (!fresh) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "No se ha encontrado el documento.");
      if (fresh.malwareScanState !== "clean") throw new ApiError(423, "DOCUMENT_NOT_CLEAN", "El documento todavía no está disponible por motivos de seguridad.");
      await tx.insert(auditEvents).values({ id: newId(), agencyId: fresh.agencyId, actorUserId: user.id, action: "document_accessed", subjectType: "document", subjectId: fresh.id, metadata: {}, createdAt: nowFor(deps) });
      return fresh;
    });
    const object = await providers.storage.get(document.storageKey);
    if (!object) throw new ApiError(410, "DOCUMENT_CONTENT_UNAVAILABLE", "El contenido del documento ya no está disponible.");
    return reply.type(object.contentType).header("Cache-Control", "private, no-store").header("Content-Disposition", "inline").send(object.body);
  });

  app.get("/api/v1/agency/appointments", { schema: { tags: ["Agencia"], summary: "Listar citas" } }, async (request) => {
    const { agency } = requireAgency(request);
    const query = z.object({ state: z.enum(appointmentStates).optional(), scope: z.enum(["upcoming", "past"]).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional(), ...paginationQuery }).parse(request.query);
    const clauses = [eq(appointments.agencyId, agency.id)];
    if (query.state) clauses.push(eq(appointments.state, query.state));
    if (query.from) clauses.push(gte(appointments.startsAt, new Date(query.from)));
    if (query.to) clauses.push(lte(appointments.startsAt, new Date(query.to)));
    if (query.scope === "upcoming") clauses.push(and(eq(appointments.state, "scheduled"), gte(appointments.startsAt, nowFor(deps)))!);
    if (query.scope === "past") clauses.push(or(ne(appointments.state, "scheduled"), lt(appointments.startsAt, nowFor(deps)))!);
    const totalRows = await deps.db.select({ total: count() }).from(appointments).where(and(...clauses));
    const total = totalRows[0]?.total ?? 0;
    const rows = await deps.db.select({ appointment: appointments, applicantName: users.fullName, propertyTitle: properties.title })
      .from(appointments)
      .innerJoin(applications, and(eq(applications.id, appointments.applicationId), eq(applications.agencyId, appointments.agencyId), eq(applications.propertyId, appointments.propertyId)))
      .innerJoin(users, eq(users.id, applications.tenantUserId))
      .innerJoin(properties, and(eq(properties.id, appointments.propertyId), eq(properties.agencyId, appointments.agencyId)))
      .where(and(...clauses)).orderBy(asc(appointments.startsAt), asc(appointments.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    const responsibleUserIds = [...new Set(rows.map((row) => row.appointment.responsibleUserId).filter((id): id is string => Boolean(id)))];
    const responsibleUsers = responsibleUserIds.length
      ? await deps.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, responsibleUserIds))
      : [];
    const responsibleNameById = new Map(responsibleUsers.map((responsibleUser) => [responsibleUser.id, responsibleUser.fullName]));
    return { data: { appointments: rows.map((row) => ({
      ...safeAppointment(row.appointment),
      applicantName: row.applicantName,
      propertyTitle: row.propertyTitle,
      responsibleUserName: row.appointment.responsibleUserId ? responsibleNameById.get(row.appointment.responsibleUserId) ?? "Usuario eliminado" : null,
      href: `/app/citas/${row.appointment.id}`,
    })), pagination: pagination(query.page, query.pageSize, total) } };
  });

  app.get("/api/v1/agency/appointments/:appointmentId", { schema: { tags: ["Agencia"], summary: "Consultar el detalle de una cita" } }, async (request) => {
    const { agency } = requireAgency(request);
    const appointmentId = idParam.parse((request.params as { appointmentId?: unknown }).appointmentId);
    const rows = await deps.db.select({ appointment: appointments, applicantName: users.fullName, propertyTitle: properties.title })
      .from(appointments)
      .innerJoin(applications, and(eq(applications.id, appointments.applicationId), eq(applications.agencyId, appointments.agencyId), eq(applications.propertyId, appointments.propertyId)))
      .innerJoin(users, eq(users.id, applications.tenantUserId))
      .innerJoin(properties, and(eq(properties.id, appointments.propertyId), eq(properties.agencyId, appointments.agencyId)))
      .where(and(eq(appointments.id, appointmentId), eq(appointments.agencyId, agency.id))).limit(1);
    const row = rows[0];
    if (!row) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "No se ha encontrado la cita.");
    const responsibleRows = row.appointment.responsibleUserId
      ? await deps.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, row.appointment.responsibleUserId)).limit(1)
      : [];
    return { data: { appointment: { ...safeAppointment(row.appointment), applicantName: row.applicantName, propertyTitle: row.propertyTitle, responsibleUserName: row.appointment.responsibleUserId ? responsibleRows[0]?.fullName ?? "Usuario eliminado" : null, href: `/app/citas/${row.appointment.id}` } } };
  });

  app.post("/api/v1/agency/appointments", { schema: { tags: ["Agencia"], summary: "Agendar una visita" } }, async (request, reply) => {
    const { user, agency } = requireAgency(request);
    const input = appointmentInput.parse(request.body);
    const rawIdempotencyKey = idempotencyKey(request);
    const idempotencyKeyHash = hashSecret(`${agency.id}:appointment:${rawIdempotencyKey}`);
    const requestFingerprint = hashSecret(JSON.stringify(input));
    const application = await agencyApplication(deps, agency.id, input.applicationId);
    assertApplicationActive(application);
    if (input.responsibleUserId) await assertAgencyMember(deps.db, agency.id, input.responsibleUserId);
    const startsAt = new Date(input.startsAt);
    if (startsAt <= nowFor(deps)) throw new ApiError(422, "APPOINTMENT_IN_PAST", "La cita debe programarse en una fecha futura.");
    let warnings: Awaited<ReturnType<typeof overlapWarnings>> = [];
    const createdAt = nowFor(deps);
    const appointment = { id: newId(), agencyId: agency.id, propertyId: application.propertyId, applicationId: application.id, responsibleUserId: input.responsibleUserId, startsAt, durationMinutes: input.durationMinutes, state: "scheduled" as const, instructions: input.instructions, internalNote: input.internalNote, idempotencyKeyHash, requestFingerprint, createdAt, updatedAt: createdAt };
    let persistedAppointment: typeof appointments.$inferSelect = appointment;
    let idempotentReplay = false;
    await options.beforeAgencyWrite?.("appointment");
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
      if (input.responsibleUserId) await assertAgencyMember(tx as unknown as Database, agency.id, input.responsibleUserId);
      const previous = await tx.select().from(appointments)
        .where(and(eq(appointments.agencyId, agency.id), eq(appointments.idempotencyKeyHash, idempotencyKeyHash))).limit(1);
      if (previous[0]) {
        if (previous[0].requestFingerprint !== requestFingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "La clave Idempotency-Key ya se utilizó con otros datos.");
        }
        persistedAppointment = previous[0];
        idempotentReplay = true;
        warnings = await overlapWarnings(tx as unknown as Database, {
          agencyId: agency.id, responsibleUserId: previous[0].responsibleUserId,
          startsAt: previous[0].startsAt, durationMinutes: previous[0].durationMinutes, excludeId: previous[0].id,
        });
        return;
      }
      const tenantRows = await tx.select({ id: users.id, email: users.email, accountState: users.accountState }).from(users)
        .where(eq(users.id, application.tenantUserId)).for("update").limit(1);
      if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "TENANT_CLOSURE_IN_PROGRESS", "La cuenta del interesado está en proceso de cierre y ya no admite nuevas citas.");
      const locked = await tx.select().from(applications).where(and(eq(applications.id, application.id), eq(applications.agencyId, agency.id))).for("update").limit(1);
      if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
      warnings = await overlapWarnings(tx as unknown as Database, {
        agencyId: agency.id, responsibleUserId: input.responsibleUserId, startsAt, durationMinutes: input.durationMinutes,
      });
      const inserted = await tx.insert(appointments).values(appointment)
        .onConflictDoNothing({ target: [appointments.agencyId, appointments.idempotencyKeyHash] }).returning();
      if (!inserted[0]) {
        const raced = await tx.select().from(appointments)
          .where(and(eq(appointments.agencyId, agency.id), eq(appointments.idempotencyKeyHash, idempotencyKeyHash))).limit(1);
        if (!raced[0] || raced[0].requestFingerprint !== requestFingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "La clave Idempotency-Key ya se utilizó con otros datos.");
        }
        persistedAppointment = raced[0];
        idempotentReplay = true;
        warnings = await overlapWarnings(tx as unknown as Database, {
          agencyId: agency.id, responsibleUserId: raced[0].responsibleUserId,
          startsAt: raced[0].startsAt, durationMinutes: raced[0].durationMinutes, excludeId: raced[0].id,
        });
        return;
      }
      persistedAppointment = inserted[0];
      await tx.insert(auditEvents).values({ id: newId(), agencyId: agency.id, actorUserId: user.id, action: "appointment_scheduled", subjectType: "appointment", subjectId: appointment.id, metadata: { applicationId: application.id, propertyId: application.propertyId }, createdAt });
      if (tenantRows[0]) {
        await deps.emailProvider.send({
          userId: tenantRows[0].id,
          agencyId: agency.id,
          recipient: tenantRows[0].email,
          template: "viewing_created",
          variables: { startsAt: startsAt.toISOString() },
          subjectType: "appointment",
          subjectId: appointment.id,
          dedupeKey: `appointment:${appointment.id}:created`,
        }, { transaction: tx });
      }
    });
    const response = { data: { appointment: safeAppointment(persistedAppointment), warnings: warnings.map((warning) => ({ code: "RESPONSIBLE_USER_OVERLAP", ...warning })), idempotentReplay } };
    return idempotentReplay ? response : reply.status(201).send(response);
  });

  app.patch("/api/v1/agency/appointments/:appointmentId", { schema: { tags: ["Agencia"], summary: "Actualizar una cita" } }, async (request) => {
    const { user, agency } = requireAgency(request);
    const appointmentId = idParam.parse((request.params as { appointmentId?: unknown }).appointmentId);
    const rows = await deps.db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.agencyId, agency.id))).limit(1);
    const appointment = rows[0];
    if (!appointment) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "No se ha encontrado la cita.");
    const application = await agencyApplication(deps, agency.id, appointment.applicationId);
    assertApplicationActive(application);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("reschedule"), expectedUpdatedAt: z.iso.datetime({ offset: true }), startsAt: z.iso.datetime({ offset: true }), durationMinutes: z.number().int().min(15).max(480).optional(), responsibleUserId: z.string().uuid().nullable().optional(), instructions: z.string().trim().max(1_000).nullable().optional(), internalNote: z.string().trim().max(2_000).nullable().optional() }),
      z.object({ action: z.literal("cancel"), expectedUpdatedAt: z.iso.datetime({ offset: true }) }), z.object({ action: z.literal("complete"), expectedUpdatedAt: z.iso.datetime({ offset: true }) }), z.object({ action: z.literal("no_show"), expectedUpdatedAt: z.iso.datetime({ offset: true }) }),
    ]).parse(request.body);
    if (appointment.state !== "scheduled") throw new ApiError(409, "APPOINTMENT_FINAL", "Esta cita ya está cerrada y no puede modificarse.");
    const requestTime = nowFor(deps);
    const changedAt = new Date(Math.max(requestTime.getTime(), appointment.updatedAt.getTime() + 1));
    let warnings: Awaited<ReturnType<typeof overlapWarnings>> = [];
    await options.beforeAgencyWrite?.("appointment");
    if (input.action === "reschedule") {
      const responsibleUserId = input.responsibleUserId === undefined ? appointment.responsibleUserId : input.responsibleUserId;
      if (responsibleUserId) await assertAgencyMember(deps.db, agency.id, responsibleUserId);
      const startsAt = new Date(input.startsAt);
      if (startsAt <= changedAt) throw new ApiError(422, "APPOINTMENT_IN_PAST", "La cita debe programarse en una fecha futura.");
      const durationMinutes = input.durationMinutes ?? appointment.durationMinutes;
      await deps.db.transaction(async (tx) => {
        await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
        if (responsibleUserId) await assertAgencyMember(tx as unknown as Database, agency.id, responsibleUserId);
        const tenantRows = await tx.select({ id: users.id, email: users.email, accountState: users.accountState }).from(users)
          .where(eq(users.id, application.tenantUserId)).for("update").limit(1);
        if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "TENANT_CLOSURE_IN_PROGRESS", "La cuenta del interesado está en proceso de cierre y la cita no puede modificarse.");
        const locked = await tx.select().from(applications).where(and(eq(applications.id, application.id), eq(applications.agencyId, agency.id))).for("update").limit(1);
        if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
        warnings = await overlapWarnings(tx as unknown as Database, { agencyId: agency.id, responsibleUserId, startsAt, durationMinutes, excludeId: appointment.id });
        const updated = await tx.update(appointments).set({
          startsAt, durationMinutes, responsibleUserId,
          instructions: input.instructions === undefined ? appointment.instructions : input.instructions,
          internalNote: input.internalNote === undefined ? appointment.internalNote : input.internalNote,
          updatedAt: changedAt,
        }).where(and(eq(appointments.id, appointmentId), eq(appointments.agencyId, agency.id), eq(appointments.state, "scheduled"), eq(appointments.updatedAt, new Date(input.expectedUpdatedAt)))).returning({ id: appointments.id });
        if (!updated[0]) throw new ApiError(409, "APPOINTMENT_CHANGED", "La cita ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        await expireScheduledSubjectEmails(tx as unknown as Database, "appointment", appointmentId, "APPOINTMENT_CHANGED");
        await tx.insert(auditEvents).values({ id: newId(), agencyId: agency.id, actorUserId: user.id, action: "appointment_reschedule", subjectType: "appointment", subjectId: appointmentId, metadata: { applicationId: appointment.applicationId, propertyId: appointment.propertyId }, createdAt: changedAt });
        if (tenantRows[0]) {
          await deps.emailProvider.send({
            userId: tenantRows[0].id,
            agencyId: agency.id,
            recipient: tenantRows[0].email,
            template: "viewing_rescheduled",
            variables: { startsAt: input.startsAt },
            subjectType: "appointment",
            subjectId: appointmentId,
            dedupeKey: `appointment:${appointmentId}:rescheduled:${changedAt.toISOString()}`,
          }, { transaction: tx });
        }
      });
    } else {
      const state = input.action === "cancel" ? "cancelled" : input.action === "complete" ? "completed" : "no_show";
      await deps.db.transaction(async (tx) => {
        await lockActiveAgency(tx as unknown as Database, agency.id, { userId: user.id });
        const tenantRows = await tx.select({ id: users.id, email: users.email, accountState: users.accountState }).from(users)
          .where(eq(users.id, application.tenantUserId)).for("update").limit(1);
        if (tenantRows[0]?.accountState !== "active") throw new ApiError(409, "TENANT_CLOSURE_IN_PROGRESS", "La cuenta del interesado está en proceso de cierre y la cita no puede modificarse.");
        const locked = await tx.select().from(applications).where(and(eq(applications.id, application.id), eq(applications.agencyId, agency.id))).for("update").limit(1);
        if (!locked[0] || locked[0].retentionState !== "active") throw new ApiError(409, "APPLICATION_RETENTION_IN_PROGRESS", "La solicitud está en proceso de eliminación y ya no admite cambios.");
        const updated = await tx.update(appointments).set({ state, updatedAt: changedAt })
          .where(and(eq(appointments.id, appointmentId), eq(appointments.agencyId, agency.id), eq(appointments.state, "scheduled"), eq(appointments.updatedAt, new Date(input.expectedUpdatedAt)))).returning({ id: appointments.id });
        if (!updated[0]) throw new ApiError(409, "APPOINTMENT_CHANGED", "La cita ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        await expireScheduledSubjectEmails(tx as unknown as Database, "appointment", appointmentId, "APPOINTMENT_CHANGED");
        await tx.insert(auditEvents).values({ id: newId(), agencyId: agency.id, actorUserId: user.id, action: `appointment_${input.action}`, subjectType: "appointment", subjectId: appointmentId, metadata: { applicationId: appointment.applicationId, propertyId: appointment.propertyId }, createdAt: changedAt });
        if (state === "cancelled" && tenantRows[0]) {
          await deps.emailProvider.send({
            userId: tenantRows[0].id,
            agencyId: agency.id,
            recipient: tenantRows[0].email,
            template: "viewing_cancelled",
            variables: { startsAt: appointment.startsAt.toISOString() },
            subjectType: "appointment",
            subjectId: appointmentId,
            dedupeKey: `appointment:${appointmentId}:cancelled`,
          }, { transaction: tx });
        }
      });
    }
    const updated = await deps.db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.agencyId, agency.id))).limit(1);
    if (!updated[0]) throw new ApiError(404, "APPOINTMENT_NOT_FOUND", "No se ha encontrado la cita.");
    return { data: { appointment: safeAppointment(updated[0]), warnings: warnings.map((warning) => ({ code: "RESPONSIBLE_USER_OVERLAP", ...warning })) } };
  });
}
