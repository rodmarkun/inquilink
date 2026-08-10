import cookie from "@fastify/cookie";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { registerSessionAuth } from "./auth/session.js";
import { ApiError, registerErrorHandler } from "./lib/errors.js";
import { registerScopedAccessRoutes } from "./modules/access/routes.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { registerBillingRoutes } from "./modules/billing/routes.js";
import { registerRentalRoutes } from "./modules/rentals/routes.js";
import { registerOperationalRoutes } from "./modules/operations/routes.js";
import { registerPropertyImageRoutes } from "./modules/property-images/routes.js";
import type { AppDependencies } from "./types.js";
import { enrichOpenApi } from "./openapi.js";
import type { RentalRouteOptions } from "./modules/rentals/routes.js";
import { trustedProxyRanges } from "./config.js";
import { sql } from "drizzle-orm";

export function safeRequestLog(request: { method?: unknown; routeOptions?: { url?: unknown } }): { method: string; route?: string } {
  const method = typeof request.method === "string" ? request.method : "UNKNOWN";
  const route = typeof request.routeOptions?.url === "string" && !request.routeOptions.url.includes(":token")
    ? request.routeOptions.url
    : undefined;
  return { method, ...(route ? { route } : {}) };
}

export async function buildApp(deps: AppDependencies, options: { rentals?: RentalRouteOptions; loggerStream?: { write(chunk: string): void } } = {}) {
  const trustedProxies = trustedProxyRanges(deps.config);
  const app = Fastify({
    bodyLimit: deps.config.BODY_LIMIT_BYTES,
    ajv: { customOptions: { removeAdditional: false } },
    logger: deps.config.LOG_LEVEL === "silent" ? false : {
      level: deps.config.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie", "password", "token", "paymentMethodToken"],
      serializers: { req: safeRequestLog },
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
    },
    // Forwarded client addresses influence authentication throttling, so only
    // explicitly configured reverse proxies may supply them.
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });

  await app.register(cookie);
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Inquilink API", version: "0.1.0", description: "API del portal de solicitudes de alquiler de Inquilink." },
      servers: [{ url: "/" }],
      tags: [
        { name: "Sistema" }, { name: "Autenticación" }, { name: "Agencia" },
        { name: "Inquilinos" }, { name: "Facturación" },
        { name: "Panel" }, { name: "Equipo" }, { name: "Configuración" }, { name: "Analítica" },
      ],
    },
    transformObject: (document) => "openapiObject" in document
      ? enrichOpenApi(document.openapiObject as unknown as Record<string, unknown>)
      : document.swaggerObject,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  registerErrorHandler(app);
  registerSessionAuth(app, deps);
  app.get("/api/v1/health", {
    schema: { tags: ["Sistema"], summary: "Comprobar el estado del servicio" },
  }, async () => ({ status: "ok", service: "inquilink-api", timestamp: (deps.now ?? (() => new Date()))().toISOString() }));
  app.get("/api/v1/ready", {
    schema: { tags: ["Sistema"], summary: "Comprobar que el servicio puede atender tráfico" },
  }, async () => {
    try {
      await deps.db.execute(sql`select 1`);
      return { status: "ok", service: "inquilink-api", timestamp: (deps.now ?? (() => new Date()))().toISOString() };
    } catch {
      throw new ApiError(503, "SERVICE_NOT_READY", "El servicio no está listo para atender solicitudes.");
    }
  });
  registerAuthRoutes(app, deps);
  registerBillingRoutes(app, deps);
  registerScopedAccessRoutes(app, deps);
  registerRentalRoutes(app, deps, options.rentals);
  registerPropertyImageRoutes(app, deps, options.rentals);
  registerOperationalRoutes(app, deps);

  return app;
}
