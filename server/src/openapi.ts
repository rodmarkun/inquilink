type JsonSchema = Record<string, unknown>;

const string = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const integer = { type: "integer" };
const boolean = { type: "boolean" };
const password = { type: "string", format: "password", minLength: 10, maxLength: 200 };
const shortName = { type: "string", minLength: 2, maxLength: 200 };
const email = { type: "string", format: "email", maxLength: 320 };
const documentCategory = { type: "string", enum: ["payslips", "employment_contract", "self_employed_income", "irpf_tax_return", "employment_history", "pension_proof", "guarantor_proof", "supporting"] };

function object(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function extensibleObject(properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: true };
}

function dataOf(properties: Record<string, JsonSchema>, required: string[] = Object.keys(properties)): JsonSchema {
  return object({ data: object(properties, required) }, ["data"]);
}

const accountType = { type: "string", enum: ["agency", "tenant"] };
const plan = { type: "string", enum: ["particular", "professional", "inmobiliaria"] };
const propertyFields: Record<string, JsonSchema> = {
  internalReference: { type: "string", minLength: 1, maxLength: 100 }, title: { type: "string", minLength: 2, maxLength: 240 }, address: { type: "string", minLength: 2, maxLength: 500 }, city: { type: "string", minLength: 2, maxLength: 120 }, province: { type: "string", minLength: 2, maxLength: 120 }, postalCode: { type: "string", minLength: 3, maxLength: 20 },
  propertyType: { type: "string", minLength: 2, maxLength: 80 }, bedrooms: { type: "integer", minimum: 0, maximum: 100 }, bathrooms: { type: "integer", minimum: 0, maximum: 100 }, floorAreaSqm: { type: "integer", minimum: 1, maximum: 100000 },
  availableFrom: { type: "string", format: "date" }, description: { type: "string", minLength: 2, maxLength: 5000 }, publicLocation: { type: "string", minLength: 2, maxLength: 240 },
  coverImageUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 }, galleryUrls: { type: "array", maxItems: 20, items: { type: "string", format: "uri", maxLength: 2000 } },
  monthlyRentCents: { type: "integer", minimum: 1, maximum: 100000000 }, responsibleUserId: { type: ["string", "null"], format: "uuid" },
  requestedDocumentCategories: { type: "array", maxItems: 8, items: documentCategory },
};
const propertyRequired = ["internalReference", "title", "address", "city", "province", "postalCode", "propertyType", "bedrooms", "bathrooms", "floorAreaSqm", "availableFrom", "description", "publicLocation", "monthlyRentCents"];
const applicationFields: Record<string, JsonSchema> = {
  fullName: shortName, email, phone: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$" }, preferredContactChannel: { type: "string", enum: ["whatsapp", "phone", "email"] },
  adultOccupants: { type: "integer", minimum: 1, maximum: 20 }, minorOccupants: { type: "integer", minimum: 0, maximum: 20 }, intendedMoveInDate: { type: "string", format: "date" }, pets: { type: "string", enum: ["yes", "no"] },
  additionalAdults: { type: "array", maxItems: 19, items: object({ id: uuid, fullName: shortName, email: { type: ["string", "null"], format: "email" }, phone: { type: ["string", "null"], pattern: "^\\+[1-9]\\d{7,14}$" }, employmentStatus: string, employerOrActivity: string, contractType: string, netMonthlyIncomeCents: { type: "integer", minimum: 0, maximum: 100000000 } }, ["id", "fullName", "employmentStatus", "employerOrActivity", "contractType", "netMonthlyIncomeCents"]) },
  petDetails: { type: ["string", "null"], maxLength: 500 }, message: { type: ["string", "null"], maxLength: 2000 }, employmentStatus: { type: "string", minLength: 1, maxLength: 100 },
  employerOrActivity: { type: "string", minLength: 1, maxLength: 200 }, contractType: { type: "string", minLength: 1, maxLength: 100 }, individualNetMonthlyIncomeCents: { type: "integer", minimum: 0, maximum: 100000000 },
  householdNetMonthlyIncomeCents: { type: "integer", minimum: 0, maximum: 100000000 }, guarantorAvailability: { type: "string", enum: ["yes", "no", "unsure"] },
  viewingAvailability: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 200 } }, availabilityNote: { type: ["string", "null"], maxLength: 1000 }, marketingConsent: boolean,
};

interface OperationDocumentation {
  body?: JsonSchema;
  bodyRequired?: boolean;
  success?: number[];
  response?: JsonSchema;
  errors?: number[];
}

