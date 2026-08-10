import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingProviderError, createBillingProvider, LocalBillingProvider, WebhookBillingProvider } from "./billing/provider.js";
import { createEmailTransport, LocalEmailTransport, WebhookEmailTransport } from "./email/worker.js";
import { GatewayPrivateDocumentStorage } from "./rentals/storage.js";

afterEach(() => vi.unstubAllGlobals());

describe("production provider configuration", () => {
  it("fails closed unless local billing is explicit or a complete gateway is configured", () => {
    expect(() => createBillingProvider({ ALLOW_LOCAL_PROVIDERS: false })).toThrow(/proveedor de facturación/);
    expect(() => createBillingProvider({ ALLOW_LOCAL_PROVIDERS: false, BILLING_PROVIDER_URL: "https://billing.example/" })).toThrow(/proveedor de facturación/);
    expect(createBillingProvider({ ALLOW_LOCAL_PROVIDERS: true })).toBeInstanceOf(LocalBillingProvider);
    expect(createBillingProvider({
      ALLOW_LOCAL_PROVIDERS: false,
      BILLING_PROVIDER_URL: "https://billing.example/",
      BILLING_PROVIDER_TOKEN: "production-secret-token",
    })).toBeInstanceOf(WebhookBillingProvider);
  });

  it("fails closed unless local email is explicit or a complete gateway is configured", () => {
    expect(() => createEmailTransport({ ALLOW_LOCAL_PROVIDERS: false, EMAIL_TRANSPORT: "unconfigured" })).toThrow(/proveedor de correo/);
    expect(() => createEmailTransport({ ALLOW_LOCAL_PROVIDERS: false, EMAIL_TRANSPORT: "local" })).toThrow(/proveedor de correo/);
    expect(() => createEmailTransport({ ALLOW_LOCAL_PROVIDERS: false, EMAIL_TRANSPORT: "webhook", EMAIL_PROVIDER_URL: "https://email.example/" })).toThrow(/proveedor de correo/);
    expect(createEmailTransport({ ALLOW_LOCAL_PROVIDERS: true, EMAIL_TRANSPORT: "local" })).toBeInstanceOf(LocalEmailTransport);
    expect(createEmailTransport({
      ALLOW_LOCAL_PROVIDERS: false,
      EMAIL_TRANSPORT: "webhook",
      EMAIL_PROVIDER_URL: "https://email.example/",
      EMAIL_PROVIDER_TOKEN: "production-secret-token",
    })).toBeInstanceOf(WebhookEmailTransport);
  });

  it("passes provider tokens only to the configured HTTPS gateway with idempotency", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      customerRef: "customer_123",
      subscriptionRef: "subscription_123",
      paymentMethodDisplay: "Tarjeta terminada en 4242",
      trialEndsAt: "2026-09-07T10:00:00.000Z",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new WebhookBillingProvider("https://billing.example/api", "production-secret-token");
    const result = await provider.createTrial({
      agencyId: "50000000-0000-4000-8000-000000000001",
      plan: "professional",
      paymentMethodToken: "pm_provider_nonce",
      activationRequestedAt: new Date("2026-08-08T10:00:00.000Z"),
      fiscalProfile: { fiscalId: "B12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, Madrid" },
      idempotencyKey: "request-key-123",
    });
    expect(result.paymentMethodDisplay).toBe("Tarjeta terminada en 4242");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://billing.example/api/subscriptions/trial");
    expect(init.headers).toMatchObject({ authorization: "Bearer production-secret-token", "idempotency-key": "request-key-123" });
    expect(JSON.parse(init.body)).toEqual({ agencyId: "50000000-0000-4000-8000-000000000001", plan: "professional", paymentMethodToken: "pm_provider_nonce", activationRequestedAt: "2026-08-08T10:00:00.000Z", fiscalProfile: { fiscalId: "B12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, Madrid" } });
  });

  it("preserves a path-prefixed storage gateway URL without requiring a trailing slash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const storage = new GatewayPrivateDocumentStorage("https://storage.example/gateway", "production-secret-token");
    await storage.put({ key: "agency/document", body: Buffer.from("safe"), contentType: "application/pdf" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://storage.example/gateway/objects?key=agency%2Fdocument");
  });

  it("accepts an empty 200 response for void billing mutations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new WebhookBillingProvider("https://billing.example/api", "production-secret-token");
    await expect(provider.cancel({ subscriptionRef: "subscription_123", idempotencyKey: "billing-operation:cancel" })).resolves.toBeUndefined();
    await expect(provider.reactivate({ subscriptionRef: "subscription_123", idempotencyKey: "billing-operation:reactivate" })).resolves.toBeUndefined();
    await expect(provider.changePlan({ subscriptionRef: "subscription_123", plan: "inmobiliaria", idempotencyKey: "billing-operation:plan" })).resolves.toBeUndefined();
    await expect(provider.updateCustomerFiscalProfile({ customerRef: "customer_123", fiscalProfile: { fiscalId: "B12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, Madrid" }, idempotencyKey: "billing-operation:fiscal" })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://billing.example/api/subscriptions/cancel",
      "https://billing.example/api/subscriptions/reactivate",
      "https://billing.example/api/subscriptions/change-plan",
      "https://billing.example/api/customers/fiscal-profile",
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ subscriptionRef: "subscription_123", plan: "inmobiliaria" });
  });

  it.each([
    ["explicit decline", () => Promise.resolve(new Response(null, { status: 402 })), "declined"],
    ["explicit validation decline", () => Promise.resolve(new Response(null, { status: 422 })), "declined"],
    ["bad integration request", () => Promise.resolve(new Response(null, { status: 400 })), "unavailable"],
    ["invalid credentials", () => Promise.resolve(new Response(null, { status: 401 })), "unavailable"],
    ["forbidden integration", () => Promise.resolve(new Response(null, { status: 403 })), "unavailable"],
    ["missing provider resource", () => Promise.resolve(new Response(null, { status: 404 })), "unavailable"],
    ["provider conflict", () => Promise.resolve(new Response(null, { status: 409 })), "unavailable"],
    ["request timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError")), "unavailable"],
    ["network error", () => Promise.reject(new TypeError("network failed")), "unavailable"],
    ["provider 5xx", () => Promise.resolve(new Response(null, { status: 503 })), "unavailable"],
  ] as const)("classifies %s without exposing provider response details", async (_label, behavior, expectedKind) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(behavior));
    const provider = new WebhookBillingProvider("https://billing.example/api/", "production-secret-token");
    const error = await provider.createTrial({
      agencyId: "50000000-0000-4000-8000-000000000001", plan: "professional",
      paymentMethodToken: "pm_provider_nonce", activationRequestedAt: new Date("2026-08-08T10:00:00.000Z"), idempotencyKey: "request-key-123",
      fiscalProfile: { fiscalId: "B12345678", billingName: "Agencia Centro SL", billingAddress: "Calle Mayor 1, Madrid" },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BillingProviderError);
    expect((error as BillingProviderError).kind).toBe(expectedKind);
    expect((error as Error).message).not.toMatch(/network failed|timed out|503|402/i);
  });

  it("delivers only rendered content through the configured email gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const transport = new WebhookEmailTransport("https://email.example/send", "production-secret-token");
    await transport.deliver({
      idempotencyKey: "email-outbox:50000000-0000-4000-8000-000000000099",
      recipient: "persona@example.es",
      content: { subject: "Asunto", preview: "Vista previa", text: "Contenido" },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://email.example/send");
    expect(init.headers).toMatchObject({ authorization: "Bearer production-secret-token", "idempotency-key": "email-outbox:50000000-0000-4000-8000-000000000099" });
    expect(JSON.parse(init.body)).toEqual({ idempotencyKey: "email-outbox:50000000-0000-4000-8000-000000000099", recipient: "persona@example.es", content: { subject: "Asunto", preview: "Vista previa", text: "Contenido" } });
  });
});
