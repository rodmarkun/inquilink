import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
};

export const userKind = pgEnum("user_kind", ["agency", "tenant"]);
export const agencyRole = pgEnum("agency_role", ["admin", "collaborator"]);
export const tokenKind = pgEnum("token_kind", ["verify_email", "reset_password"]);
export const propertyState = pgEnum("property_state", ["draft", "published", "paused", "archived"]);
export const applicationStatus = pgEnum("application_status", ["new", "preselected", "selected", "rejected", "withdrawn", "final_tenant"]);
export const documentState = pgEnum("document_state", ["complete", "missing", "not_requested"]);
export const appointmentState = pgEnum("appointment_state", ["scheduled", "completed", "cancelled", "no_show"]);
export const planCode = pgEnum("plan_code", ["particular", "professional", "inmobiliaria"]);
export const subscriptionState = pgEnum("subscription_state", ["incomplete", "trialing", "active", "past_due", "cancelled"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  kind: userKind("kind").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  termsVersion: varchar("terms_version", { length: 80 }),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  accountState: varchar("account_state", { length: 30 }).notNull().default("active"),
  closureRequestedAt: timestamp("closure_requested_at", { withTimezone: true }),
  accountPurgeAttempts: integer("account_purge_attempts").notNull().default(0),
  accountPurgeNextAttemptAt: timestamp("account_purge_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  accountPurgeClaimedAt: timestamp("account_purge_claimed_at", { withTimezone: true }),
  accountPurgeClaimToken: varchar("account_purge_claim_token", { length: 100 }),
  ...timestamps,
}, (table) => [
  uniqueIndex("users_email_kind_unique").on(table.email, table.kind),
  check("users_account_closure_state_check", sql`(${table.accountState} = 'active' and ${table.closureRequestedAt} is null) or (${table.accountState} = 'closure_requested' and ${table.closureRequestedAt} is not null)`),
  index("users_account_purge_due_idx").on(table.accountState, table.accountPurgeNextAttemptAt, table.createdAt, table.id),
  check("users_account_purge_claim_check", sql`(${table.accountPurgeClaimedAt} is null) = (${table.accountPurgeClaimToken} is null)`),
]);

export const agencies = pgTable("agencies", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  fiscalId: varchar("fiscal_id", { length: 20 }),
  billingName: varchar("billing_name", { length: 200 }),
  billingAddress: text("billing_address"),
  phone: varchar("phone", { length: 40 }),
  contactEmail: varchar("contact_email", { length: 320 }),
  logoUrl: text("logo_url"),
  timezone: varchar("timezone", { length: 50 }).notNull().default("Europe/Madrid"),
  accountState: varchar("account_state", { length: 30 }).notNull().default("active"),
  closureRequestedAt: timestamp("closure_requested_at", { withTimezone: true }),
  accountPurgeAttempts: integer("account_purge_attempts").notNull().default(0),
  accountPurgeNextAttemptAt: timestamp("account_purge_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  accountPurgeClaimedAt: timestamp("account_purge_claimed_at", { withTimezone: true }),
  accountPurgeClaimToken: varchar("account_purge_claim_token", { length: 100 }),
  ...timestamps,
}, (table) => [
  check("agencies_account_closure_state_check", sql`(${table.accountState} = 'active' and ${table.closureRequestedAt} is null) or (${table.accountState} = 'closure_requested' and ${table.closureRequestedAt} is not null)`),
  index("agencies_account_purge_due_idx").on(table.accountState, table.accountPurgeNextAttemptAt, table.createdAt, table.id),
  check("agencies_account_purge_claim_check", sql`(${table.accountPurgeClaimedAt} is null) = (${table.accountPurgeClaimToken} is null)`),
]);

export const agencyMemberships = pgTable("agency_memberships", {
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: agencyRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.agencyId, table.userId] }),
  uniqueIndex("membership_one_agency_per_user").on(table.userId),
]);

