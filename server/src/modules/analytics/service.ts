import { count, eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { analyticsEvents } from "../../db/schema.js";
import { newId } from "../../lib/ids.js";

const marketingEvent = z.object({
  name: z.literal("marketing_cta_clicked"),
  placement: z.enum(["hero", "pricing", "final"]),
}).strict();

const agencyEvent = z.object({
  name: z.enum([
    "agency_registration_completed",
    "first_property_published",
    "public_link_copied",
    "first_applicant_reviewed",
    "whatsapp_contact_initiated",
    "viewing_scheduled",
    "trial_converted_to_paid",
  ]),
}).strict();

const trialEvent = z.object({ name: z.literal("trial_activated"), plan: z.enum(["particular", "professional", "inmobiliaria"]) }).strict();
const tenantEvent = z.object({
  name: z.enum(["tenant_account_created", "application_started", "application_completed"]),
}).strict();

export const analyticsEventInput = z.union([marketingEvent, agencyEvent, trialEvent, tenantEvent]);
export type AnalyticsEventInput = z.infer<typeof analyticsEventInput>;

export type AnalyticsActor =
  | { type: "anonymous" }
  | { type: "agency"; userId: string; agencyId: string; isAdmin: boolean }
  | { type: "tenant"; userId: string };

const agencyNames = new Set([
  "agency_registration_completed",
  "first_property_published",
  "public_link_copied",
  "first_applicant_reviewed",
  "whatsapp_contact_initiated",
  "viewing_scheduled",
  "trial_converted_to_paid",
  "trial_activated",
]);
const tenantNames = new Set(["tenant_account_created", "application_started", "application_completed"]);

export class AnalyticsAuthorizationError extends Error {}

/** The fixed event union and scalar storage columns reject free text and PII-like fields. */
export async function recordAnalyticsEvent(
  db: Database,
  rawInput: unknown,
  actor: AnalyticsActor,
  occurredAt: Date = new Date(),
): Promise<void> {
  const input = analyticsEventInput.parse(rawInput);
  if (input.name === "marketing_cta_clicked") {
    if (actor.type !== "anonymous") throw new AnalyticsAuthorizationError();
  } else if (agencyNames.has(input.name)) {
    if (actor.type !== "agency") throw new AnalyticsAuthorizationError();
    if ((input.name === "trial_activated" || input.name === "trial_converted_to_paid") && !actor.isAdmin) {
      throw new AnalyticsAuthorizationError();
    }
  } else if (tenantNames.has(input.name) && actor.type !== "tenant") {
    throw new AnalyticsAuthorizationError();
  }

  await db.insert(analyticsEvents).values({
    id: newId(),
    agencyId: actor.type === "agency" ? actor.agencyId : null,
    actorUserId: actor.type === "anonymous" ? null : actor.userId,
    eventName: input.name,
    placement: "placement" in input ? input.placement : null,
    plan: "plan" in input ? input.plan : null,
    occurredAt,
  });
}

export async function agencyAnalyticsSummary(db: Database, agencyId: string) {
  return db.select({ eventName: analyticsEvents.eventName, count: count() })
    .from(analyticsEvents)
    .where(eq(analyticsEvents.agencyId, agencyId))
    .groupBy(analyticsEvents.eventName);
}