const dateTime = { type: "string", format: "date-time" };
const nullableDateTime = { type: ["string", "null"], format: "date-time" };
const nullableString = { type: ["string", "null"] };
const paginationMetadata = object({
  page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 },
  total: { type: "integer", minimum: 0 }, totalPages: { type: "integer", minimum: 0 }, hasMore: boolean,
}, ["page", "pageSize", "total", "totalPages", "hasMore"]);
const userSummary = object({ id: uuid, kind: accountType, email, fullName: shortName }, ["id", "kind", "email", "fullName"]);
const authenticatedUser = object({ id: uuid, kind: accountType, email, fullName: shortName, emailVerified: boolean }, ["id", "kind", "email", "fullName", "emailVerified"]);
const profileResponse = dataOf({ profile: object({ id: uuid, fullName: shortName, email, accountType }, ["id", "fullName", "email", "accountType"]) });
const agencySettings = object({ id: uuid, name: shortName, phone: nullableString, contactEmail: { type: ["string", "null"], format: "email" }, logoUrl: { type: ["string", "null"], format: "uri" }, timezone: string }, ["id", "name", "phone", "contactEmail", "logoUrl", "timezone"]);
const subscription = object({
  id: uuid, agencyId: uuid, plan, state: { type: "string", enum: ["incomplete", "trialing", "active", "past_due", "cancelled"] },
  trialEndsAt: nullableDateTime, currentPeriodEndsAt: nullableDateTime, cancelAtPeriodEnd: boolean,
  paymentMethodDisplay: nullableString, createdAt: dateTime, updatedAt: dateTime,
}, ["id", "agencyId", "plan", "state", "trialEndsAt", "currentPeriodEndsAt", "cancelAtPeriodEnd", "paymentMethodDisplay", "createdAt", "updatedAt"]);
const billingStatusResponse = dataOf({
  subscription: { anyOf: [subscription, { type: "null" }] },
  fiscalProfile: { anyOf: [object({ fiscalId: nullableString, billingName: nullableString, billingAddress: nullableString }, ["fiscalId", "billingName", "billingAddress"]), { type: "null" }] },
  prices: object({ particular: { type: "integer", const: 999 }, professional: { type: "integer", const: 4999 }, inmobiliaria: { type: "integer", const: 9999 } }, ["particular", "professional", "inmobiliaria"]),
  allowances: object({
    particular: object({ name: { type: "string", const: "Particular" }, priceCents: { type: "integer", const: 999 }, listingLimit: { type: "integer", const: 2 }, accountLimit: { type: "integer", const: 1 } }, ["name", "priceCents", "listingLimit", "accountLimit"]),
    professional: object({ name: { type: "string", const: "Profesional" }, priceCents: { type: "integer", const: 4999 }, listingLimit: { type: "integer", const: 15 }, accountLimit: { type: "integer", const: 3 } }, ["name", "priceCents", "listingLimit", "accountLimit"]),
    inmobiliaria: object({ name: { type: "string", const: "Inmobiliaria" }, priceCents: { type: "integer", const: 9999 }, listingLimit: { type: "integer", const: 100 }, accountLimit: { type: "null" } }, ["name", "priceCents", "listingLimit", "accountLimit"]),
  }, ["particular", "professional", "inmobiliaria"]),
  currency: { type: "string", const: "EUR" }, taxTreatment: { type: "string", const: "pending_commercial_decision" }, trialDays: { type: "integer", const: 30 },
});
const invoice = object({ id: uuid, amountCents: { type: "integer", minimum: 0, maximum: 2_147_483_647 }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, status: { type: "string", enum: ["open", "paid", "past_due", "void", "uncollectible"] }, issuedAt: dateTime, hostedUrl: { type: ["string", "null"], format: "uri" } }, ["id", "amountCents", "currency", "status", "issuedAt", "hostedUrl"]);
const adultProfile = object({ id: string, isPrimary: boolean, fullName: shortName, email: { type: ["string", "null"], format: "email" }, phone: { type: ["string", "null"] }, employmentStatus: string, employerOrActivity: string, contractType: string, netMonthlyIncomeCents: integer }, ["id", "isPrimary", "fullName", "email", "phone", "employmentStatus", "employerOrActivity", "contractType", "netMonthlyIncomeCents"]);
const possibleDuplicate = { anyOf: [object({ matchedOn: { type: "array", uniqueItems: true, items: { type: "string", enum: ["email", "phone"] } }, applicationIds: { type: "array", items: uuid } }, ["matchedOn", "applicationIds"]), { type: "null" }], description: "Señal informativa limitada al mismo inmueble; nunca fusiona, rechaza ni cambia solicitudes." };
const teamMember = object({ userId: uuid, fullName: shortName, email, role: { type: "string", enum: ["admin", "collaborator"] }, joinedAt: dateTime }, ["userId", "fullName", "email", "role", "joinedAt"]);
const invitation = object({ id: uuid, email, role: { type: "string", enum: ["admin", "collaborator"] }, expiresAt: dateTime, createdAt: dateTime }, ["id", "email", "role", "expiresAt", "createdAt"]);
const dashboardApplicant = object({ applicationId: uuid, propertyId: uuid, applicantName: shortName, propertyTitle: string, submittedAt: dateTime, href: string }, ["applicationId", "propertyId", "applicantName", "propertyTitle", "submittedAt", "href"]);
const dashboardViewing = object({ appointmentId: uuid, applicationId: uuid, propertyId: uuid, applicantName: shortName, propertyTitle: string, startsAt: dateTime, durationMinutes: integer, responsibleUserName: { type: ["string", "null"], minLength: 2, maxLength: 200 }, href: string }, ["appointmentId", "applicationId", "propertyId", "applicantName", "propertyTitle", "startsAt", "durationMinutes", "responsibleUserName", "href"]);
const dashboardTopProperty = object({ propertyId: uuid, internalReference: { type: "string", minLength: 1, maxLength: 100 }, title: string, city: string, coverImageUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 }, applicantCount: { type: "integer", minimum: 0 }, href: string }, ["propertyId", "internalReference", "title", "city", "coverImageUrl", "applicantCount", "href"]);
const dashboardResponse = dataOf({
  newApplicants: object({ count: integer, periodDays: { type: "integer", const: 30 }, href: string, items: { type: "array", items: dashboardApplicant } }, ["count", "periodDays", "href", "items"]),
  upcomingViewings: object({ href: string, items: { type: "array", items: dashboardViewing } }, ["href", "items"]),
  topProperties: object({ href: string, items: { type: "array", items: dashboardTopProperty, description: "Todos los anuncios publicados de la agencia con su número de interesados (también cero)." } }, ["href", "items"]),
});
const viewingRecord = object({
  id: uuid, agencyId: uuid, propertyId: uuid, applicationId: uuid,
  responsibleUserId: { type: ["string", "null"], format: "uuid" }, startsAt: dateTime,
  durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
  state: { type: "string", enum: ["scheduled", "completed", "cancelled", "no_show"] }, archivedAt: nullableDateTime,
  instructions: nullableString, internalNote: nullableString, createdAt: dateTime, updatedAt: dateTime,
}, ["id", "agencyId", "propertyId", "applicationId", "responsibleUserId", "startsAt", "durationMinutes", "state", "archivedAt", "instructions", "internalNote", "createdAt", "updatedAt"]);
const nullableViewingRecord = { anyOf: [viewingRecord, { type: "null" }] };
const agencyApplicationRecord = extensibleObject({
  id: uuid, agencyId: uuid, propertyId: uuid, tenantUserId: uuid,
  responsibleUserId: { type: ["string", "null"], format: "uuid" },
  status: { type: "string", enum: ["new", "preselected", "selected", "final_tenant", "rejected", "withdrawn"] },
  documentState: { type: "string", enum: ["complete", "missing", "not_requested"] }, submittedAt: nullableDateTime,
  phone: { type: ["string", "null"], pattern: "^\\+[1-9]\\d{7,14}$" },
  individualNetMonthlyIncomeCents: { type: ["integer", "null"], minimum: 0, maximum: 100000000 },
  householdNetMonthlyIncomeCents: { type: ["integer", "null"], minimum: 0, maximum: 100000000 },
  adultOccupants: { type: ["integer", "null"], minimum: 1, maximum: 20 },
  minorOccupants: { type: ["integer", "null"], minimum: 0, maximum: 20 },
  intendedMoveInDate: { type: ["string", "null"], format: "date" }, applicationDataPromotedAt: nullableDateTime,
  duplicatePhoneFlaggedAt: nullableDateTime,
  adultProfiles: { type: "array", items: adultProfile }, draftData: { type: "object", additionalProperties: true },
  createdAt: dateTime, updatedAt: dateTime,
}, ["id", "agencyId", "propertyId", "tenantUserId", "responsibleUserId", "status", "documentState", "submittedAt", "phone", "individualNetMonthlyIncomeCents", "householdNetMonthlyIncomeCents", "adultOccupants", "minorOccupants", "intendedMoveInDate", "applicationDataPromotedAt", "adultProfiles", "draftData", "createdAt", "updatedAt"]);
const agencyPropertyRecord = extensibleObject({
  id: uuid, agencyId: uuid, internalReference: string, title: string, address: nullableString, city: string, province: string,
  monthlyRentCents: integer, state: { type: "string", enum: ["draft", "published", "paused", "archived"] },
  coverImageUrl: { type: ["string", "null"], format: "uri" }, createdAt: dateTime, updatedAt: dateTime,
}, ["id", "agencyId", "internalReference", "title", "address", "city", "province", "monthlyRentCents", "state", "coverImageUrl", "createdAt", "updatedAt"]);
const agencyApplicationDetailResponse = dataOf({
  application: agencyApplicationRecord,
  applicant: { anyOf: [object({ fullName: shortName, email }, ["fullName", "email"]), { type: "null" }] },
  responsibleUser: { anyOf: [object({ id: uuid, fullName: shortName }, ["id", "fullName"]), { type: "null" }] },
  property: agencyPropertyRecord,
  documents: { type: "array", items: extensibleObject({ id: uuid, applicationId: uuid, adultProfileId: string, category: documentCategory, originalName: string, contentType: string, byteSize: integer, malwareScanState: string, deletionState: string, createdAt: dateTime, updatedAt: dateTime }, ["id", "applicationId", "adultProfileId", "category", "originalName", "contentType", "byteSize", "malwareScanState", "deletionState", "createdAt", "updatedAt"]) },
  possibleDuplicate,
  notes: { type: "array", items: object({ note: object({ id: uuid, agencyId: uuid, applicationId: uuid, authorUserId: { type: ["string", "null"], format: "uuid" }, body: string, createdAt: dateTime }, ["id", "agencyId", "applicationId", "authorUserId", "body", "createdAt"]), authorName: shortName }, ["note", "authorName"]) },
  statusHistory: { type: "array", items: object({ id: uuid, applicationId: uuid, agencyId: uuid, actorUserId: { type: ["string", "null"], format: "uuid" }, fromStatus: string, toStatus: string, createdAt: dateTime }, ["id", "applicationId", "agencyId", "actorUserId", "fromStatus", "toStatus", "createdAt"]) },
  appointments: { type: "array", items: viewingRecord },
  activity: { type: "array", items: object({ id: string, type: string, actorUserId: { type: ["string", "null"] }, createdAt: dateTime, metadata: { type: "object", additionalProperties: true } }, ["id", "type", "actorUserId", "createdAt", "metadata"]) },
});
const appointmentDetail = object({
  id: uuid,
  agencyId: uuid,
  propertyId: uuid,
  applicationId: uuid,
  responsibleUserId: { type: ["string", "null"], format: "uuid" },
  startsAt: dateTime,
  durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
  state: { type: "string", enum: ["scheduled", "completed", "cancelled", "no_show"] },
  archivedAt: nullableDateTime,
  instructions: { type: ["string", "null"], maxLength: 1000 },
  internalNote: { type: ["string", "null"], maxLength: 2000 },
  createdAt: dateTime,
  updatedAt: dateTime,
  applicantName: shortName,
  propertyTitle: string,
  responsibleUserName: { type: ["string", "null"], minLength: 2, maxLength: 200 },
  href: string,
}, ["id", "agencyId", "propertyId", "applicationId", "responsibleUserId", "startsAt", "durationMinutes", "state", "archivedAt", "instructions", "internalNote", "createdAt", "updatedAt", "applicantName", "propertyTitle", "responsibleUserName", "href"]);
const propertyListItem = object({
  property: agencyPropertyRecord,
  applicantCount: { type: "integer", minimum: 0 }, newApplicantCount: { type: "integer", minimum: 0 }, recentNewApplicantCount: { type: "integer", minimum: 0 },
  nextViewing: nullableViewingRecord,
}, ["property", "applicantCount", "newApplicantCount", "recentNewApplicantCount", "nextViewing"]);
const agencyApplicationListItem = object({
  application: agencyApplicationRecord,
  tenantName: shortName, tenantEmail: email, responsibleUserName: nullableString,
  nextViewing: nullableViewingRecord, possibleDuplicate,
}, ["application", "tenantName", "tenantEmail", "responsibleUserName", "nextViewing", "possibleDuplicate"]);
const tenantApplicationsResponse = dataOf({
  applications: {
    type: "array",
    items: object({
      application: object({
        id: uuid,
        status: { type: "string", enum: ["new", "preselected", "selected", "final_tenant", "rejected", "withdrawn"] },
        documentState: { type: "string", enum: ["complete", "missing", "not_requested"] },
        submittedAt: nullableDateTime,
        updatedAt: dateTime,
      }, ["id", "status", "documentState", "submittedAt", "updatedAt"]),
      property: object({
        id: uuid,
        title: { type: "string", minLength: 2, maxLength: 240 },
        publicLocation: { type: ["string", "null"], minLength: 2, maxLength: 240 },
        coverImageUrl: { type: ["string", "null"], format: "uri", maxLength: 2000 },
      }, ["id", "title", "publicLocation", "coverImageUrl"]),
      resumePath: { type: ["string", "null"], pattern: "^/solicitud/" },
    }, ["application", "property", "resumePath"]),
  },
});
const tenantApplicationDetailResponse = dataOf({
  application: object({
    id: uuid,
    status: { type: "string", enum: ["new", "preselected", "selected", "final_tenant", "rejected", "withdrawn"] },
    documentState: { type: "string", enum: ["complete", "missing", "not_requested"] },
    submittedAt: nullableDateTime,
    updatedAt: dateTime,
  }, ["id", "status", "documentState", "submittedAt", "updatedAt"]),
  property: object({
    id: uuid, agencyName: shortName, internalReference: string, title: string, publicLocation: string,
    monthlyRentCents: integer, propertyType: string, bedrooms: integer, bathrooms: integer,
    floorAreaSqm: integer, availableFrom: { type: "string", format: "date" },
    coverImageUrl: { type: ["string", "null"], format: "uri" },
    requestedDocumentCategories: { type: "array", items: documentCategory },
  }, ["id", "agencyName", "internalReference", "title", "publicLocation", "monthlyRentCents", "propertyType", "bedrooms", "bathrooms", "floorAreaSqm", "availableFrom", "coverImageUrl", "requestedDocumentCategories"]),
  documents: { type: "array", items: object({
    id: uuid, applicationId: uuid, adultProfileId: string, category: documentCategory, originalName: string, contentType: string,
    byteSize: integer, malwareScanState: { type: "string", enum: ["pending", "clean", "infected", "error"] },
    deletionState: { type: "string", enum: ["active", "deleting"] }, createdAt: dateTime, updatedAt: dateTime,
  }, ["id", "applicationId", "adultProfileId", "category", "originalName", "contentType", "byteSize", "malwareScanState", "deletionState", "createdAt", "updatedAt"]) },
});

