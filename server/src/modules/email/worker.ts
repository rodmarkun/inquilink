import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { and, asc, eq, gt, lt, lte, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agencies, agencyMemberships, appointments, emailOutbox, subscriptions, users } from "../../db/schema.js";
import { isEmailTemplateName, renderEmail, type RenderedEmail } from "./templates.js";

export interface EmailDelivery {
  idempotencyKey: string;
  recipient: string;
  content: RenderedEmail;
}

export interface EmailTransport {
  deliver(delivery: EmailDelivery): Promise<void>;
}

/** Deterministic sink for explicitly local environments. It deliberately logs no recipient or content. */
export class LocalEmailTransport implements EmailTransport {
  deliveredCount = 0;
  async deliver(_delivery: EmailDelivery): Promise<void> { this.deliveredCount += 1; }
}

export class SmtpEmailTransport implements EmailTransport {
  readonly #transport;
  constructor(options: { host: string; port: number; secure: boolean; requireTLS: boolean; user?: string; password?: string; from: string }) {
    this.#transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: options.requireTLS,
      ...(options.user && options.password ? { auth: { user: options.user, pass: options.password } } : {}),
    });
    this.from = options.from;
  }
  private readonly from: string;
  async deliver(delivery: EmailDelivery): Promise<void> {
    await this.#transport.sendMail({
      from: this.from,
      to: delivery.recipient,
      messageId: `<${delivery.idempotencyKey.replace(/[^A-Za-z0-9_.-]/g, "_")}@inquilink>`,
      subject: delivery.content.subject,
      text: delivery.content.text,
    });
  }
}

