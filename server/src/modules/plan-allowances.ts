import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { agencyInvitations, agencyMemberships, properties, subscriptions } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";

export type PlanCode = "particular" | "professional" | "inmobiliaria";

export const PLAN_DEFINITIONS = {
  particular: { name: "Particular", priceCents: 999, listingLimit: 2, accountLimit: 1 },
  professional: { name: "Profesional", priceCents: 4_999, listingLimit: 15, accountLimit: 3 },
  inmobiliaria: { name: "Inmobiliaria", priceCents: 9_999, listingLimit: 100, accountLimit: null },
} as const satisfies Record<PlanCode, {
  name: string;
  priceCents: number;
  listingLimit: number;
  accountLimit: number | null;
}>;

export const PRICES = {
  particular: PLAN_DEFINITIONS.particular.priceCents,
  professional: PLAN_DEFINITIONS.professional.priceCents,
  inmobiliaria: PLAN_DEFINITIONS.inmobiliaria.priceCents,
} as const;

export async function assertPlanSupportsCurrentUsage(db: Database, agencyId: string, plan: PlanCode, at: Date): Promise<void> {
  const definition = PLAN_DEFINITIONS[plan];
  const [listingRows, memberRows, invitationRows] = await Promise.all([
    db.select({ value: count() }).from(properties).where(and(eq(properties.agencyId, agencyId), inArray(properties.state, ["published", "paused"]))),
    db.select({ value: count() }).from(agencyMemberships).where(eq(agencyMemberships.agencyId, agencyId)),
    db.select({ value: count() }).from(agencyInvitations).where(and(
      eq(agencyInvitations.agencyId, agencyId), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt), gt(agencyInvitations.expiresAt, at),
    )),
  ]);
  const usage = {
    listings: Number(listingRows[0]?.value ?? 0),
    accounts: Number(memberRows[0]?.value ?? 0) + Number(invitationRows[0]?.value ?? 0),
  };
  if (usage.listings > definition.listingLimit || (definition.accountLimit !== null && usage.accounts > definition.accountLimit)) {
    throw new ApiError(
      409,
      "PLAN_DOWNGRADE_LIMIT_EXCEEDED",
      `El uso actual supera los límites del plan ${definition.name}. Archiva anuncios o reduce las cuentas e invitaciones pendientes antes de cambiar.`,
      { plan, usage, limits: { listings: definition.listingLimit, accounts: definition.accountLimit } },
    );
  }
}

async function effectivePlan(db: Database, agencyId: string): Promise<PlanCode> {
  const rows = await db.select({ plan: subscriptions.plan, state: subscriptions.state, pendingBillingOperationId: subscriptions.pendingBillingOperationId })
    .from(subscriptions).where(eq(subscriptions.agencyId, agencyId)).limit(1);
  const subscription = rows[0];
  if (!subscription) {
    throw new ApiError(409, "SUBSCRIPTION_REQUIRED", "Activa un plan para publicar anuncios o añadir personas al espacio.");
  }
  if (subscription.pendingBillingOperationId) {
    throw new ApiError(409, "BILLING_TRANSITION_IN_PROGRESS", "Hay una actualización de facturación en curso. Espera a que termine antes de aumentar el uso del plan.");
  }
  if (!["trialing", "active", "past_due"].includes(subscription.state)) {
    throw new ApiError(409, "SUBSCRIPTION_INACTIVE", "Tu suscripción no está activa. Revisa Facturación para continuar.");
  }
  return subscription.plan;
}

function listingLimitError(plan: PlanCode): ApiError {
  const definition = PLAN_DEFINITIONS[plan];
  return new ApiError(
    409,
    "PLAN_LISTING_LIMIT_REACHED",
    `Has alcanzado el límite de ${definition.listingLimit} anuncios simultáneos del plan ${definition.name}. Archiva un anuncio o cambia de plan para continuar.`,
    { plan, listingLimit: definition.listingLimit },
  );
}

function accountLimitError(plan: PlanCode): ApiError {
  const definition = PLAN_DEFINITIONS[plan];
  return new ApiError(
    409,
    "PLAN_ACCOUNT_LIMIT_REACHED",
    `Has alcanzado el límite de ${definition.accountLimit} cuentas del plan ${definition.name}. Elimina una invitación o una cuenta, o cambia de plan para continuar.`,
    { plan, accountLimit: definition.accountLimit },
  );
}

/** Must run after the caller has acquired the agency-first write lock. */
export async function enforceListingActivationAllowance(
  db: Database,
  agencyId: string,
  currentState: "draft" | "paused",
): Promise<void> {
  const plan = await effectivePlan(db, agencyId);
  const limit = PLAN_DEFINITIONS[plan].listingLimit;
  const rows = await db.select({ value: count() }).from(properties).where(and(
    eq(properties.agencyId, agencyId),
    inArray(properties.state, ["published", "paused"]),
  ));
  const used = Number(rows[0]?.value ?? 0);
  // A paused listing already occupies a slot. It can be reactivated at the
  // exact limit, but a downgraded workspace above the limit remains read-only.
  if (currentState === "paused" ? used > limit : used >= limit) throw listingLimitError(plan);
}

/** Must run after the caller has acquired the agency-first write lock. */
export async function enforceInvitationCreationAllowance(
  db: Database,
  agencyId: string,
  email: string,
  at: Date,
): Promise<void> {
  const plan = await effectivePlan(db, agencyId);
  const limit = PLAN_DEFINITIONS[plan].accountLimit;
  if (limit === null) return;
  const [memberRows, invitationRows, sameEmailRows] = await Promise.all([
    db.select({ value: count() }).from(agencyMemberships).where(eq(agencyMemberships.agencyId, agencyId)),
    db.select({ value: count() }).from(agencyInvitations).where(and(
      eq(agencyInvitations.agencyId, agencyId),
      isNull(agencyInvitations.acceptedAt),
      isNull(agencyInvitations.revokedAt),
      gt(agencyInvitations.expiresAt, at),
    )),
    db.select({ id: agencyInvitations.id }).from(agencyInvitations).where(and(
      eq(agencyInvitations.agencyId, agencyId),
      eq(agencyInvitations.email, email),
      isNull(agencyInvitations.acceptedAt),
      isNull(agencyInvitations.revokedAt),
      gt(agencyInvitations.expiresAt, at),
    )).limit(1),
  ]);
  const reserved = Number(memberRows[0]?.value ?? 0) + Number(invitationRows[0]?.value ?? 0);
  if (reserved > limit || (reserved === limit && !sameEmailRows[0])) throw accountLimitError(plan);
}

/** Must run after the caller has acquired the agency-first write lock. */
export async function enforceInvitationAcceptanceAllowance(db: Database, agencyId: string, at: Date): Promise<void> {
  const plan = await effectivePlan(db, agencyId);
  const limit = PLAN_DEFINITIONS[plan].accountLimit;
  if (limit === null) return;
  const [memberRows, invitationRows] = await Promise.all([
    db.select({ value: count() }).from(agencyMemberships).where(eq(agencyMemberships.agencyId, agencyId)),
    db.select({ value: count() }).from(agencyInvitations).where(and(
      eq(agencyInvitations.agencyId, agencyId),
      isNull(agencyInvitations.acceptedAt),
      isNull(agencyInvitations.revokedAt),
      gt(agencyInvitations.expiresAt, at),
    )),
  ]);
  const reserved = Number(memberRows[0]?.value ?? 0) + Number(invitationRows[0]?.value ?? 0);
  if (reserved > limit) throw accountLimitError(plan);
}