const docs: Record<string, OperationDocumentation> = {
  "post /api/v1/auth/agency/register": { body: object({ fullName: shortName, agencyName: shortName, email, phone: { type: "string", minLength: 6, maxLength: 40 }, fiscalId: { type: "string" }, billingName: shortName, billingAddress: { type: "string", minLength: 5, maxLength: 500 }, password, termsAccepted: { type: "boolean", const: true }, termsVersion: { type: "string", const: "terms-2026-08-v1" }, returnPath: { type: "string", maxLength: 500 } }, ["fullName", "agencyName", "email", "phone", "password", "termsAccepted", "termsVersion"]), success: [201], response: dataOf({ userId: uuid, agencyId: uuid, message: string, debugToken: string }, ["userId", "agencyId", "message"]), errors: [400, 409, 413, 429, 500, 503] },
  "post /api/v1/auth/tenant/register": { body: object({ fullName: shortName, email, password, termsAccepted: { type: "boolean", const: true }, termsVersion: { type: "string", const: "terms-2026-08-v1" }, returnPath: { type: "string", maxLength: 500 } }, ["fullName", "email", "password", "termsAccepted", "termsVersion"]), success: [201], response: dataOf({ userId: uuid, message: string, debugToken: string }, ["userId", "message"]), errors: [400, 409, 413, 429, 500, 503] },
  "post /api/v1/auth/verify-email": { body: object({ token: { type: "string", minLength: 20 } }, ["token"]), response: dataOf({ verified: { type: "boolean", const: true }, returnPath: string }), errors: [400, 403, 413, 500] },
  "post /api/v1/auth/login": { body: object({ email, password: { type: "string", format: "password", minLength: 1 }, accountType, returnPath: { type: "string", maxLength: 500 } }, ["email", "password", "accountType"]), response: dataOf({ user: userSummary, returnPath: string }), errors: [400, 401, 403, 413, 429, 500] },
  "post /api/v1/auth/logout": { success: [204], errors: [500] },
  "post /api/v1/auth/forgot-password": { body: object({ email, accountType, returnPath: { type: "string", maxLength: 500 } }, ["email", "accountType"]), response: dataOf({ message: string, debugToken: string }, ["message"]), errors: [400, 429, 500, 503] },
  "post /api/v1/auth/reset-password": { body: object({ token: { type: "string", minLength: 20 }, password }, ["token", "password"]), response: dataOf({ message: string, returnPath: string }), errors: [400, 413, 500] },
  "get /api/v1/auth/me": { response: dataOf({ user: authenticatedUser, agency: { anyOf: [object({ id: uuid, name: shortName, role: { type: "string", enum: ["admin", "collaborator"] } }, ["id", "name", "role"]), { type: "null" }] } }), errors: [401, 500] },
  "get /api/v1/billing/status": { response: billingStatusResponse, errors: [401, 403, 500] },
  "patch /api/v1/billing/fiscal-profile": { body: object({ fiscalId: { type: "string" }, billingName: shortName, billingAddress: { type: "string", minLength: 5, maxLength: 500 } }, ["fiscalId", "billingName", "billingAddress"]), response: dataOf({ fiscalProfile: object({ fiscalId: string, billingName: string, billingAddress: string }, ["fiscalId", "billingName", "billingAddress"]) }), errors: [400, 401, 403, 409, 422, 500, 503] },
  "get /api/v1/billing/invoices": { response: dataOf({ invoices: { type: "array", items: invoice } }), errors: [401, 403, 500] },
  "post /api/v1/billing/trial": { body: object({ plan, paymentMethodToken: { type: "string", pattern: "^pm_[A-Za-z0-9_-]{4,}$" } }, ["plan", "paymentMethodToken"]), success: [201], response: dataOf({ subscription, firstChargeCents: { type: "integer", enum: [999, 4999, 9999] }, currency: { type: "string", const: "EUR" }, taxTreatment: { type: "string", const: "pending_commercial_decision" }, trialDays: { type: "integer", const: 30 } }), errors: [400, 401, 403, 409, 422, 500, 503] },
  "post /api/v1/billing/cancel": { response: dataOf({ cancelAtPeriodEnd: { type: "boolean", const: true }, effectiveAt: nullableDateTime }), errors: [400, 401, 403, 404, 409, 422, 500, 503] },
  "post /api/v1/billing/reactivate": { response: dataOf({ cancelAtPeriodEnd: { type: "boolean", const: false } }), errors: [400, 401, 403, 404, 409, 422, 500, 503] },
  "patch /api/v1/billing/payment-method": { body: object({ paymentMethodToken: { type: "string", pattern: "^pm_[A-Za-z0-9_-]{4,}$" } }, ["paymentMethodToken"]), response: dataOf({ paymentMethodDisplay: string }), errors: [400, 401, 403, 404, 409, 422, 500, 503] },
  "post /api/v1/agency/properties": { body: object(propertyFields, propertyRequired), success: [201] },
  "get /api/v1/agency/applications/:applicationId": { response: agencyApplicationDetailResponse, errors: [400, 401, 403, 404, 500] },
  "get /api/v1/agency/properties": { response: dataOf({ properties: { type: "array", items: propertyListItem }, pagination: paginationMetadata }), errors: [400, 401, 403, 500] },
  "patch /api/v1/agency/properties/:propertyId": { body: object({ ...propertyFields, expectedVersion: integer }) },
  "post /api/v1/agency/properties/:propertyId/publish": { body: object({ expectedVersion: integer }, ["expectedVersion"]) },
  "post /api/v1/agency/properties/:propertyId/pause": { body: object({ expectedVersion: integer }, ["expectedVersion"]) },
  "post /api/v1/agency/properties/:propertyId/archive": { body: object({ expectedVersion: integer }, ["expectedVersion"]) },
  "post /api/v1/agency/properties/:propertyId/public-link/regenerate": { body: object({ expectedVersion: integer }, ["expectedVersion"]) },
  "get /api/v1/public/properties/:token": { errors: [400, 404, 410, 500] },
  "post /api/v1/public/applications/by-link/:token/request-otp": {
    body: object({ email, website: string, formElapsedMs: { type: "integer", minimum: 0 } }, ["email"]),
    response: dataOf({ message: string, debugOtp: { type: "string", pattern: "^\\d{6}$" } }, ["message"]),
    errors: [400, 404, 410, 429, 500, 503],
  },
  "post /api/v1/public/applications/by-link/:token/submit": {
    body: object({
      email,
      otp: { type: "string", pattern: "^\\d{6}$" },
      application: object(applicationFields, Object.keys(applicationFields).filter((key) => !["additionalAdults", "petDetails", "message", "availabilityNote", "marketingConsent"].includes(key))),
      consentVersion: { type: "string", const: "privacy-2026-08-v1" },
      privacyConsent: { type: "boolean", const: true },
      submissionKey: { type: "string", minLength: 16, maxLength: 200 },
      website: string,
    }, ["email", "otp", "application", "consentVersion", "privacyConsent", "submissionKey"]),
    success: [200, 201],
    errors: [400, 404, 409, 410, 422, 429, 500, 503],
  },
  "get /api/v1/tenant/application-drafts/by-link/:token": { errors: [400, 401, 404, 410, 500] },
  "get /api/v1/tenant/applications": { response: tenantApplicationsResponse, errors: [401, 403, 500] },
  "get /api/v1/tenant/applications/:applicationId": { response: tenantApplicationDetailResponse, errors: [400, 401, 403, 404, 409, 500] },
  "put /api/v1/tenant/application-drafts/by-link/:token": { body: object(applicationFields), success: [200, 201], errors: [400, 401, 404, 409, 410, 500] },
  "post /api/v1/tenant/applications/by-link/:token/submit": { body: object({ application: object(applicationFields, Object.keys(applicationFields).filter((key) => !["additionalAdults", "petDetails", "message", "availabilityNote", "marketingConsent"].includes(key))), consentVersion: { type: "string", const: "privacy-2026-08-v1" }, privacyConsent: { type: "boolean", const: true }, submissionKey: { type: "string", minLength: 16, maxLength: 200 } }, ["application", "consentVersion", "privacyConsent", "submissionKey"]), success: [200, 201], errors: [400, 401, 404, 409, 410, 422, 500, 503] },
  "post /api/v1/tenant/account/set-password": { body: object({ password, termsAccepted: { type: "boolean", const: true }, termsVersion: { type: "string", const: "terms-2026-08-v1" } }, ["password", "termsAccepted", "termsVersion"]), response: dataOf({ passwordSet: { type: "boolean", const: true } }), errors: [400, 401, 403, 409, 413, 500] },
  "get /api/v1/agency/properties/:propertyId/applications": { response: dataOf({ applications: { type: "array", items: agencyApplicationListItem }, pagination: paginationMetadata }), errors: [400, 401, 403, 404, 500] },
  "patch /api/v1/agency/applications/:applicationId/status": { body: object({ status: { type: "string", enum: ["new", "preselected", "selected", "final_tenant", "rejected"] }, expectedStatus: { type: "string", enum: ["new", "preselected", "selected", "final_tenant", "rejected", "withdrawn"] } }, ["status", "expectedStatus"]) },
  "patch /api/v1/agency/applications/:applicationId/responsible-user": { body: object({ responsibleUserId: { type: ["string", "null"], format: "uuid" } }, ["responsibleUserId"]) },
  "post /api/v1/agency/applications/:applicationId/notes": { body: object({ body: { type: "string", minLength: 1, maxLength: 5000 } }, ["body"]), success: [201] },
  "post /api/v1/agency/applications/:applicationId/whatsapp": { body: object({ message: { type: "string", minLength: 1, maxLength: 2000 } }), bodyRequired: false },
  "post /api/v1/tenant/applications/:applicationId/documents": { body: object({ adultProfileId: { type: "string", minLength: 1, maxLength: 50 }, category: documentCategory, originalName: { type: "string", minLength: 1, maxLength: 255 }, contentType: string, dataBase64: { type: "string", format: "byte", minLength: 4 } }, ["category", "originalName", "contentType", "dataBase64"]), success: [201] },
  "post /api/v1/agency/appointments": { body: object({ applicationId: uuid, startsAt: { type: "string", format: "date-time" }, durationMinutes: { type: "integer", minimum: 15, maximum: 480 }, responsibleUserId: { type: ["string", "null"], format: "uuid" }, instructions: { type: ["string", "null"], maxLength: 1000 }, internalNote: { type: ["string", "null"], maxLength: 2000 } }, ["applicationId", "startsAt", "durationMinutes"]), success: [200, 201] },
  "get /api/v1/agency/appointments": { response: dataOf({ appointments: { type: "array", items: appointmentDetail }, pagination: paginationMetadata }), errors: [400, 401, 403, 500] },
  "get /api/v1/agency/appointments/:appointmentId": { response: dataOf({ appointment: appointmentDetail }), errors: [400, 401, 403, 404, 500] },
  "patch /api/v1/agency/appointments/:appointmentId": { body: { oneOf: [object({ action: { const: "reschedule" }, expectedUpdatedAt: { type: "string", format: "date-time" }, startsAt: { type: "string", format: "date-time" }, durationMinutes: { type: "integer", minimum: 15, maximum: 480 }, responsibleUserId: { type: ["string", "null"], format: "uuid" }, instructions: { type: ["string", "null"], maxLength: 1000 }, internalNote: { type: ["string", "null"], maxLength: 2000 } }, ["action", "expectedUpdatedAt", "startsAt"]), object({ action: { type: "string", enum: ["cancel", "complete", "no_show", "archive", "unarchive"] }, expectedUpdatedAt: { type: "string", format: "date-time" } }, ["action", "expectedUpdatedAt"])] } },
  "delete /api/v1/agency/properties/:propertyId/public-link": { body: object({ expectedVersion: integer }, ["expectedVersion"]), success: [204] },
  "delete /api/v1/tenant/applications/:applicationId/documents/:documentId": { success: [204] },
  "post /api/v1/agency/team/invitations": { body: object({ email: { type: "string", format: "email", maxLength: 320 } }, ["email"]), success: [201], response: dataOf({ invitation: object({ email, role: { type: "string", enum: ["admin", "collaborator"] }, expiresAt: dateTime }, ["email", "role", "expiresAt"]), message: string, debugToken: string }, ["invitation", "message"]), errors: [400, 401, 403, 409, 500, 503] },
  "delete /api/v1/agency/team/invitations/:invitationId": { success: [204] },
  "delete /api/v1/agency/team/members/:userId": { success: [204] },
  "patch /api/v1/agency/team/members/:userId": { response: dataOf({ userId: uuid, role: { type: "string", enum: ["admin", "collaborator"] } }), errors: [400, 401, 403, 404, 409, 500] },
  "post /api/v1/analytics/events": { success: [202], response: dataOf({ accepted: { type: "boolean", const: true } }), errors: [400, 403, 500] },
  "post /api/v1/team/invitations/accept": { body: {
    oneOf: [
      object({ token: { type: "string", minLength: 20 } }, ["token"]),
      object({ token: { type: "string", minLength: 20 }, fullName: { type: "string", minLength: 2, maxLength: 200 }, password: { type: "string", format: "password", minLength: 10, maxLength: 200 }, termsAccepted: { type: "boolean", const: true } }, ["token", "fullName", "password", "termsAccepted"]),
    ],
    description: "Una cuenta de agencia autenticada envía solo el token. Una persona nueva debe incluir además nombre y contraseña.",
  }, response: dataOf({ accepted: { type: "boolean", const: true }, agencyId: uuid, message: string }), errors: [400, 409, 429, 500] },
  "get /api/v1/agency/dashboard": { response: dashboardResponse, errors: [401, 403, 500] },
  "get /api/v1/agency/team": { response: dataOf({ members: { type: "array", items: teamMember }, pagination: paginationMetadata }), errors: [401, 403, 500] },
  "get /api/v1/agency/team/invitations": { response: dataOf({ invitations: { type: "array", items: invitation }, pagination: paginationMetadata }), errors: [401, 403, 500] },
  "get /api/v1/account/profile": { response: profileResponse, errors: [401, 403, 500] },
  "patch /api/v1/account/profile": { response: profileResponse, errors: [400, 401, 403, 409, 500] },
  "get /api/v1/agency/settings": { response: dataOf({ agency: agencySettings }), errors: [401, 403, 500] },
  "patch /api/v1/agency/settings": { response: dataOf({ agency: agencySettings }), errors: [400, 401, 403, 409, 500] },
  "get /api/v1/documents/:documentId/content": { errors: [400, 401, 403, 404, 410, 423, 500, 503] },
  "post /api/v1/account/close": { body: object({ confirmation: { type: "string", const: "CERRAR MI CUENTA" } }, ["confirmation"]), success: [202], response: dataOf({ state: { type: "string", const: "closure_requested" }, purgePolicyEnabled: boolean }), errors: [400, 401, 403, 409, 500] },
};

