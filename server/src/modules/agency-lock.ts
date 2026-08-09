import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { agencies } from "../db/schema.js";
import { agencyMemberships } from "../db/schema.js";
import { ApiError } from "../lib/errors.js";

/** First lock for every agency-side write transaction; fences account closure. */
export async function lockActiveAgency(
  db: Database,
  agencyId: string,
  authorization?: { userId: string; requiredRole?: "admin" },
): Promise<void> {
  const rows = await db.select({ accountState: agencies.accountState }).from(agencies)
    .where(eq(agencies.id, agencyId)).for("update").limit(1);
  if (rows[0]?.accountState !== "active") {
    throw new ApiError(409, "AGENCY_CLOSURE_IN_PROGRESS", "La agencia está en proceso de cierre y ya no admite cambios.");
  }
  if (authorization) {
    const memberships = await db.select({ role: agencyMemberships.role }).from(agencyMemberships).where(and(
      eq(agencyMemberships.agencyId, agencyId), eq(agencyMemberships.userId, authorization.userId),
    )).for("share").limit(1);
    if (!memberships[0] || (authorization.requiredRole === "admin" && memberships[0].role !== "admin")) {
      throw new ApiError(403, "AGENCY_ACCESS_CHANGED", "Tu acceso o permisos en esta agencia han cambiado. Actualiza la sesión e inténtalo de nuevo.");
    }
  }
}

/** Internal saga finalizers must finish after external success even if caller access changed. */
export async function lockAgencyForSystem(db: Database, agencyId: string): Promise<void> {
  const rows = await db.select({ id: agencies.id }).from(agencies).where(eq(agencies.id, agencyId)).for("update").limit(1);
  if (!rows[0]) throw new ApiError(409, "AGENCY_NOT_AVAILABLE", "La agencia ya no está disponible.");
}