/** HTTPS gateway transport for a production email provider chosen at deployment time. */
export class WebhookEmailTransport implements EmailTransport {
  constructor(private readonly endpoint: string, private readonly bearerToken: string) {}
  async deliver(delivery: EmailDelivery): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.bearerToken}`,
        "idempotency-key": delivery.idempotencyKey,
      },
      body: JSON.stringify(delivery),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Object.assign(new Error("EMAIL_PROVIDER_REJECTED"), { code: "EMAIL_PROVIDER_REJECTED" });
  }
}

export function createEmailTransport(config: {
  ALLOW_LOCAL_PROVIDERS: boolean;
  EMAIL_TRANSPORT: "unconfigured" | "local" | "smtp" | "webhook";
  EMAIL_PROVIDER_URL?: string | undefined;
  EMAIL_PROVIDER_TOKEN?: string | undefined;
  EMAIL_SMTP_HOST?: string | undefined;
  EMAIL_SMTP_PORT?: number | undefined;
  EMAIL_SMTP_SECURE?: boolean | undefined;
  EMAIL_SMTP_REQUIRE_TLS?: boolean | undefined;
  EMAIL_SMTP_USER?: string | undefined;
  EMAIL_SMTP_PASSWORD?: string | undefined;
  EMAIL_FROM?: string | undefined;
}): EmailTransport {
  if (config.EMAIL_TRANSPORT === "webhook" && config.EMAIL_PROVIDER_URL && config.EMAIL_PROVIDER_TOKEN) {
    return new WebhookEmailTransport(config.EMAIL_PROVIDER_URL, config.EMAIL_PROVIDER_TOKEN);
  }
  if (config.EMAIL_TRANSPORT === "smtp" && config.EMAIL_SMTP_HOST && config.EMAIL_SMTP_PORT && config.EMAIL_FROM) {
    return new SmtpEmailTransport({
      host: config.EMAIL_SMTP_HOST,
      port: config.EMAIL_SMTP_PORT,
      secure: config.EMAIL_SMTP_SECURE ?? false,
      requireTLS: config.EMAIL_SMTP_REQUIRE_TLS ?? false,
      from: config.EMAIL_FROM,
      ...(config.EMAIL_SMTP_USER ? { user: config.EMAIL_SMTP_USER } : {}),
      ...(config.EMAIL_SMTP_PASSWORD ? { password: config.EMAIL_SMTP_PASSWORD } : {}),
    });
  }
  if (config.EMAIL_TRANSPORT === "local" && config.ALLOW_LOCAL_PROVIDERS) return new LocalEmailTransport();
  throw new Error("No hay un proveedor de correo configurado. El envío se ha detenido de forma segura.");
}

export interface DispatchOptions {
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
  now?: () => Date;
}

export function safeOperationalErrorCode(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof current.code === "string") {
      const candidate = current.code.toUpperCase();
      if (/^[A-Z][A-Z0-9_]{1,39}$/.test(candidate)) return candidate;
    }
    current = "cause" in current ? current.cause : null;
  }
  return "EMAIL_DELIVERY_FAILED";
}

async function scheduledMessageIsCurrent(db: Database, message: typeof emailOutbox.$inferSelect): Promise<boolean> {
  const agencyRecipientTemplate = ["new_applicant", "viewing_reminder", "trial_ending", "payment_failure"].includes(message.template);
  const requiresAgencyMembership = agencyRecipientTemplate && Boolean(message.agencyId || message.userId);
  if (!message.subjectType && !requiresAgencyMembership) return true;
  if (!message.agencyId || !message.userId) return false;
  const [agencyRows, userRows, membershipRows] = await Promise.all([
    db.select({ state: agencies.accountState }).from(agencies).where(eq(agencies.id, message.agencyId)).limit(1),
    db.select({ state: users.accountState }).from(users).where(eq(users.id, message.userId)).limit(1),
    requiresAgencyMembership
      ? db.select({ userId: agencyMemberships.userId }).from(agencyMemberships).where(and(
        eq(agencyMemberships.agencyId, message.agencyId), eq(agencyMemberships.userId, message.userId),
      )).limit(1)
      : Promise.resolve([]),
  ]);
  if (agencyRows[0]?.state !== "active" || userRows[0]?.state !== "active") return false;
  if (requiresAgencyMembership && !membershipRows[0]) return false;
  if (message.template === "viewing_reminder") {
    if (message.subjectType !== "appointment" || !message.subjectId) return false;
    const rows = await db.select({ state: appointments.state, startsAt: appointments.startsAt }).from(appointments)
      .where(and(eq(appointments.id, message.subjectId), eq(appointments.agencyId, message.agencyId!))).limit(1);
    return rows[0]?.state === "scheduled" && rows[0].startsAt.toISOString() === message.variables.startsAt;
  }
  if (message.template === "trial_ending") {
    if (message.subjectType !== "subscription" || !message.subjectId) return false;
    const rows = await db.select({ state: subscriptions.state, trialEndsAt: subscriptions.trialEndsAt }).from(subscriptions)
      .where(and(eq(subscriptions.id, message.subjectId), eq(subscriptions.agencyId, message.agencyId!))).limit(1);
    return rows[0]?.state === "trialing" && rows[0].trialEndsAt?.toISOString() === message.variables.trialEndsAt;
  }
  if (message.template === "payment_failure") {
    if (message.subjectType !== "subscription" || !message.subjectId) return false;
    const rows = await db.select({ state: subscriptions.state }).from(subscriptions)
      .where(and(eq(subscriptions.id, message.subjectId), eq(subscriptions.agencyId, message.agencyId!))).limit(1);
    return rows[0]?.state === "past_due";
  }
  return true;
}

/**
 * Claims messages with conditional row updates. Competing workers can discover the
 * same candidate, but only one can transition it with its unique claim token.
 */
export async function dispatchEmailBatch(
  db: Database,
  transport: EmailTransport,
  appOrigin: string,
  options: DispatchOptions = {},
): Promise<{ claimed: number; sent: number; retried: number; failed: number }> {
  const batchSize = options.batchSize ?? 25;
  const maxAttempts = options.maxAttempts ?? 5;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const clock = options.now ?? (() => new Date());
  const claimedAt = clock();
  const staleBefore = new Date(claimedAt.getTime() - leaseMs);
  await db.update(emailOutbox).set({
    state: "expired",
    recipient: "eliminado@inquilink.invalid",
    variables: {},
    claimToken: null,
    claimedAt: null,
    lastErrorCode: "EMAIL_EXPIRED",
  }).where(and(
    or(eq(emailOutbox.state, "pending"), eq(emailOutbox.state, "processing")),
    lte(emailOutbox.expiresAt, claimedAt),
  ));
  const candidates = await db.select().from(emailOutbox).where(and(
    lt(emailOutbox.attempts, maxAttempts),
    gt(emailOutbox.expiresAt, claimedAt),
    or(
      and(eq(emailOutbox.state, "pending"), lte(emailOutbox.availableAt, claimedAt)),
      and(eq(emailOutbox.state, "processing"), lte(emailOutbox.claimedAt, staleBefore)),
    ),
  )).orderBy(asc(emailOutbox.availableAt), asc(emailOutbox.createdAt)).limit(batchSize);

  const result = { claimed: 0, sent: 0, retried: 0, failed: 0 };
  for (const candidate of candidates) {
    const claimToken = randomUUID();
    const eligible = or(
      and(eq(emailOutbox.state, "pending"), lte(emailOutbox.availableAt, claimedAt)),
      and(eq(emailOutbox.state, "processing"), lte(emailOutbox.claimedAt, staleBefore)),
    );
    const rows = await db.update(emailOutbox).set({
      state: "processing",
      attempts: candidate.attempts + 1,
      claimedAt,
      claimToken,
      lastErrorCode: null,
    }).where(and(eq(emailOutbox.id, candidate.id), lt(emailOutbox.attempts, maxAttempts), eligible)).returning();
    const claimed = rows[0];
    if (!claimed) continue;
    result.claimed += 1;

    if (!await scheduledMessageIsCurrent(db, claimed)) {
      await db.update(emailOutbox).set({
        state: "expired", recipient: "eliminado@inquilink.invalid", variables: {},
        claimToken: null, claimedAt: null, lastErrorCode: "EMAIL_SUBJECT_CHANGED",
      }).where(and(eq(emailOutbox.id, claimed.id), eq(emailOutbox.state, "processing"), eq(emailOutbox.claimToken, claimToken)));
      continue;
    }

    try {
      if (!isEmailTemplateName(claimed.template)) throw Object.assign(new Error("Plantilla no compatible"), { code: "UNKNOWN_EMAIL_TEMPLATE" });
      const content = renderEmail({ recipient: claimed.recipient, template: claimed.template, variables: claimed.variables }, appOrigin);
      await transport.deliver({ idempotencyKey: `email-outbox:${claimed.id}`, recipient: claimed.recipient, content });
      const completed = await db.update(emailOutbox).set({
        state: "sent", sentAt: clock(), claimToken: null, claimedAt: null,
        recipient: "eliminado@inquilink.invalid", variables: {}, lastErrorCode: null,
      })
        .where(and(eq(emailOutbox.id, claimed.id), eq(emailOutbox.state, "processing"), eq(emailOutbox.claimToken, claimToken))).returning({ id: emailOutbox.id });
      if (completed[0]) result.sent += 1;
    } catch (error) {
      const terminal = claimed.attempts >= maxAttempts;
      const backoffMs = Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, claimed.attempts - 1));
      const updated = await db.update(emailOutbox).set({
        state: terminal ? "failed" : "pending",
        availableAt: terminal ? claimed.availableAt : new Date(clock().getTime() + backoffMs),
        claimToken: null,
        claimedAt: null,
        lastErrorCode: safeOperationalErrorCode(error),
        ...(terminal ? { recipient: "eliminado@inquilink.invalid", variables: {} } : {}),
      }).where(and(eq(emailOutbox.id, claimed.id), eq(emailOutbox.state, "processing"), eq(emailOutbox.claimToken, claimToken))).returning({ id: emailOutbox.id });
      if (updated[0]) terminal ? result.failed += 1 : result.retried += 1;
    }
  }
  return result;
}
