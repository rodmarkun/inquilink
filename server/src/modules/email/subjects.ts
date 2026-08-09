import { and, eq, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { emailOutbox } from "../../db/schema.js";

export async function expireScheduledSubjectEmails(
  db: Database,
  subjectType: "appointment" | "subscription",
  subjectId: string,
  reason: "APPOINTMENT_CHANGED" | "SUBSCRIPTION_CHANGED",
): Promise<void> {
  await db.update(emailOutbox).set({
    state: "expired", recipient: "eliminado@inquilink.invalid", variables: {},
    claimToken: null, claimedAt: null, lastErrorCode: reason,
  }).where(and(
    eq(emailOutbox.subjectType, subjectType), eq(emailOutbox.subjectId, subjectId),
    or(eq(emailOutbox.state, "pending"), eq(emailOutbox.state, "processing")),
  ));
}
