import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/session.js";
import { agencyClosureCleanup, billingOperations, invoices, subscriptions } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { hashSecret, newId } from "../../lib/ids.js";
import type { AppDependencies } from "../../types.js";
import { billingProviderOperationKey, BillingProviderError } from "./provider.js";
import { lockActiveAgency, lockAgencyForSystem } from "../agency-lock.js";
import { PLAN_DEFINITIONS, PRICES } from "../plan-allowances.js";

export { PRICES } from "../plan-allowances.js";
const IDEMPOTENCY_TIMEOUT_MS = 5 * 60_000;

function safeSubscription<T extends typeof subscriptions.$inferSelect>(subscription: T) {
  const {
    providerCustomerRef: _customerRef, providerSubscriptionRef: _subscriptionRef, pendingBillingOperationId: _pendingOperationId,
    billingLastSyncedAt: _billingLastSyncedAt, billingNextSyncAt: _billingNextSyncAt, billingSyncAttempts: _billingSyncAttempts,
    billingSyncLastErrorCode: _billingSyncLastErrorCode, billingSyncClaimedAt: _billingSyncClaimedAt, billingSyncClaimToken: _billingSyncClaimToken,
    ...safe
  } = subscription;
  return safe;
}

function idempotencyKey(request: FastifyRequest): string {
  return z.string().trim().min(8).max(200).regex(/^[\x21-\x7E]+$/).parse(request.headers["idempotency-key"]);
}

function paymentProviderApiError(error: unknown): ApiError {
  if (error instanceof BillingProviderError && error.kind === "declined") {
    return new ApiError(422, "PAYMENT_METHOD_REJECTED", "No se ha podido validar el método de pago.");
  }
  return new ApiError(503, "BILLING_PROVIDER_UNAVAILABLE", "El proveedor de facturación no está disponible. Reintenta con la misma clave.");
}

function operationErrorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "BILLING_OPERATION_FAILED";
}

async function claimOperation(
  deps: AppDependencies,
  input: { agencyId: string; operation: "create_trial" | "update_payment_method" | "cancel" | "reactivate"; key: string; fingerprint: string; now: Date },
): Promise<{ id: string; replay: Record<string, unknown> | null }> {
  const keyHash = hashSecret(input.key);
  const id = newId();
  const inserted = await deps.db.insert(billingOperations).values({
    id, agencyId: input.agencyId, operation: input.operation,
    idempotencyKeyHash: keyHash, requestFingerprint: input.fingerprint,
    state: "pending", createdAt: input.now, updatedAt: input.now,
  }).onConflictDoNothing().returning({ id: billingOperations.id });
  if (inserted[0]) return { id, replay: null };

  const rows = await deps.db.select().from(billingOperations).where(and(
    eq(billingOperations.agencyId, input.agencyId),
    eq(billingOperations.operation, input.operation),
    eq(billingOperations.idempotencyKeyHash, keyHash),
  )).limit(1);
  const existing = rows[0];
  if (!existing || existing.requestFingerprint !== input.fingerprint) {
    throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Esta clave de idempotencia ya se utilizó con otros datos.");
  }
  if (existing.state === "completed" && existing.response) return { id: existing.id, replay: existing.response };
  if (existing.state === "pending" && !existing.providerAppliedAt && existing.updatedAt.getTime() > input.now.getTime() - IDEMPOTENCY_TIMEOUT_MS) {
    throw new ApiError(409, "BILLING_OPERATION_IN_PROGRESS", "La operación de facturación sigue en curso. Vuelve a intentarlo en unos segundos.");
  }
  const reclaimed = await deps.db.update(billingOperations).set({ state: "pending", lastErrorCode: null, updatedAt: input.now })
    .where(and(eq(billingOperations.id, existing.id), eq(billingOperations.updatedAt, existing.updatedAt)))
    .returning({ id: billingOperations.id });
  if (!reclaimed[0]) throw new ApiError(409, "BILLING_OPERATION_IN_PROGRESS", "La operación de facturación sigue en curso. Vuelve a intentarlo en unos segundos.");
  return { id: existing.id, replay: null };
}

