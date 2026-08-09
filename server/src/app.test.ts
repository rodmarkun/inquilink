import { expect, it, vi } from "vitest";
import { validate } from "@readme/openapi-parser";
import { createTestApp } from "./test/test-app.js";

it("preserves Fastify payload-size errors as a Spanish 413 response", async () => {
  const context = await createTestApp({ BODY_LIMIT_BYTES: 1_000_000 });
  try {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/v1/auth/tenant/register",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ fullName: "x".repeat(1_100_000) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "El contenido enviado supera el tamaño permitido.",
    });
  } finally {
    await context.close();
  }
});

it("publishes request bodies, path parameters, and actual success statuses in OpenAPI", async () => {
  const context = await createTestApp();
  try {
    const response = await context.app.inject({ method: "GET", url: "/api/docs/json" });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    await expect(validate(document)).resolves.toBeTruthy();
    const registration = document.paths["/api/v1/auth/agency/register"].post;
    expect(registration.requestBody.content["application/json"].schema.required).toContain("email");
    expect(registration.responses).toHaveProperty("201");
    expect(registration.responses).not.toHaveProperty("200");
    const tenantRegistration = document.paths["/api/v1/auth/tenant/register"].post;
    expect(tenantRegistration.requestBody.content["application/json"].schema.required).toEqual(expect.arrayContaining(["termsAccepted", "termsVersion"]));
    expect(tenantRegistration.requestBody.content["application/json"].schema.properties.termsAccepted).toMatchObject({ const: true });
    const invitationAccept = document.paths["/api/v1/team/invitations/accept"].post;
    expect(invitationAccept.requestBody.content["application/json"].schema.oneOf).toEqual([
      expect.objectContaining({ required: ["token"] }),
      expect.objectContaining({ required: ["token", "fullName", "password", "termsAccepted"] }),
    ]);
    const accountClose = document.paths["/api/v1/account/close"].post;
    expect(accountClose.requestBody.content["application/json"].schema.required).toEqual(["confirmation"]);
    expect(accountClose.responses).toHaveProperty("202");
    expect(accountClose.responses).not.toHaveProperty("200");
    const property = document.paths["/api/v1/agency/properties/{propertyId}"].patch;
    expect(property.requestBody.content["application/json"].schema.properties).toHaveProperty("title");
    expect(property.parameters).toContainEqual(expect.objectContaining({ in: "path", name: "propertyId", required: true }));
    expect(document.components.securitySchemes.sessionCookie).toMatchObject({ type: "apiKey", in: "cookie", name: "inquilink_session" });
    expect(document.components.securitySchemes.documentBearer).toMatchObject({ type: "http", scheme: "bearer" });

    const applicantList = document.paths["/api/v1/agency/properties/{propertyId}/applications"].get;
    expect(applicantList.parameters.filter((parameter: { in: string }) => parameter.in === "query").map((parameter: { name: string }) => parameter.name))
      .toEqual(expect.arrayContaining(["search", "status", "documentState", "viewingState", "responsibleUserId", "submittedFrom", "submittedTo", "sort"]));
    const appointmentCreate = document.paths["/api/v1/agency/appointments"].post;
    expect(appointmentCreate.parameters).toContainEqual(expect.objectContaining({ in: "header", name: "Idempotency-Key", required: true }));
    expect(appointmentCreate.responses).toHaveProperty("200");
    expect(appointmentCreate.responses).toHaveProperty("201");
    const documentContent = document.paths["/api/v1/documents/{documentId}/content"].get;
    expect(documentContent.security).toEqual([{ sessionCookie: [], documentBearer: [] }]);
    expect(documentContent.responses["200"].content["application/pdf"].schema).toMatchObject({ type: "string", format: "binary" });
    expect(documentContent.responses).toHaveProperty("423");
    expect(documentContent.responses).toHaveProperty("503");

    for (const [path, pathItem] of Object.entries(document.paths) as Array<[string, Record<string, Record<string, unknown>>]>) {
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(operation, `${method.toUpperCase()} ${path} must declare security`).toHaveProperty("security");
        const responses = operation.responses as Record<string, { content?: unknown }>;
        const success = Object.entries(responses).find(([status]) => /^2\d\d$/.test(status));
        expect(success, `${method.toUpperCase()} ${path} must document a success response`).toBeTruthy();
        if (success?.[0] !== "204") expect(success?.[1].content, `${method.toUpperCase()} ${path} success must define content`).toBeTruthy();
        for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])) {
          expect(operation.parameters, `${method.toUpperCase()} ${path} must document ${name}`).toContainEqual(expect.objectContaining({ in: "path", name, required: true }));
        }
      }
    }
  } finally {
    await context.close();
  }
});

it("never logs bearer links, query strings, or token-bearing request bodies", async () => {
  const chunks: string[] = [];
  const context = await createTestApp({ LOG_LEVEL: "info" }, undefined, { loggerStream: { write: (chunk) => { chunks.push(chunk); } } });
  const canaries = {
    publicLink: "PUBLIC_LINK_CANARY_1234567890",
    query: "QUERY_TOKEN_CANARY_1234567890",
    verify: "VERIFY_TOKEN_CANARY_1234567890",
    reset: "RESET_TOKEN_CANARY_1234567890",
    invite: "INVITE_TOKEN_CANARY_1234567890",
  };
  try {
    await context.app.inject({ method: "GET", url: `/api/v1/public/properties/${canaries.publicLink}` });
    await context.app.inject({ method: "GET", url: `/api/v1/health?token=${canaries.query}&returnPath=/solicitud/${canaries.publicLink}` });
    await context.app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token: canaries.verify } });
    await context.app.inject({ method: "POST", url: "/api/v1/auth/reset-password", payload: { token: canaries.reset, password: "contraseña-segura" } });
    await context.app.inject({ method: "POST", url: "/api/v1/team/invitations/accept", payload: { token: canaries.invite } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const logs = chunks.join("");
    for (const canary of Object.values(canaries)) expect(logs).not.toContain(canary);
    expect(logs).not.toContain("returnPath");
    expect(logs).toContain("method");
  } finally {
    await context.close();
  }
});

it("keeps liveness up but reports readiness failure when PostgreSQL is unavailable", async () => {
  const context = await createTestApp();
  try {
    expect((await context.app.inject({ method: "GET", url: "/api/v1/health" })).statusCode).toBe(200);
    vi.spyOn(context.db, "execute").mockRejectedValueOnce(new Error("database unavailable"));
    const readiness = await context.app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({ error: { code: "SERVICE_NOT_READY", message: "El servicio no está listo para atender solicitudes." } });
    expect(readiness.json().requestId).toEqual(expect.any(String));
  } finally {
    await context.close();
  }
});
