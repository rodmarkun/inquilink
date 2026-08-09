import { and, eq, gte, lte } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agencies, agencyMemberships, appointments, properties, subscriptions, users } from "../../db/schema.js";
import type { EmailProvider } from "./provider.js";

/**
 * Reconciles time/state-driven notifications into the durable outbox. Stable
 * dedupe keys make the command safe to run repeatedly or from several schedulers.
 */
export async function enqueueScheduledNotifications(
  db: Database,
  emailProvider: EmailProvider,
  now: Date = new Date(),
): Promise<{ viewingReminders: number; trialEnding: number; paymentFailures: number; failed: number }> {
  const result = { viewingReminders: 0, trialEnding: 0, paymentFailures: 0, failed: 0 };
  const next24Hours = new Date(now.getTime() + 24 * 60 * 60_000);
  const next3Days = new Date(now.getTime() + 3 * 86_400_000);

  const reminders = await db.select({
    appointmentId: appointments.id,
    agencyId: appointments.agencyId,
    startsAt: appointments.startsAt,
    propertyTitle: properties.title,
    recipient: users.email,
    recipientUserId: users.id,
  }).from(appointments)
    .innerJoin(users, eq(users.id, appointments.responsibleUserId))
    .innerJoin(agencies, eq(agencies.id, appointments.agencyId))
    .innerJoin(properties, and(eq(properties.id, appointments.propertyId), eq(properties.agencyId, appointments.agencyId)))
    .where(and(eq(appointments.state, "scheduled"), eq(users.accountState, "active"), eq(agencies.accountState, "active"), gte(appointments.startsAt, now), lte(appointments.startsAt, next24Hours)));
  for (const reminder of reminders) {
    try { await emailProvider.send({
      agencyId: reminder.agencyId,
      userId: reminder.recipientUserId,
      subjectType: "appointment",
      subjectId: reminder.appointmentId,
      recipient: reminder.recipient,
      template: "viewing_reminder",
      variables: { startsAt: reminder.startsAt.toISOString(), propertyTitle: reminder.propertyTitle },
      dedupeKey: `viewing-reminder:${reminder.appointmentId}:${reminder.startsAt.toISOString()}`,
      expiresAt: reminder.startsAt,
    }); result.viewingReminders += 1; } catch { result.failed += 1; }
  }

  const trialRows = await db.select({
    subscriptionId: subscriptions.id,
    agencyId: subscriptions.agencyId,
    trialEndsAt: subscriptions.trialEndsAt,
    plan: subscriptions.plan,
    recipient: users.email,
    recipientUserId: users.id,
  }).from(subscriptions)
    .innerJoin(agencyMemberships, and(eq(agencyMemberships.agencyId, subscriptions.agencyId), eq(agencyMemberships.role, "admin")))
    .innerJoin(users, eq(users.id, agencyMemberships.userId))
    .innerJoin(agencies, eq(agencies.id, subscriptions.agencyId))
    .where(and(eq(subscriptions.state, "trialing"), eq(users.accountState, "active"), eq(agencies.accountState, "active"), gte(subscriptions.trialEndsAt, now), lte(subscriptions.trialEndsAt, next3Days)));
  for (const trial of trialRows) {
    if (!trial.trialEndsAt) continue;
    try { await emailProvider.send({
      agencyId: trial.agencyId,
      userId: trial.recipientUserId,
      subjectType: "subscription",
      subjectId: trial.subscriptionId,
      recipient: trial.recipient,
      template: "trial_ending",
      variables: { trialEndsAt: trial.trialEndsAt.toISOString(), plan: trial.plan },
      dedupeKey: `trial-ending:${trial.subscriptionId}:${trial.recipientUserId}:${trial.trialEndsAt.toISOString()}`,
      expiresAt: trial.trialEndsAt,
    }); result.trialEnding += 1; } catch { result.failed += 1; }
  }

  const failureRows = await db.select({
    subscriptionId: subscriptions.id,
    agencyId: subscriptions.agencyId,
    currentPeriodEndsAt: subscriptions.currentPeriodEndsAt,
    recipient: users.email,
    recipientUserId: users.id,
  }).from(subscriptions)
    .innerJoin(agencyMemberships, and(eq(agencyMemberships.agencyId, subscriptions.agencyId), eq(agencyMemberships.role, "admin")))
    .innerJoin(users, eq(users.id, agencyMemberships.userId))
    .innerJoin(agencies, eq(agencies.id, subscriptions.agencyId))
    .where(and(eq(subscriptions.state, "past_due"), eq(users.accountState, "active"), eq(agencies.accountState, "active")));
  for (const failure of failureRows) {
    try { await emailProvider.send({
      agencyId: failure.agencyId,
      userId: failure.recipientUserId,
      subjectType: "subscription",
      subjectId: failure.subscriptionId,
      recipient: failure.recipient,
      template: "payment_failure",
      variables: { billingPath: "/app/facturacion" },
      dedupeKey: `payment-failure:${failure.subscriptionId}:${failure.recipientUserId}:${failure.currentPeriodEndsAt?.toISOString() ?? "current"}`,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    }); result.paymentFailures += 1; } catch { result.failed += 1; }
  }
  return result;
}