const errorResponse = {
  description: "Error de API",
  content: { "application/json": { schema: object({ error: object({ code: string, message: string, details: {} }, ["code", "message"]), requestId: string }, ["error", "requestId"]) } },
};

const dataResponseSchema: JsonSchema = object({ data: { type: "object", description: "Respuesta específica del recurso; consulta el esquema de la operación." } }, ["data"]);

const publicOperations = new Set([
  "get /api/v1/health",
  "get /api/v1/ready",
  "get /api/v1/public/properties/:token",
  "post /api/v1/public/applications/by-link/:token/request-otp",
  "post /api/v1/public/applications/by-link/:token/submit",
  "post /api/v1/auth/agency/register",
  "post /api/v1/auth/tenant/register",
  "post /api/v1/auth/verify-email",
  "post /api/v1/auth/login",
  "post /api/v1/auth/forgot-password",
  "post /api/v1/auth/reset-password",
  "post /api/v1/analytics/events",
  "post /api/v1/team/invitations/accept",
]);

const idempotentOperations = new Map<string, number>([
  ["post /api/v1/billing/trial", 8],
  ["patch /api/v1/billing/fiscal-profile", 8],
  ["post /api/v1/billing/cancel", 8],
  ["post /api/v1/billing/reactivate", 8],
  ["patch /api/v1/billing/payment-method", 8],
  ["post /api/v1/agency/properties/:propertyId/publish", 16],
  ["post /api/v1/agency/properties/:propertyId/public-link/regenerate", 16],
  ["post /api/v1/agency/appointments", 16],
  ["post /api/v1/agency/team/invitations", 16],
]);