async function failOperation(deps: AppDependencies, operationId: string, at: Date, errorCode = "BILLING_OPERATION_FAILED"): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const rows = await tx.select().from(billingOperations).where(eq(billingOperations.id, operationId)).for("update").limit(1);
    const operation = rows[0];
    if (!operation || operation.state === "completed") return;
    if (operation.state === "unknown") return;
    if (operation.providerAppliedAt) {
      await tx.update(billingOperations).set({ lastErrorCode: errorCode, updatedAt: at }).where(eq(billingOperations.id, operationId));
      return;
    }
    await tx.update(billingOperations).set({ state: "failed", lastErrorCode: errorCode, updatedAt: at }).where(eq(billingOperations.id, operationId));
    if (operation.operation === "create_trial") {
      await tx.delete(subscriptions).where(and(eq(subscriptions.pendingBillingOperationId, operationId), eq(subscriptions.state, "incomplete")));
    } else {
      await tx.update(subscriptions).set({ pendingBillingOperationId: null, updatedAt: at }).where(eq(subscriptions.pendingBillingOperationId, operationId));
    }
  });
}

async function markOperationUnknown(deps: AppDependencies, operationId: string, at: Date): Promise<void> {
  await deps.db.update(billingOperations).set({
    state: "unknown",
    lastErrorCode: "BILLING_PROVIDER_RESULT_UNKNOWN",
    updatedAt: at,
  }).where(and(eq(billingOperations.id, operationId), eq(billingOperations.state, "pending")));
}

