import { createHash } from "node:crypto";
import { z } from "zod";

export interface CreatedSubscription {
  customerRef: string;
  subscriptionRef: string;
  paymentMethodDisplay: string;
  trialEndsAt: Date;
}

export interface BillingProviderInvoiceSnapshot {
  providerInvoiceRef: string;
  amountCents: number;
  currency: string;
  status: "open" | "paid" | "past_due" | "void" | "uncollectible";
  issuedAt: Date;
  hostedUrl: string | null;
}

export interface BillingProviderSubscriptionSnapshot {
  state: "trialing" | "active" | "past_due" | "cancelled";
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodDisplay: string | null;
  invoices: BillingProviderInvoiceSnapshot[];
}

export class BillingProviderError extends Error {
  constructor(public readonly kind: "declined" | "unavailable") {
    super(kind === "declined" ? "BILLING_PROVIDER_DECLINED" : "BILLING_PROVIDER_UNAVAILABLE");
  }
}

export interface BillingProvider {
  createTrial(input: { agencyId: string; plan: "particular" | "professional" | "inmobiliaria"; paymentMethodToken: string; activationRequestedAt: Date; idempotencyKey: string }): Promise<CreatedSubscription>;
  cancel(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void>;
  reactivate(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void>;
  updatePaymentMethod(input: { customerRef: string; paymentMethodToken: string; idempotencyKey: string }): Promise<{ paymentMethodDisplay: string }>;
  reconcileTrial?(input: { agencyId: string; idempotencyKey: string }): Promise<CreatedSubscription | null>;
  syncSubscription?(input: { subscriptionRef: string }): Promise<BillingProviderSubscriptionSnapshot | null>;
}

export function billingProviderOperationKey(operationId: string): string {
  return `billing-operation:${operationId}`;
}

/** Deterministic local provider. It accepts only a provider token and never raw card data. */
export class LocalBillingProvider implements BillingProvider {
  async createTrial(input: { agencyId: string; plan: "particular" | "professional" | "inmobiliaria"; paymentMethodToken: string; activationRequestedAt: Date; idempotencyKey: string }): Promise<CreatedSubscription> {
    if (!input.paymentMethodToken.startsWith("pm_")) {
      throw new BillingProviderError("declined");
    }
    const digest = createHash("sha256").update(`${input.agencyId}:${input.idempotencyKey}`).digest("hex").slice(0, 16);
    return {
      customerRef: `local_customer_${digest}`,
      subscriptionRef: `local_subscription_${digest}_${input.plan}`,
      paymentMethodDisplay: "Tarjeta terminada en 4242",
      trialEndsAt: new Date(input.activationRequestedAt.getTime() + 30 * 86_400_000),
    };
  }

  async cancel(_input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {}
  async reactivate(_input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {}
  async updatePaymentMethod(input: { customerRef: string; paymentMethodToken: string; idempotencyKey: string }): Promise<{ paymentMethodDisplay: string }> {
    if (!input.paymentMethodToken.startsWith("pm_")) throw new BillingProviderError("declined");
    return { paymentMethodDisplay: "Tarjeta terminada en 4242" };
  }
  async syncSubscription(): Promise<null> { return null; }
  async reconcileTrial(): Promise<null> { return null; }
}

const createdSubscriptionSchema = z.object({
  customerRef: z.string().min(1).max(300),
  subscriptionRef: z.string().min(1).max(300),
  paymentMethodDisplay: z.string().regex(/^Tarjeta terminada en \d{4}$/),
  trialEndsAt: z.iso.datetime(),
}).strict();
const paymentMethodSchema = z.object({ paymentMethodDisplay: z.string().regex(/^Tarjeta terminada en \d{4}$/) }).strict();
const subscriptionSnapshotSchema = z.object({
  state: z.enum(["trialing", "active", "past_due", "cancelled"]),
  trialEndsAt: z.iso.datetime().nullable(),
  currentPeriodEndsAt: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  paymentMethodDisplay: z.string().regex(/^Tarjeta terminada en \d{4}$/).nullable(),
  invoices: z.array(z.object({
    providerInvoiceRef: z.string().min(1).max(300),
    amountCents: z.number().int().nonnegative().max(2_147_483_647),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.enum(["open", "paid", "past_due", "void", "uncollectible"]),
    issuedAt: z.iso.datetime(),
    hostedUrl: z.url().nullable(),
  }).strict()).max(100),
}).strict();

/** Provider-neutral HTTPS gateway adapter for production billing integrations. */
export class WebhookBillingProvider implements BillingProvider {
  private readonly baseUrl: string;
  constructor(baseUrl: string, private readonly bearerToken: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }

  private async request(path: string, body: Record<string, unknown>, idempotencyKey?: string, expectJson = true): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.bearerToken}`,
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BillingProviderError("unavailable");
    }
    if (!response.ok) {
      const declined = [402, 422].includes(response.status);
      throw new BillingProviderError(declined ? "declined" : "unavailable");
    }
    return expectJson && response.status !== 204 ? response.json() : {};
  }

  async createTrial(input: { agencyId: string; plan: "particular" | "professional" | "inmobiliaria"; paymentMethodToken: string; activationRequestedAt: Date; idempotencyKey: string }): Promise<CreatedSubscription> {
    const created = createdSubscriptionSchema.parse(await this.request("subscriptions/trial", {
      agencyId: input.agencyId, plan: input.plan, paymentMethodToken: input.paymentMethodToken,
      activationRequestedAt: input.activationRequestedAt.toISOString(),
    }, input.idempotencyKey));
    return { ...created, trialEndsAt: new Date(created.trialEndsAt) };
  }
  async cancel(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {
    await this.request("subscriptions/cancel", { subscriptionRef: input.subscriptionRef }, input.idempotencyKey, false);
  }
  async reactivate(input: { subscriptionRef: string; idempotencyKey: string }): Promise<void> {
    await this.request("subscriptions/reactivate", { subscriptionRef: input.subscriptionRef }, input.idempotencyKey, false);
  }
  async updatePaymentMethod(input: { customerRef: string; paymentMethodToken: string; idempotencyKey: string }): Promise<{ paymentMethodDisplay: string }> {
    return paymentMethodSchema.parse(await this.request("payment-methods/update", {
      customerRef: input.customerRef, paymentMethodToken: input.paymentMethodToken,
    }, input.idempotencyKey));
  }
  async reconcileTrial(input: { agencyId: string; idempotencyKey: string }): Promise<CreatedSubscription | null> {
    const raw = await this.request("subscriptions/trial/reconcile", { agencyId: input.agencyId }, input.idempotencyKey);
    if (raw === null) return null;
    const created = createdSubscriptionSchema.parse(raw);
    return { ...created, trialEndsAt: new Date(created.trialEndsAt) };
  }
  async syncSubscription(input: { subscriptionRef: string }): Promise<BillingProviderSubscriptionSnapshot | null> {
    const snapshot = subscriptionSnapshotSchema.parse(await this.request("subscriptions/sync", { subscriptionRef: input.subscriptionRef }));
    return {
      ...snapshot,
      trialEndsAt: snapshot.trialEndsAt ? new Date(snapshot.trialEndsAt) : null,
      currentPeriodEndsAt: snapshot.currentPeriodEndsAt ? new Date(snapshot.currentPeriodEndsAt) : null,
      invoices: snapshot.invoices.map((invoice) => ({ ...invoice, issuedAt: new Date(invoice.issuedAt) })),
    };
  }
}

export function createBillingProvider(config: {
  ALLOW_LOCAL_PROVIDERS: boolean;
  BILLING_PROVIDER_URL?: string | undefined;
  BILLING_PROVIDER_TOKEN?: string | undefined;
}): BillingProvider {
  if (config.BILLING_PROVIDER_URL && config.BILLING_PROVIDER_TOKEN) {
    return new WebhookBillingProvider(config.BILLING_PROVIDER_URL, config.BILLING_PROVIDER_TOKEN);
  }
  if (config.ALLOW_LOCAL_PROVIDERS) return new LocalBillingProvider();
  throw new Error("No hay un proveedor de facturación configurado. El servicio se ha detenido de forma segura.");
}