const queryParameters: Record<string, Array<Record<string, unknown>>> = {
  "get /api/v1/agency/properties": [
    { in: "query", name: "propertyId", schema: uuid },
    { in: "query", name: "search", schema: { type: "string", maxLength: 200 } },
    { in: "query", name: "state", schema: { type: "string", enum: ["draft", "published", "paused", "archived"] } },
    { in: "query", name: "hasRecentNewApplicants", schema: { type: "boolean", enum: [true] } },
  ],
  "get /api/v1/agency/properties/:propertyId/applications": [
    { in: "query", name: "search", schema: { type: "string", maxLength: 200 } },
    { in: "query", name: "status", schema: { type: "string", enum: ["new", "preselected", "selected", "final_tenant", "rejected", "withdrawn"] } },
    { in: "query", name: "documentState", schema: { type: "string", enum: ["complete", "missing", "not_requested"] } },
    { in: "query", name: "viewingState", schema: { type: "string", enum: ["none", "scheduled", "completed"] } },
    { in: "query", name: "responsibleUserId", schema: uuid },
    { in: "query", name: "responsibility", schema: { type: "string", enum: ["assigned", "unassigned"] } },
    { in: "query", name: "submittedFrom", schema: { type: "string", format: "date-time" } },
    { in: "query", name: "submittedTo", schema: { type: "string", format: "date-time" } },
    { in: "query", name: "sort", schema: { type: "string", enum: ["newest", "oldest", "income", "status", "next_viewing"], default: "newest" } },
  ],
  "get /api/v1/agency/appointments": [
    { in: "query", name: "state", schema: { type: "string", enum: ["scheduled", "completed", "cancelled", "no_show"] } },
    { in: "query", name: "scope", schema: { type: "string", enum: ["upcoming", "past"] } },
    { in: "query", name: "archived", schema: { type: "string", enum: ["true", "false"] } },
    { in: "query", name: "from", schema: { type: "string", format: "date-time" } },
    { in: "query", name: "to", schema: { type: "string", format: "date-time" } },
  ],
};