async function reconcileRenewalState(
  deps: AppDependencies,
  input: {
    agencyId: string;
    userId: string;
    operationId: string;
    cancelAtPeriodEnd: boolean;
    changedAt: Date;
  },
): Promise<Record<string, unknown>> {
  const reservation = await deps.db.transaction(async (tx) => {
    await lockActiveAgency(tx as unknown as AppDependencies["db"], input.agencyId, { userId: input.userId, requiredRole: "admin" });
    const operationRows = await tx.select().from(billingOperations).where(eq(billingOperations.id, input.operationId)).limit(1);
    const operation = operationRows[0];
    if (!operation) throw new ApiError(409, "BILLING_OPERATION_CHANGED", "La operación de facturación ha cambiado. Vuelve a consultar su estado.");
    if (operation.state === "completed" && operation.response) return { completed: operation.response } as const;
    const rows = await tx.select().from(subscriptions).where(eq(subscriptions.agencyId, input.agencyId)).limit(1);
    const subscription = rows[0];
    if (!subscription) {
      throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", input.cancelAtPeriodEnd
        ? "No hay ninguna suscripción activa."
        : "No hay ninguna suscripción para reactivar.");
    }
    if (!input.cancelAtPeriodEnd && subscription.state === "cancelled") {
      throw new ApiError(409, "SUBSCRIPTION_CANNOT_REACTIVATE", "Esta suscripción ya ha finalizado y no se puede reactivar.");
    }
    const payload = input.cancelAtPeriodEnd
      ? { data: { cancelAtPeriodEnd: true, effectiveAt: subscription.currentPeriodEndsAt } }
      : { data: { cancelAtPeriodEnd: false } };
    if (subscription.pendingBillingOperationId && subscription.pendingBillingOperationId !== input.operationId) {
      throw new ApiError(409, "BILLING_TRANSITION_IN_PROGRESS", "Hay otra actualización de la suscripción en curso. Espera a que termine antes de volver a intentarlo.");
    }
    if (subscription.cancelAtPeriodEnd === input.cancelAtPeriodEnd) {
      if (subscription.pendingBillingOperationId === input.operationId) {
        await tx.update(subscriptions).set({ pendingBillingOperationId: null, updatedAt: input.changedAt }).where(eq(subscriptions.id, subscription.id));
      }
      await tx.update(billingOperations).set({ state: "completed", response: payload, lastErrorCode: null, updatedAt: input.changedAt })
        .where(eq(billingOperations.id, input.operationId));
      return { completed: payload } as const;
    }
    if (!subscription.pendingBillingOperationId) {
      const reserved = await tx.update(subscriptions).set({
        pendingBillingOperationId: input.operationId, billingSyncClaimedAt: null, billingSyncClaimToken: null, updatedAt: input.changedAt,
      })
        .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.updatedAt, subscription.updatedAt)))
        .returning({ id: subscriptions.id });
      if (!reserved[0]) throw new ApiError(409, "SUBSCRIPTION_CHANGED", "La suscripción ha cambiado. Actualiza la vista antes de volver a intentarlo.");
    }
    return {
      completed: null,
      subscriptionId: subscription.id,
      providerSubscriptionRef: subscription.providerSubscriptionRef,
      providerApplied: operation.providerAppliedAt !== null,
      payload,
    } as const;
  });
  if (reservation.completed) return reservation.completed;

  if (!reservation.providerApplied) {
    await deps.db.update(billingOperations).set({
      attempts: sql`${billingOperations.attempts} + 1`, lastErrorCode: null, updatedAt: input.changedAt,
    }).where(and(eq(billingOperations.id, input.operationId), eq(billingOperations.state, "pending")));
    if (reservation.providerSubscriptionRef) {
      try {
        const providerKey = billingProviderOperationKey(input.operationId);
        if (input.cancelAtPeriodEnd) await deps.billingProvider.cancel({ subscriptionRef: reservation.providerSubscriptionRef, idempotencyKey: providerKey });
        else await deps.billingProvider.reactivate({ subscriptionRef: reservation.providerSubscriptionRef, idempotencyKey: providerKey });
      } catch (error) {
        if (error instanceof BillingProviderError && error.kind === "declined") {
          throw new ApiError(422, "BILLING_CHANGE_REJECTED", "El proveedor ha rechazado el cambio de la suscripción.");
        }
        await markOperationUnknown(deps, input.operationId, input.changedAt);
        throw new ApiError(503, "BILLING_PROVIDER_UNAVAILABLE", "No se ha podido actualizar la suscripción. Vuelve a intentarlo con la misma clave.");
      }
    }
    await deps.db.update(billingOperations).set({ providerAppliedAt: input.changedAt, updatedAt: input.changedAt })
      .where(and(eq(billingOperations.id, input.operationId), eq(billingOperations.state, "pending")));
  }

  return deps.db.transaction(async (tx) => {
    await lockAgencyForSystem(tx as unknown as AppDependencies["db"], input.agencyId);
    const rows = await tx.select().from(subscriptions).where(and(eq(subscriptions.id, reservation.subscriptionId), eq(subscriptions.agencyId, input.agencyId))).limit(1);
    const subscription = rows[0];
    if (!subscription || subscription.pendingBillingOperationId !== input.operationId) {
      throw new ApiError(409, "BILLING_RECONCILIATION_REQUIRED", "El proveedor confirmó la operación, pero falta reconciliar la suscripción. Reintenta con la misma clave.");
    }
    const updated = await tx.update(subscriptions).set({
      cancelAtPeriodEnd: input.cancelAtPeriodEnd, pendingBillingOperationId: null, updatedAt: input.changedAt,
    }).where(and(
      eq(subscriptions.id, subscription.id),
      eq(subscriptions.pendingBillingOperationId, input.operationId),
      eq(subscriptions.cancelAtPeriodEnd, !input.cancelAtPeriodEnd),
    )).returning({ id: subscriptions.id });
    if (!updated[0]) throw new ApiError(409, "BILLING_RECONCILIATION_REQUIRED", "El proveedor confirmó la operación, pero falta reconciliar la suscripción. Reintenta con la misma clave.");
    const completed = await tx.update(billingOperations).set({
      state: "completed", response: reservation.payload, lastErrorCode: null, updatedAt: input.changedAt,
    }).where(and(eq(billingOperations.id, input.operationId), eq(billingOperations.state, "pending"))).returning({ id: billingOperations.id });
    if (!completed[0]) throw new ApiError(409, "BILLING_OPERATION_CHANGED", "La operación de facturación ha cambiado. Vuelve a consultar su estado.");
    return reservation.payload;
  });
}

