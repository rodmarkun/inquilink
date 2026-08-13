import { z } from "zod";
import type { Database } from "../../db/client.js";
import { emailOutbox } from "../../db/schema.js";
import { newId } from "../../lib/ids.js";

export const emailTemplateNames = [
  "new_applicant",
  "viewing_reminder",
  "trial_ending",
  "payment_failure",
  "team_invitation",
  "verify_email",
  "reset_password",
  "guest_application_otp",
  "application_received",
  "viewing_created",
  "viewing_rescheduled",
  "viewing_cancelled",
] as const;

export type EmailTemplateName = (typeof emailTemplateNames)[number];

const variableSchemas: Record<EmailTemplateName, z.ZodType> = {
  new_applicant: z.object({ propertyTitle: z.string().min(1).max(240) }).strict(),
  viewing_reminder: z.object({ startsAt: z.iso.datetime(), propertyTitle: z.string().min(1).max(240).optional() }).strict(),
  trial_ending: z.object({ trialEndsAt: z.iso.datetime(), plan: z.enum(["particular", "professional", "inmobiliaria"]) }).strict(),
  payment_failure: z.object({ billingPath: z.string().startsWith("/").max(200) }).strict(),
  team_invitation: z.object({ token: z.string().min(20), agencyName: z.string().min(1).max(200) }).strict(),
  verify_email: z.object({ token: z.string().min(20), returnPath: z.string().startsWith("/").max(500) }).strict(),
  reset_password: z.object({ token: z.string().min(20), returnPath: z.string().startsWith("/").max(500) }).strict(),
  guest_application_otp: z.object({ code: z.string().regex(/^\d{6}$/), propertyTitle: z.string().min(1).max(240) }).strict(),
  application_received: z.object({ propertyTitle: z.string().min(1).max(240), agencyName: z.string().min(1).max(200) }).strict(),
  viewing_created: z.object({ startsAt: z.iso.datetime(), propertyTitle: z.string().min(1).max(240).optional() }).strict(),
  viewing_rescheduled: z.object({ startsAt: z.iso.datetime(), propertyTitle: z.string().min(1).max(240).optional() }).strict(),
  viewing_cancelled: z.object({ startsAt: z.iso.datetime(), propertyTitle: z.string().min(1).max(240).optional() }).strict(),
};

export interface EmailMessage {
  /** Opaque cleanup scopes. Intentionally not foreign keys so terminal history can survive deletion. */
  userId?: string;
  agencyId?: string;
  subjectType?: "team_invitation" | "appointment" | "subscription";
  subjectId?: string;
  recipient: string;
  template: EmailTemplateName;
  variables: Record<string, string>;
  /** Makes scheduled or retried business notifications safe to enqueue repeatedly. */
  dedupeKey?: string;
  availableAt?: Date;
  expiresAt?: Date;
}

export interface EmailProvider {
  /** Enqueues a durable message. Delivery is performed by the email worker. */
  send(message: EmailMessage, options?: { transaction?: Pick<Database, "insert"> }): Promise<void>;
}

export function validateEmailMessage(message: EmailMessage): EmailMessage {
  const recipient = z.email().max(320).parse(message.recipient).toLowerCase();
  const template = z.enum(emailTemplateNames).parse(message.template);
  const variables = variableSchemas[template].parse(message.variables) as Record<string, string>;
  const dedupeKey = message.dedupeKey === undefined ? undefined : z.string().min(8).max(160).parse(message.dedupeKey);
  const availableAt = message.availableAt;
  const expiresAt = message.expiresAt;
  const userId = message.userId === undefined ? undefined : z.string().uuid().parse(message.userId);
  const agencyId = message.agencyId === undefined ? undefined : z.string().uuid().parse(message.agencyId);
  const subjectType = message.subjectType === undefined ? undefined : z.enum(["team_invitation", "appointment", "subscription"]).parse(message.subjectType);
  const subjectId = message.subjectId === undefined ? undefined : z.string().uuid().parse(message.subjectId);
  if (Boolean(subjectType) !== Boolean(subjectId)) throw new Error("INVALID_EMAIL_SUBJECT");
  if (availableAt && expiresAt && expiresAt <= availableAt) throw new Error("INVALID_EMAIL_DELIVERY_WINDOW");
  return {
    recipient, template, variables, ...(userId ? { userId } : {}), ...(agencyId ? { agencyId } : {}),
    ...(subjectType ? { subjectType, subjectId: subjectId! } : {}), ...(dedupeKey ? { dedupeKey } : {}),
    ...(availableAt ? { availableAt } : {}), ...(expiresAt ? { expiresAt } : {}),
  };
}

/** Can receive either the application database or a Drizzle transaction. */
export async function enqueueEmail(
  dbOrTx: Pick<Database, "insert">,
  rawMessage: EmailMessage,
  now: Date = new Date(),
): Promise<void> {
  const message = validateEmailMessage(rawMessage);
  await dbOrTx.insert(emailOutbox).values({
    id: newId(),
    userId: message.userId ?? null,
    agencyId: message.agencyId ?? null,
    subjectType: message.subjectType ?? null,
    subjectId: message.subjectId ?? null,
    recipient: message.recipient,
    template: message.template,
    locale: "es-ES",
    variables: message.variables,
    dedupeKey: message.dedupeKey ?? null,
    state: "pending",
    attempts: 0,
    availableAt: message.availableAt ?? now,
    expiresAt: message.expiresAt ?? new Date(now.getTime() + 7 * 86_400_000),
    createdAt: now,
  }).onConflictDoNothing({ target: emailOutbox.dedupeKey });
}

/** Durable enqueue adapter. It never treats insertion into the outbox as delivery. */
export class OutboxEmailProvider implements EmailProvider {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}

  async send(rawMessage: EmailMessage, options?: { transaction?: Pick<Database, "insert"> }): Promise<void> {
    await enqueueEmail(options?.transaction ?? this.db, rawMessage, this.now());
  }
}
