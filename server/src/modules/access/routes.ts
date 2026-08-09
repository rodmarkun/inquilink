import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAgency, requireTenant } from "../../auth/session.js";
import { applications, properties } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import type { AppDependencies } from "../../types.js";

export function registerScopedAccessRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.get("/api/v1/agency/properties/:propertyId", { schema: { tags: ["Agencia"], summary: "Consultar un anuncio del espacio actual" } }, async (request) => {
    const { agency } = requireAgency(request);
    const { propertyId } = z.object({ propertyId: z.string().uuid() }).parse(request.params);
    // The agency scope is intentionally part of the SQL predicate, never a post-query check.
    const rows = await deps.db.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).limit(1);
    if (!rows[0]) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");
    const { publicLinkTokenHash: _publicLinkTokenHash, publicLinkTokenCiphertext: _publicLinkTokenCiphertext, ...safeProperty } = rows[0];
    return { data: { property: safeProperty } };
  });

  app.get("/api/v1/tenant/applications/:applicationId", { schema: { tags: ["Inquilinos"], summary: "Consultar una solicitud propia" } }, async (request) => {
    const tenant = requireTenant(request);
    const { applicationId } = z.object({ applicationId: z.string().uuid() }).parse(request.params);
    const rows = await deps.db.select().from(applications).where(and(eq(applications.id, applicationId), eq(applications.tenantUserId, tenant.id))).limit(1);
    if (!rows[0]) throw new ApiError(404, "APPLICATION_NOT_FOUND", "No se ha encontrado la solicitud.");
    const { sourceLinkTokenHash: _sourceLinkTokenHash, submissionKeyHash: _submissionKeyHash, ...safeApplication } = rows[0];
    return { data: { application: safeApplication } };
  });
}