const billingHeaders = {
  type: "object",
  required: ["idempotency-key"],
  properties: { "idempotency-key": { type: "string", minLength: 8, maxLength: 200 } },
} as const;

export function registerBillingRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const now = deps.now ?? (() => new Date());

  app.get("/api/v1/billing/status", { schema: { tags: ["Facturación"], summary: "Consultar la suscripción" } }, async (request) => {
    const { agency } = requireAdmin(request);
    const rows = await deps.db.select().from(subscriptions).where(eq(subscriptions.agencyId, agency.id)).limit(1);
    return { data: { subscription: rows[0] ? safeSubscription(rows[0]) : null, prices: PRICES, allowances: PLAN_DEFINITIONS, currency: "EUR", taxTreatment: "pending_commercial_decision", trialDays: 30 } };
  });

  app.post("/api/v1/billing/trial", {
    schema: {
      tags: ["Facturación"], summary: "Activar prueba gratuita con tarjeta", headers: billingHeaders,
      body: { type: "object", additionalProperties: false, required: ["plan", "paymentMethodToken"], properties: { plan: { type: "string", enum: ["particular", "professional", "inmobiliaria"] }, paymentMethodToken: { type: "string", pattern: "^pm_[A-Za-z0-9_-]{4,}$" } } },
    },
  }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const input = z.object({ plan: z.enum(["particular", "professional", "inmobiliaria"]), paymentMethodToken: z.string().regex(/^pm_[A-Za-z0-9_-]{4,}$/) }).strict().parse(request.body);
    const key = idempotencyKey(request);
    const requestedAt = now();
    const claim = await claimOperation(deps, {
      agencyId: agency.id, operation: "create_trial", key,
      fingerprint: hashSecret(`${input.plan}:${hashSecret(input.paymentMethodToken)}`), now: requestedAt,
    });
    if (claim.replay) {
      reply.header("idempotency-replayed", "true");
      return reply.status(201).send(claim.replay);
    }

    try {
      const reservation = await deps.db.transaction(async (tx) => {
        await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
        const existingRows = await tx.select().from(subscriptions).where(eq(subscriptions.agencyId, agency.id)).limit(1);
        const existing = existingRows[0];
        if (existing) {
          if (existing.state === "incomplete" && existing.pendingBillingOperationId === claim.id) return { subscriptionId: existing.id };
          if (existing.state === "incomplete" && existing.pendingBillingOperationId) {
            throw new ApiError(409, "BILLING_TRANSITION_IN_PROGRESS", "La activación de la suscripción sigue pendiente. Reintenta la operación original.");
          }
          throw new ApiError(409, "SUBSCRIPTION_ALREADY_EXISTS", "La agencia ya tiene una suscripción.");
        }
        const subscriptionId = newId();
        await tx.insert(subscriptions).values({
          id: subscriptionId, agencyId: agency.id, plan: input.plan, state: "incomplete",
          pendingBillingOperationId: claim.id, createdAt: requestedAt, updatedAt: requestedAt,
        });
        return { subscriptionId };
      });
      let providerResult;
      try {
        providerResult = await deps.billingProvider.createTrial({ agencyId: agency.id, ...input, activationRequestedAt: requestedAt, idempotencyKey: billingProviderOperationKey(claim.id) });
      } catch (error) {
        if (!(error instanceof BillingProviderError && error.kind === "declined")) await markOperationUnknown(deps, claim.id, now());
        throw paymentProviderApiError(error);
      }
      const providerAppliedAt = now();
      await deps.db.update(billingOperations).set({ providerAppliedAt, updatedAt: providerAppliedAt })
        .where(and(eq(billingOperations.id, claim.id), eq(billingOperations.state, "pending")));
      const response = await deps.db.transaction(async (tx) => {
        await lockAgencyForSystem(tx as unknown as AppDependencies["db"], agency.id);
        const createdAt = now();
        const trialEndsAt = providerResult.trialEndsAt;
        const subscription = {
          id: reservation.subscriptionId, agencyId: agency.id, plan: input.plan, state: "trialing" as const,
          trialEndsAt, currentPeriodEndsAt: trialEndsAt, cancelAtPeriodEnd: false,
          providerCustomerRef: providerResult.customerRef, providerSubscriptionRef: providerResult.subscriptionRef,
          paymentMethodDisplay: providerResult.paymentMethodDisplay, pendingBillingOperationId: null,
          billingLastSyncedAt: null, billingNextSyncAt: null, billingSyncAttempts: 0, billingSyncLastErrorCode: null,
          billingSyncClaimedAt: null, billingSyncClaimToken: null,
          createdAt: requestedAt, updatedAt: createdAt,
        };
        const applied = await tx.update(subscriptions).set(subscription).where(and(
          eq(subscriptions.id, reservation.subscriptionId), eq(subscriptions.agencyId, agency.id),
          eq(subscriptions.state, "incomplete"), eq(subscriptions.pendingBillingOperationId, claim.id),
        )).returning({ id: subscriptions.id });
        if (!applied[0]) throw new ApiError(409, "BILLING_RECONCILIATION_REQUIRED", "El proveedor confirmó la prueba, pero falta reconciliar la suscripción.");
        await tx.update(agencyClosureCleanup).set({
          providerSubscriptionRef: providerResult.subscriptionRef,
          state: sql`case when ${agencyClosureCleanup.state} = 'ready_for_purge' then 'pending' else ${agencyClosureCleanup.state} end`,
          nextAttemptAt: createdAt,
          updatedAt: createdAt,
        }).where(eq(agencyClosureCleanup.agencyId, agency.id));
        const payload = { data: { subscription: safeSubscription(subscription), firstChargeCents: PRICES[input.plan], currency: "EUR", taxTreatment: "pending_commercial_decision", trialDays: 30 } };
        await tx.update(billingOperations).set({ state: "completed", response: payload, updatedAt: createdAt }).where(eq(billingOperations.id, claim.id));
        return payload;
      });
      return reply.status(201).send(response);
    } catch (error) {
      await failOperation(deps, claim.id, now(), operationErrorCode(error));
      throw error;
    }
  });

  app.post("/api/v1/billing/cancel", { schema: { tags: ["Facturación"], summary: "Cancelar al final del periodo", headers: billingHeaders } }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const key = idempotencyKey(request);
    const requestedAt = now();
    const claim = await claimOperation(deps, { agencyId: agency.id, operation: "cancel", key, fingerprint: hashSecret("cancel"), now: requestedAt });
    if (claim.replay) {
      reply.header("idempotency-replayed", "true");
      return claim.replay;
    }
    try {
      return await reconcileRenewalState(deps, {
        agencyId: agency.id, userId: user.id, operationId: claim.id,
        cancelAtPeriodEnd: true, changedAt: now(),
      });
    } catch (error) {
      await failOperation(deps, claim.id, now(), operationErrorCode(error));
      throw error;
    }
  });

  app.post("/api/v1/billing/reactivate", { schema: { tags: ["Facturación"], summary: "Reactivar renovación", headers: billingHeaders } }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const key = idempotencyKey(request);
    const requestedAt = now();
    const claim = await claimOperation(deps, { agencyId: agency.id, operation: "reactivate", key, fingerprint: hashSecret("reactivate"), now: requestedAt });
    if (claim.replay) {
      reply.header("idempotency-replayed", "true");
      return claim.replay;
    }
    try {
      return await reconcileRenewalState(deps, {
        agencyId: agency.id, userId: user.id, operationId: claim.id,
        cancelAtPeriodEnd: false, changedAt: now(),
      });
    } catch (error) {
      await failOperation(deps, claim.id, now(), operationErrorCode(error));
      throw error;
    }
  });

  app.patch("/api/v1/billing/payment-method", {
    schema: {
      tags: ["Facturación"], summary: "Actualizar método de pago", headers: billingHeaders,
      body: { type: "object", additionalProperties: false, required: ["paymentMethodToken"], properties: { paymentMethodToken: { type: "string", pattern: "^pm_[A-Za-z0-9_-]{4,}$" } } },
    },
  }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const { paymentMethodToken } = z.object({ paymentMethodToken: z.string().regex(/^pm_[A-Za-z0-9_-]{4,}$/) }).strict().parse(request.body);
    const key = idempotencyKey(request);
    const requestedAt = now();
    const claim = await claimOperation(deps, {
      agencyId: agency.id, operation: "update_payment_method", key,
      fingerprint: hashSecret(hashSecret(paymentMethodToken)), now: requestedAt,
    });
    if (claim.replay) {
      reply.header("idempotency-replayed", "true");
      return claim.replay;
    }
    try {
      const reservation = await deps.db.transaction(async (tx) => {
        await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
        const rows = await tx.select().from(subscriptions).where(eq(subscriptions.agencyId, agency.id)).limit(1);
        const subscription = rows[0];
        if (!subscription?.providerCustomerRef) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "No hay ninguna suscripción para actualizar.");
        if (subscription.pendingBillingOperationId && subscription.pendingBillingOperationId !== claim.id) {
          throw new ApiError(409, "BILLING_TRANSITION_IN_PROGRESS", "Hay otra actualización de la suscripción en curso. Espera a que termine antes de volver a intentarlo.");
        }
        if (!subscription.pendingBillingOperationId) {
          const reserved = await tx.update(subscriptions).set({
            pendingBillingOperationId: claim.id, billingSyncClaimedAt: null, billingSyncClaimToken: null, updatedAt: requestedAt,
          })
            .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.updatedAt, subscription.updatedAt), sql`${subscriptions.pendingBillingOperationId} is null`))
            .returning({ id: subscriptions.id });
          if (!reserved[0]) throw new ApiError(409, "SUBSCRIPTION_CHANGED", "La suscripción ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        }
        return { subscriptionId: subscription.id, customerRef: subscription.providerCustomerRef };
      });
      let updated;
      try {
        updated = await deps.billingProvider.updatePaymentMethod({ customerRef: reservation.customerRef, paymentMethodToken, idempotencyKey: billingProviderOperationKey(claim.id) });
      } catch (error) {
        if (!(error instanceof BillingProviderError && error.kind === "declined")) {
          await markOperationUnknown(deps, claim.id, now());
        }
        throw paymentProviderApiError(error);
      }
      const providerAppliedAt = now();
      await deps.db.update(billingOperations).set({ providerAppliedAt, updatedAt: providerAppliedAt })
        .where(and(eq(billingOperations.id, claim.id), eq(billingOperations.state, "pending")));
      const response = await deps.db.transaction(async (tx) => {
        await lockAgencyForSystem(tx as unknown as AppDependencies["db"], agency.id);
        const updatedAt = now();
        const applied = await tx.update(subscriptions).set({ paymentMethodDisplay: updated.paymentMethodDisplay, pendingBillingOperationId: null, updatedAt })
          .where(and(eq(subscriptions.id, reservation.subscriptionId), eq(subscriptions.agencyId, agency.id), eq(subscriptions.pendingBillingOperationId, claim.id)))
          .returning({ id: subscriptions.id });
        if (!applied[0]) throw new ApiError(409, "BILLING_RECONCILIATION_REQUIRED", "El proveedor confirmó la operación, pero falta reconciliar la suscripción. Reintenta con la misma clave.");
        const payload = { data: { paymentMethodDisplay: updated.paymentMethodDisplay } };
        await tx.update(billingOperations).set({ state: "completed", response: payload, updatedAt }).where(eq(billingOperations.id, claim.id));
        return payload;
      });
      return response;
    } catch (error) {
      await failOperation(deps, claim.id, now(), operationErrorCode(error));
      throw error;
    }
  });

  app.get("/api/v1/billing/invoices", { schema: { tags: ["Facturación"], summary: "Listar facturas" } }, async (request) => {
    const { agency } = requireAdmin(request);
    const rows = await deps.db.select({
      id: invoices.id, amountCents: invoices.amountCents, currency: invoices.currency,
      status: invoices.status, issuedAt: invoices.issuedAt, hostedUrl: invoices.hostedUrl,
    }).from(invoices).where(eq(invoices.agencyId, agency.id)).orderBy(desc(invoices.issuedAt));
    return { data: { invoices: rows } };
  });
}