const paginatedOperations = [
  "get /api/v1/agency/properties",
  "get /api/v1/agency/properties/:propertyId/applications",
  "get /api/v1/agency/appointments",
  "get /api/v1/agency/team",
  "get /api/v1/agency/team/invitations",
];
for (const operation of paginatedOperations) {
  queryParameters[operation] = [
    ...(queryParameters[operation] ?? []),
    { in: "query", name: "page", schema: { type: "integer", minimum: 1, default: 1 } },
    { in: "query", name: "pageSize", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
  ];
}

function normalizePath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

/** Adds truthful bodies, path parameters and actual success codes to dynamically generated docs. */
export function enrichOpenApi(openapiObject: Record<string, unknown>): Record<string, unknown> {
  const components = (openapiObject.components ?? {}) as Record<string, unknown>;
  components.securitySchemes = {
    ...((components.securitySchemes ?? {}) as Record<string, unknown>),
    sessionCookie: { type: "apiKey", in: "cookie", name: "inquilink_session", description: "Sesión opaca y segura de Inquilink." },
    documentBearer: { type: "http", scheme: "bearer", bearerFormat: "document-access-token", description: "Acceso temporal emitido para un único documento y usuario." },
  };
  openapiObject.components = components;
  const paths = (openapiObject.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      const operationKey = `${method} ${normalizePath(path)}`;
      const documentation = docs[operationKey] ?? {};
      if (operationKey === "post /api/v1/analytics/events") {
        operation.description = "marketing_cta_clicked admite llamadas anónimas. Los eventos de agencia o inquilino requieren una sesión del tipo correspondiente; los eventos de facturación requieren administración.";
      }
      if (documentation.body) {
        operation.requestBody = { required: documentation.bodyRequired ?? true, content: { "application/json": { schema: documentation.body } } };
      }
      const successCodes = documentation.success ?? [200];
      operation.responses = Object.fromEntries([
        ...successCodes.map((status) => [String(status), status === 204
          ? { description: "Sin contenido" }
          : operationKey === "get /api/v1/documents/:documentId/content"
            ? { description: "Contenido privado del documento", headers: { "Cache-Control": { schema: { type: "string", example: "private, no-store" } } }, content: {
              "application/pdf": { schema: { type: "string", format: "binary" } },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
              "image/png": { schema: { type: "string", format: "binary" } },
            } }
            : { description: "Respuesta correcta", content: { "application/json": { schema: ["get /api/v1/health", "get /api/v1/ready"].includes(operationKey)
              ? object({ status: { type: "string", const: "ok" }, service: string, timestamp: { type: "string", format: "date-time" } }, ["status", "service", "timestamp"])
              : documentation.response ?? dataResponseSchema } } }]),
        ...(documentation.errors ?? (publicOperations.has(operationKey) ? [400, 404, 500] : [400, 401, 403, 404, 409, 500]))
          .map((status) => [String(status), errorResponse]),
      ]);
      const parameters = (operation.parameters ?? []) as Array<Record<string, unknown>>;
      for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).filter((name): name is string => Boolean(name))) {
        const existingPathParameter = parameters.find((parameter) => parameter.in === "path" && parameter.name === name);
        const schema = name.toLowerCase().endsWith("id") ? uuid : string;
        if (existingPathParameter) existingPathParameter.schema = schema;
        else parameters.push({ in: "path", name, required: true, schema });
      }
      for (const parameter of queryParameters[operationKey] ?? []) {
        if (!parameters.some((existing) => existing.in === parameter.in && existing.name === parameter.name)) parameters.push(parameter);
      }
      const minimumIdempotencyLength = idempotentOperations.get(operationKey);
      if (minimumIdempotencyLength) {
        const existingHeader = parameters.find((parameter) => parameter.in === "header" && String(parameter.name).toLowerCase() === "idempotency-key");
        const canonicalHeader = { in: "header", name: "Idempotency-Key", required: true, schema: { type: "string", minLength: minimumIdempotencyLength, maxLength: 200 }, description: "Reutiliza la misma clave únicamente al reintentar exactamente la misma operación." };
        if (existingHeader) Object.assign(existingHeader, canonicalHeader);
        else parameters.push(canonicalHeader);
      }
      if (parameters.length) operation.parameters = parameters;
      operation.security = ["post /api/v1/team/invitations/accept", "post /api/v1/analytics/events"].includes(operationKey) ? [{}, { sessionCookie: [] }]
        : publicOperations.has(operationKey) ? []
        : operationKey === "get /api/v1/documents/:documentId/content"
          ? [{ sessionCookie: [], documentBearer: [] }]
          : [{ sessionCookie: [] }];
    }
  }
  return openapiObject;
}