export const agencyInvitations = pgTable("agency_invitations", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: agencyRole("role").notNull().default("collaborator"),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  invitedByUserId: text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  acceptedByUserId: text("accepted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  lastRequestKeyHash: varchar("last_request_key_hash", { length: 64 }),
}, (table) => [
  uniqueIndex("agency_invitations_token_hash_unique").on(table.tokenHash),
  uniqueIndex("agency_invitations_agency_email_unique").on(table.agencyId, table.email),
  index("agency_invitations_agency_idx").on(table.agencyId),
  uniqueIndex("agency_invitations_request_key_unique").on(table.agencyId, table.lastRequestKeyHash),
  check("agency_invitations_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  check("agency_invitations_terminal_state_check", sql`not (${table.acceptedAt} is not null and ${table.revokedAt} is not null)`),
  check("agency_invitations_hash_lengths_check", sql`length(${table.tokenHash}) = 64 and (${table.lastRequestKeyHash} is null or length(${table.lastRequestKeyHash}) = 64)`),
]);

/** Immutable idempotency history; superseding an invitation never erases old keys. */
export const agencyInvitationOperations = pgTable("agency_invitation_operations", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  idempotencyKeyHash: varchar("idempotency_key_hash", { length: 64 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  invitationId: text("invitation_id").notNull(),
  response: jsonb("response").$type<{ email: string; role: "admin" | "collaborator"; expiresAt: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("agency_invitation_operations_key_unique").on(table.agencyId, table.idempotencyKeyHash),
  index("agency_invitation_operations_invitation_idx").on(table.invitationId),
  check("agency_invitation_operations_hash_check", sql`length(${table.idempotencyKeyHash}) = 64 and length(${table.requestFingerprint}) = 64`),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
  index("sessions_user_idx").on(table.userId),
  index("sessions_expiry_idx").on(table.expiresAt, table.id),
]);

export const oneTimeTokens = pgTable("one_time_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: tokenKind("kind").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  returnPath: text("return_path"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("one_time_tokens_hash_unique").on(table.tokenHash),
  index("one_time_tokens_expiry_idx").on(table.expiresAt, table.id),
  index("one_time_tokens_used_idx").on(table.usedAt, table.id),
]);

/** Hashed, fixed-window authentication abuse counters shared by every API replica. */
export const authRateLimits = pgTable("auth_rate_limits", {
  keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
  scope: varchar("scope", { length: 60 }).notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [index("auth_rate_limits_window_idx").on(table.windowStartedAt)]);

export const properties = pgTable("properties", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  internalReference: varchar("internal_reference", { length: 100 }).notNull(),
  title: varchar("title", { length: 240 }).notNull(),
  address: text("address"),
  city: varchar("city", { length: 120 }).notNull(),
  province: varchar("province", { length: 120 }).notNull(),
  postalCode: varchar("postal_code", { length: 20 }),
  propertyType: varchar("property_type", { length: 80 }),
  bedrooms: integer("bedrooms"),
  bathrooms: integer("bathrooms"),
  floorAreaSqm: integer("floor_area_sqm"),
  availableFrom: date("available_from"),
  description: text("description"),
  publicLocation: varchar("public_location", { length: 240 }),
  coverImageUrl: text("cover_image_url"),
  galleryUrls: jsonb("gallery_urls").$type<string[]>().notNull().default([]),
  requestedDocumentCategories: jsonb("requested_document_categories").$type<string[]>().notNull().default([]),
  monthlyRentCents: integer("monthly_rent_cents").notNull(),
  state: propertyState("state").notNull().default("draft"),
  publicLinkTokenHash: varchar("public_link_token_hash", { length: 64 }),
  publicLinkTokenCiphertext: text("public_link_token_ciphertext"),
  publicLinkIssuedAt: timestamp("public_link_issued_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  lastMutationKeyHash: varchar("last_mutation_key_hash", { length: 64 }),
  lastMutationOperation: varchar("last_mutation_operation", { length: 40 }),
  lastMutationVersion: integer("last_mutation_version"),
  ...timestamps,
}, (table) => [
  uniqueIndex("properties_agency_reference_unique").on(table.agencyId, table.internalReference),
  uniqueIndex("properties_public_link_hash_unique").on(table.publicLinkTokenHash),
  uniqueIndex("properties_id_agency_unique").on(table.id, table.agencyId),
  index("properties_agency_idx").on(table.agencyId),
  foreignKey({ name: "properties_responsible_membership_fk", columns: [table.agencyId, table.responsibleUserId], foreignColumns: [agencyMemberships.agencyId, agencyMemberships.userId] }).onDelete("restrict"),
]);

/** Passwordless, property-scoped verification challenges for guest applications. */
export const guestApplicationOtps = pgTable("guest_application_otps", {
  id: text("id").primaryKey(),
  emailNormalized: varchar("email_normalized", { length: 320 }).notNull(),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("guest_application_otps_lookup_idx").on(table.propertyId, table.emailNormalized, table.createdAt),
  index("guest_application_otps_expiry_idx").on(table.expiresAt, table.id),
  check("guest_application_otps_attempts_check", sql`${table.attempts} >= 0 and ${table.attempts} <= 5`),
  check("guest_application_otps_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  check("guest_application_otps_hash_check", sql`length(${table.codeHash}) = 64`),
]);

export const applications = pgTable("applications", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  tenantUserId: text("tenant_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "set null" }),
  status: applicationStatus("status").notNull().default("new"),
  documentState: documentState("document_state").notNull().default("not_requested"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  phone: varchar("phone", { length: 16 }),
  normalizedPhone: varchar("normalized_phone", { length: 15 }),
  normalizedEmail: varchar("normalized_email", { length: 320 }),
  duplicatePhoneFlaggedAt: timestamp("duplicate_phone_flagged_at", { withTimezone: true }),
  individualNetMonthlyIncomeCents: integer("individual_net_monthly_income_cents"),
  householdNetMonthlyIncomeCents: integer("household_net_monthly_income_cents"),
  adultOccupants: integer("adult_occupants"),
  minorOccupants: integer("minor_occupants"),
  intendedMoveInDate: date("intended_move_in_date"),
  applicationDataPromotedAt: timestamp("application_data_promoted_at", { withTimezone: true }),
  adultProfiles: jsonb("adult_profiles").$type<Array<{
    id: string;
    isPrimary: boolean;
    fullName: string;
    email: string | null;
    phone: string | null;
    employmentStatus: string;
    employerOrActivity: string;
    contractType: string;
    netMonthlyIncomeCents: number;
  }>>().notNull().default([]),
  draftData: jsonb("draft_data").$type<Record<string, unknown>>().notNull().default({}),
  consentVersion: varchar("consent_version", { length: 100 }),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  sourceLinkTokenHash: varchar("source_link_token_hash", { length: 64 }),
  submissionKeyHash: varchar("submission_key_hash", { length: 64 }),
  retentionState: varchar("retention_state", { length: 20 }).notNull().default("active"),
  retentionClaimedAt: timestamp("retention_claimed_at", { withTimezone: true }),
  retentionClaimToken: varchar("retention_claim_token", { length: 100 }),
  retentionAttempts: integer("retention_attempts").notNull().default(0),
  retentionNextAttemptAt: timestamp("retention_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  ...timestamps,
}, (table) => [
  uniqueIndex("applications_property_tenant_unique").on(table.propertyId, table.tenantUserId),
  uniqueIndex("applications_id_agency_unique").on(table.id, table.agencyId),
  uniqueIndex("applications_id_agency_tenant_unique").on(table.id, table.agencyId, table.tenantUserId),
  uniqueIndex("applications_id_agency_property_unique").on(table.id, table.agencyId, table.propertyId),
  uniqueIndex("applications_graph_unique").on(table.id, table.agencyId, table.propertyId, table.tenantUserId),
  index("applications_agency_property_idx").on(table.agencyId, table.propertyId),
  index("applications_income_sort_idx").on(table.agencyId, table.propertyId, table.householdNetMonthlyIncomeCents.desc().nullsLast(), table.submittedAt.desc(), table.id.asc()),
  index("applications_phone_search_idx").using("btree", table.phone.asc().op("varchar_pattern_ops")),
  index("applications_duplicate_phone_idx").on(table.propertyId, table.normalizedPhone),
  index("applications_duplicate_email_idx").on(table.propertyId, table.normalizedEmail),
  index("applications_tenant_idx").on(table.tenantUserId),
  uniqueIndex("applications_submission_key_unique").on(table.submissionKeyHash),
  foreignKey({ name: "applications_property_agency_fk", columns: [table.propertyId, table.agencyId], foreignColumns: [properties.id, properties.agencyId] }).onDelete("cascade"),
  foreignKey({ name: "applications_responsible_membership_fk", columns: [table.agencyId, table.responsibleUserId], foreignColumns: [agencyMemberships.agencyId, agencyMemberships.userId] }).onDelete("restrict"),
  index("applications_retention_due_idx").on(table.retentionState, table.retentionNextAttemptAt, table.createdAt, table.id),
  check("applications_retention_claim_check", sql`(${table.retentionClaimedAt} is null) = (${table.retentionClaimToken} is null)`),
]);

export const applicationStatusHistory = pgTable("application_status_history", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  fromStatus: applicationStatus("from_status").notNull(),
  toStatus: applicationStatus("to_status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("status_history_application_idx").on(table.applicationId),
  foreignKey({ name: "status_history_application_agency_fk", columns: [table.applicationId, table.agencyId], foreignColumns: [applications.id, applications.agencyId] }).onDelete("cascade"),
]);

export const applicationDocuments = pgTable("application_documents", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  tenantUserId: text("tenant_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  adultProfileId: varchar("adult_profile_id", { length: 50 }).notNull().default("primary"),
  category: varchar("category", { length: 50 }).notNull(),
  storageKey: text("storage_key").notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  contentType: varchar("content_type", { length: 100 }).notNull(),
  byteSize: integer("byte_size").notNull(),
  malwareScanState: varchar("malware_scan_state", { length: 30 }).notNull().default("pending"),
  deletionState: varchar("deletion_state", { length: 20 }).notNull().default("active"),
  deletionAttempts: integer("deletion_attempts").notNull().default(0),
  deletionNextAttemptAt: timestamp("deletion_next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  deletionClaimedAt: timestamp("deletion_claimed_at", { withTimezone: true }),
  deletionClaimToken: varchar("deletion_claim_token", { length: 100 }),
  deleteRequestedAt: timestamp("delete_requested_at", { withTimezone: true }),
  lastDeleteErrorCode: varchar("last_delete_error_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("documents_application_idx").on(table.applicationId),
  index("documents_deletion_due_idx").on(table.deletionState, table.deletionNextAttemptAt, table.createdAt, table.id),
  check("documents_deletion_claim_check", sql`(${table.deletionClaimedAt} is null) = (${table.deletionClaimToken} is null)`),
  foreignKey({ name: "documents_application_graph_fk", columns: [table.applicationId, table.agencyId, table.tenantUserId], foreignColumns: [applications.id, applications.agencyId, applications.tenantUserId] }).onDelete("cascade"),
]);

/** Durable references for blobs written before a failed metadata insert. */
export const documentStorageCleanup = pgTable("document_storage_cleanup", {
  id: text("id").primaryKey(),
  storageKey: text("storage_key").notNull(),
  // Opaque provenance only: cleanup must outlive agency/application deletion.
  agencyId: text("agency_id").notNull(),
  applicationId: text("application_id").notNull(),
  reason: varchar("reason", { length: 80 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimToken: varchar("claim_token", { length: 100 }),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("document_storage_cleanup_key_unique").on(table.storageKey),
  index("document_storage_cleanup_created_idx").on(table.createdAt),
  index("document_storage_cleanup_due_idx").on(table.nextAttemptAt, table.createdAt, table.id),
  check("document_storage_cleanup_claim_check", sql`(${table.claimedAt} is null) = (${table.claimToken} is null)`),
]);

export const applicationNotes = pgTable("application_notes", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("application_notes_agency_idx").on(table.agencyId),
  index("application_notes_application_idx").on(table.applicationId),
  foreignKey({ name: "application_notes_application_agency_fk", columns: [table.applicationId, table.agencyId], foreignColumns: [applications.id, applications.agencyId] }).onDelete("cascade"),
]);

export const appointments = pgTable("appointments", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
  applicationId: text("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  responsibleUserId: text("responsible_user_id").references(() => users.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  state: appointmentState("state").notNull().default("scheduled"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  instructions: text("instructions"),
  internalNote: text("internal_note"),
  idempotencyKeyHash: varchar("idempotency_key_hash", { length: 64 }),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }),
  ...timestamps,
}, (table) => [
  index("appointments_agency_starts_idx").on(table.agencyId, table.startsAt),
  index("appointments_application_idx").on(table.applicationId),
  uniqueIndex("appointments_agency_idempotency_unique").on(table.agencyId, table.idempotencyKeyHash),
  foreignKey({ name: "appointments_application_graph_fk", columns: [table.applicationId, table.agencyId, table.propertyId], foreignColumns: [applications.id, applications.agencyId, applications.propertyId] }).onDelete("cascade"),
  foreignKey({ name: "appointments_responsible_membership_fk", columns: [table.agencyId, table.responsibleUserId], foreignColumns: [agencyMemberships.agencyId, agencyMemberships.userId] }).onDelete("restrict"),
]);

export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  plan: planCode("plan").notNull(),
  state: subscriptionState("state").notNull().default("incomplete"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEndsAt: timestamp("current_period_ends_at", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  providerCustomerRef: text("provider_customer_ref"),
  providerSubscriptionRef: text("provider_subscription_ref"),
  paymentMethodDisplay: varchar("payment_method_display", { length: 80 }),
  pendingBillingOperationId: text("pending_billing_operation_id"),
  billingLastSyncedAt: timestamp("billing_last_synced_at", { withTimezone: true }),
  billingNextSyncAt: timestamp("billing_next_sync_at", { withTimezone: true }),
  billingSyncAttempts: integer("billing_sync_attempts").notNull().default(0),
  billingSyncLastErrorCode: varchar("billing_sync_last_error_code", { length: 80 }),
  billingSyncClaimedAt: timestamp("billing_sync_claimed_at", { withTimezone: true }),
  billingSyncClaimToken: varchar("billing_sync_claim_token", { length: 100 }),
  ...timestamps,
}, (table) => [
  uniqueIndex("subscriptions_agency_unique").on(table.agencyId),
  uniqueIndex("subscriptions_id_agency_unique").on(table.id, table.agencyId),
  foreignKey({ name: "subscriptions_pending_billing_operation_agency_fk", columns: [table.pendingBillingOperationId, table.agencyId], foreignColumns: [billingOperations.id, billingOperations.agencyId] }).onDelete("restrict"),
  index("subscriptions_billing_sync_due_idx").on(table.billingNextSyncAt, table.id),
  check("subscriptions_billing_sync_attempts_check", sql`${table.billingSyncAttempts} >= 0`),
  check("subscriptions_billing_sync_claim_check", sql`(${table.billingSyncClaimedAt} is null) = (${table.billingSyncClaimToken} is null)`),
]);

export const invoices = pgTable("invoices", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  subscriptionId: text("subscription_id").notNull(),
  providerInvoiceRef: text("provider_invoice_ref").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  status: varchar("status", { length: 30 }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  hostedUrl: text("hosted_url"),
}, (table) => [
  index("invoices_agency_idx").on(table.agencyId),
  uniqueIndex("invoices_agency_provider_ref_unique").on(table.agencyId, table.providerInvoiceRef),
  foreignKey({ name: "invoices_subscription_agency_fk", columns: [table.subscriptionId, table.agencyId], foreignColumns: [subscriptions.id, subscriptions.agencyId] }).onDelete("cascade"),
  check("invoices_amount_check", sql`${table.amountCents} >= 0`),
  check("invoices_status_check", sql`${table.status} in ('open', 'paid', 'past_due', 'void', 'uncollectible')`),
]);

export const billingOperations = pgTable("billing_operations", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  operation: varchar("operation", { length: 40 }).notNull(),
  idempotencyKeyHash: varchar("idempotency_key_hash", { length: 64 }).notNull(),
  requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
  state: varchar("state", { length: 20 }).notNull().default("pending"),
  response: jsonb("response").$type<Record<string, unknown>>(),
  providerAppliedAt: timestamp("provider_applied_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("billing_operations_idempotency_unique").on(table.agencyId, table.operation, table.idempotencyKeyHash),
  uniqueIndex("billing_operations_id_agency_unique").on(table.id, table.agencyId),
  index("billing_operations_agency_idx").on(table.agencyId),
  check("billing_operations_operation_check", sql`${table.operation} in ('create_trial', 'update_payment_method', 'update_fiscal_profile', 'change_plan', 'cancel', 'reactivate')`),
  check("billing_operations_state_check", sql`${table.state} in ('pending', 'unknown', 'completed', 'failed', 'abandoned')`),
  check("billing_operations_attempts_check", sql`${table.attempts} >= 0`),
  check("billing_operations_hash_lengths_check", sql`length(${table.idempotencyKeyHash}) = 64 and length(${table.requestFingerprint}) = 64`),
  check("billing_operations_completion_check", sql`${table.state} <> 'completed' or ${table.response} is not null`),
]);

/** External billing cleanup survives deletion of the local agency graph. */
export const agencyClosureCleanup = pgTable("agency_closure_cleanup", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").notNull(),
  providerSubscriptionRef: text("provider_subscription_ref"),
  state: varchar("state", { length: 30 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimToken: varchar("claim_token", { length: 100 }),
  providerAppliedAt: timestamp("provider_applied_at", { withTimezone: true }),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("agency_closure_cleanup_agency_unique").on(table.agencyId),
  index("agency_closure_cleanup_due_idx").on(table.state, table.nextAttemptAt),
  check("agency_closure_cleanup_state_check", sql`${table.state} in ('pending', 'processing', 'provider_applied', 'ready_for_purge', 'completed', 'failed')`),
  check("agency_closure_cleanup_attempts_check", sql`${table.attempts} >= 0`),
  check("agency_closure_cleanup_provider_state_check", sql`(${table.state} <> 'provider_applied' or ${table.providerAppliedAt} is not null) and (${table.state} not in ('ready_for_purge', 'completed') or ${table.providerSubscriptionRef} is null)`),
  check("agency_closure_cleanup_claim_check", sql`(${table.state} = 'processing') = (${table.claimedAt} is not null and ${table.claimToken} is not null)`),
]);

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").references(() => agencies.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  subjectType: varchar("subject_type", { length: 80 }).notNull(),
  subjectId: text("subject_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("audit_agency_created_idx").on(table.agencyId, table.createdAt),
  index("audit_application_subject_idx").on(table.agencyId, table.subjectType, table.subjectId, table.createdAt),
  index("audit_application_metadata_idx").on(table.agencyId, sql`(${table.metadata}->>'applicationId')`, table.createdAt),
]);

export const emailOutbox = pgTable("email_outbox", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  agencyId: text("agency_id"),
  subjectType: varchar("subject_type", { length: 40 }),
  subjectId: text("subject_id"),
  recipient: varchar("recipient", { length: 320 }).notNull(),
  template: varchar("template", { length: 80 }).notNull(),
  locale: varchar("locale", { length: 10 }).notNull().default("es-ES"),
  variables: jsonb("variables").$type<Record<string, string>>().notNull().default({}),
  dedupeKey: varchar("dedupe_key", { length: 160 }),
  state: varchar("state", { length: 20 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimToken: varchar("claim_token", { length: 100 }),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '7 days'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (table) => [
  uniqueIndex("email_outbox_dedupe_key_unique").on(table.dedupeKey),
  index("email_outbox_delivery_idx").on(table.state, table.availableAt),
  index("email_outbox_user_idx").on(table.userId),
  index("email_outbox_agency_idx").on(table.agencyId),
  index("email_outbox_subject_idx").on(table.subjectType, table.subjectId),
  check("email_outbox_template_check", sql`${table.template} in ('new_applicant', 'viewing_reminder', 'trial_ending', 'payment_failure', 'team_invitation', 'verify_email', 'reset_password', 'guest_application_otp', 'application_received', 'viewing_created', 'viewing_rescheduled', 'viewing_cancelled')`),
  check("email_outbox_state_check", sql`${table.state} in ('pending', 'processing', 'sent', 'failed', 'expired')`),
  check("email_outbox_attempts_check", sql`${table.attempts} >= 0`),
  check("email_outbox_delivery_window_check", sql`${table.expiresAt} > ${table.createdAt}`),
  check("email_outbox_claim_check", sql`(${table.state} = 'processing') = (${table.claimedAt} is not null and ${table.claimToken} is not null)`),
  check("email_outbox_sent_check", sql`${table.state} <> 'sent' or ${table.sentAt} is not null`),
  check("email_outbox_terminal_scrub_check", sql`${table.state} not in ('sent', 'failed', 'expired') or (${table.recipient} = 'eliminado@inquilink.invalid' and ${table.variables} = '{}'::jsonb)`),
  check("email_outbox_subject_check", sql`(${table.subjectType} is null and ${table.subjectId} is null) or (${table.subjectType} in ('team_invitation', 'appointment', 'subscription') and ${table.subjectId} is not null)`),
]);

/**
 * Analytics has intentionally fixed scalar dimensions rather than a JSON payload.
 * This prevents callers from storing free text or applicant PII by construction.
 */
export const analyticsEvents = pgTable("analytics_events", {
  id: text("id").primaryKey(),
  agencyId: text("agency_id").references(() => agencies.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "cascade" }),
  eventName: varchar("event_name", { length: 80 }).notNull(),
  placement: varchar("placement", { length: 30 }),
  plan: planCode("plan"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
}, (table) => [
  index("analytics_events_agency_time_idx").on(table.agencyId, table.occurredAt),
  index("analytics_events_name_time_idx").on(table.eventName, table.occurredAt),
  check("analytics_events_shape_check", sql`
    (${table.eventName} = 'marketing_cta_clicked' and ${table.agencyId} is null and ${table.actorUserId} is null and ${table.placement} in ('hero', 'pricing', 'final') and ${table.plan} is null)
    or (${table.eventName} = 'trial_activated' and ${table.agencyId} is not null and ${table.actorUserId} is not null and ${table.placement} is null and ${table.plan} is not null)
    or (${table.eventName} in ('agency_registration_completed', 'first_property_published', 'public_link_copied', 'first_applicant_reviewed', 'whatsapp_contact_initiated', 'viewing_scheduled', 'trial_converted_to_paid') and ${table.agencyId} is not null and ${table.actorUserId} is not null and ${table.placement} is null and ${table.plan} is null)
    or (${table.eventName} in ('tenant_account_created', 'application_started', 'application_completed') and ${table.agencyId} is null and ${table.actorUserId} is not null and ${table.placement} is null and ${table.plan} is null)
  `),
]);

// Avoid floating point values for money. `numeric` is intentionally reserved for
// applicant income once the application module validates and exposes that domain.
export const _numericTypeMarker = numeric;
