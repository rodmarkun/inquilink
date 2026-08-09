import type { FastifyInstance } from "fastify";
import { requireAgency } from "../../auth/session.js";
import { ApiError } from "../../lib/errors.js";
import type { AppDependencies } from "../../types.js";
import { agencyAnalyticsSummary, AnalyticsAuthorizationError, recordAnalyticsEvent, type AnalyticsActor } from "./service.js";
import { lockActiveAgency } from "../agency-lock.js";

export function registerAnalyticsRoutes(app: FastifyInstance, deps: AppDependencies): void {
  app.post("/api/v1/analytics/events", {
    schema: {
      tags: ["Analítica"], summary: "Registrar un evento esencial sin datos personales",
      body: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", enum: ["marketing_cta_clicked", "agency_registration_completed", "tenant_account_created", "trial_activated", "first_property_published", "public_link_copied", "application_started", "application_completed", "first_applicant_reviewed", "whatsapp_contact_initiated", "viewing_scheduled", "trial_converted_to_paid"] },
          placement: { type: "string", enum: ["hero", "pricing", "final"] },
          plan: { type: "string", enum: ["particular", "professional", "inmobiliaria"] },
        },
      },
    },
    preValidation: async (request) => {
      if (typeof request.body !== "object" || request.body === null || Array.isArray(request.body)) return;
      const allowed = new Set(["name", "placement", "plan"]);
      if (Object.keys(request.body).some((key) => !allowed.has(key))) {
        throw new ApiError(400, "ANALYTICS_PAYLOAD_REJECTED", "El evento contiene campos no permitidos.");
      }
    },
  }, async (request, reply) => {
    let actor: AnalyticsActor;
    if (!request.currentUser) actor = { type: "anonymous" };
    else if (request.currentUser.kind === "tenant") actor = { type: "tenant", userId: request.currentUser.id };
    else if (request.currentAgency) actor = { type: "agency", userId: request.currentUser.id, agencyId: request.currentAgency.id, isAdmin: request.currentAgency.role === "admin" };
    else throw new ApiError(403, "ANALYTICS_EVENT_NOT_ALLOWED", "No se puede registrar este evento con la sesión actual.");

    try {
      const occurredAt = (deps.now ?? (() => new Date()))();
      if (actor.type === "agency") {
        await deps.db.transaction(async (tx) => {
          await lockActiveAgency(tx as unknown as AppDependencies["db"], actor.agencyId, { userId: actor.userId });
          await recordAnalyticsEvent(tx as unknown as AppDependencies["db"], request.body, actor, occurredAt);
        });
      } else await recordAnalyticsEvent(deps.db, request.body, actor, occurredAt);
    } catch (error) {
      if (error instanceof AnalyticsAuthorizationError) throw new ApiError(403, "ANALYTICS_EVENT_NOT_ALLOWED", "No se puede registrar este evento con la sesión actual.");
      throw error;
    }
    return reply.status(202).send({ data: { accepted: true } });
  });

  app.get("/api/v1/agency/analytics/summary", {
    schema: { tags: ["Analítica"], summary: "Consultar métricas esenciales del espacio actual" },
  }, async (request) => {
    const { agency } = requireAgency(request);
    const rows = await agencyAnalyticsSummary(deps.db, agency.id);
    return { data: { events: rows.map((row) => ({ name: row.eventName, count: Number(row.count) })) } };
  });
}
