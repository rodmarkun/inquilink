import { validate } from "@readme/openapi-parser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestApp } from "./test/test-app.js";

let context: Awaited<ReturnType<typeof createTestApp>>;

beforeEach(async () => { context = await createTestApp(); });
afterEach(async () => context.close());

it("generates a valid OpenAPI 3.1 contract for operational workflows", async () => {
  await context.app.ready();
  const document = context.app.swagger() as Record<string, any>;
  expect(document.openapi).toBe("3.1.0");
  await expect(validate(document)).resolves.toBeTruthy();

  const agencyRegistration = document.paths["/api/v1/auth/agency/register"].post.requestBody.content["application/json"].schema;
  expect(agencyRegistration.required).toEqual(expect.arrayContaining(["termsAccepted", "termsVersion"]));
  expect(agencyRegistration.properties.termsAccepted.const).toBe(true);
  expect(agencyRegistration.properties.termsVersion.const).toBe("terms-2026-08-v1");
  expect(agencyRegistration.properties.password).toMatchObject({ minLength: 10, maxLength: 200 });

  const invitation = document.paths["/api/v1/agency/team/invitations"].post;
  expect(invitation.parameters.filter((parameter: any) => parameter.in === "header" && String(parameter.name).toLowerCase() === "idempotency-key")).toHaveLength(1);
  expect(invitation.requestBody.content["application/json"].schema.required).toContain("email");
  expect(document.paths["/api/v1/team/invitations/accept"].post.requestBody.content["application/json"].schema.oneOf).toHaveLength(2);

  const close = document.paths["/api/v1/account/close"].post;
  expect(close.responses).toHaveProperty("202");
  expect(close.requestBody.content["application/json"].schema.properties.confirmation.const).toBe("CERRAR MI CUENTA");
  expect(document.paths["/api/v1/billing/trial"].post.responses).not.toHaveProperty("200");
  expect(document.paths["/api/v1/billing/trial"].post.requestBody.content["application/json"].schema.properties.paymentMethodToken.pattern).toBe("^pm_[A-Za-z0-9_-]{4,}$");
  expect(document.paths["/api/v1/billing/payment-method"].patch.requestBody.content["application/json"].schema.properties.paymentMethodToken.pattern).toBe("^pm_[A-Za-z0-9_-]{4,}$");
  const billingStatus = document.paths["/api/v1/billing/status"].get;
  expect(billingStatus.responses["200"].content["application/json"].schema.properties.data.properties)
    .toEqual(expect.objectContaining({ subscription: expect.any(Object), prices: expect.any(Object), allowances: expect.any(Object), currency: expect.any(Object), trialDays: expect.any(Object) }));
  const billingData = billingStatus.responses["200"].content["application/json"].schema.properties.data.properties;
  expect(billingData.prices.properties).toEqual(expect.objectContaining({ particular: { type: "integer", const: 999 }, professional: { type: "integer", const: 4999 }, inmobiliaria: { type: "integer", const: 9999 } }));
  expect(document.paths["/api/v1/billing/trial"].post.requestBody.content["application/json"].schema.properties.plan.enum)
    .toEqual(["particular", "professional", "inmobiliaria"]);
  expect(billingStatus.responses).not.toHaveProperty("410");
  expect(document.paths["/api/v1/billing/invoices"].get.responses["200"].content["application/json"].schema.properties.data.properties.invoices.items.properties)
    .toEqual(expect.objectContaining({ id: expect.any(Object), amountCents: expect.any(Object), status: expect.any(Object), issuedAt: expect.any(Object) }));

  const dashboard = document.paths["/api/v1/agency/dashboard"].get.responses["200"].content["application/json"].schema.properties.data;
  expect(Object.keys(dashboard.properties).sort()).toEqual(["newApplicants", "upcomingViewings"]);
  expect(document.paths["/api/v1/agency/team"].get.responses["200"].content["application/json"].schema.properties.data.properties.members.items.required)
    .toEqual(["userId", "fullName", "email", "role", "joinedAt"]);
  expect(document.paths["/api/v1/account/profile"].get.responses["200"].content["application/json"].schema.properties.data.properties.profile.required)
    .toEqual(["id", "fullName", "email", "accountType"]);
  expect(document.paths["/api/v1/agency/settings"].get.responses["200"].content["application/json"].schema.properties.data.properties.agency.required)
    .toContain("timezone");
  const invitationAccept = document.paths["/api/v1/team/invitations/accept"].post;
  expect(Object.keys(invitationAccept.responses).sort()).toEqual(["200", "400", "409", "429", "500"]);
  expect(invitationAccept.responses["200"].content["application/json"].schema.properties.data.required)
    .toEqual(["accepted", "agencyId", "message"]);
  const meUser = document.paths["/api/v1/auth/me"].get.responses["200"].content["application/json"].schema.properties.data.properties.user;
  expect(meUser.required).toContain("emailVerified");
  expect(Object.keys(document.paths["/api/v1/auth/login"].post.responses)).toContain("403");
  expect(Object.keys(document.paths["/api/v1/auth/verify-email"].post.responses)).toContain("403");
  expect(document.paths["/api/v1/auth/verify-email"].post.responses).not.toHaveProperty("409");
  expect(document.paths["/api/v1/auth/reset-password"].post.responses).not.toHaveProperty("409");
  expect(document.paths["/api/v1/auth/reset-password"].post.responses).not.toHaveProperty("429");
  expect(document.paths["/api/v1/public/properties/{token}"].get.responses).toHaveProperty("410");
  expect(document.paths["/api/v1/tenant/application-drafts/by-link/{token}"].get.responses).toHaveProperty("410");
  expect(document.paths["/api/v1/tenant/application-drafts/by-link/{token}"].put.responses).toHaveProperty("410");
  expect(document.paths["/api/v1/tenant/applications/by-link/{token}/submit"].post.responses).toHaveProperty("410");
  const tenantApplications = document.paths["/api/v1/tenant/applications"].get;
  expect(Object.keys(tenantApplications.responses).sort()).toEqual(["200", "401", "403", "500"]);
  const tenantApplicationItem = tenantApplications.responses["200"].content["application/json"].schema.properties.data.properties.applications.items;
  expect(tenantApplicationItem.required).toEqual(["application", "property"]);
  expect(tenantApplicationItem.properties.application.required).toEqual(["id", "status", "documentState", "submittedAt", "updatedAt"]);
  expect(tenantApplicationItem.properties.application.properties.status.enum).toEqual(["new", "preselected", "selected", "rejected", "withdrawn"]);
  expect(tenantApplicationItem.properties.application.properties.documentState.enum).toEqual(["complete", "missing", "not_requested"]);
  expect(tenantApplicationItem.properties.application.properties.submittedAt.type).toEqual(["string", "null"]);
  expect(tenantApplicationItem.properties.property.required).toEqual(["id", "title", "publicLocation", "coverImageUrl"]);
  const propertyCreate = document.paths["/api/v1/agency/properties"].post.requestBody.content["application/json"].schema;
  expect(propertyCreate.properties.monthlyRentCents).toMatchObject({ minimum: 1, maximum: 100000000 });
  expect(propertyCreate.properties.requestedDocumentCategories.items.enum).toEqual(["payslips", "employment_contract", "self_employed_income", "supporting"]);
  const appointment = document.paths["/api/v1/agency/appointments"].post.requestBody.content["application/json"].schema;
  expect(appointment.properties.durationMinutes).toMatchObject({ minimum: 15, maximum: 480 });
  const application = document.paths["/api/v1/tenant/applications/by-link/{token}/submit"].post.requestBody.content["application/json"].schema.properties.application;
  expect(application.properties.phone.pattern).toBe("^\\+[1-9]\\d{7,14}$");
  expect(application.properties.viewingAvailability).toMatchObject({ minItems: 1, maxItems: 20 });
  expect(document.paths["/api/v1/analytics/events"].post.security).toEqual([{}, { sessionCookie: [] }]);
  const propertyIdParameter = document.paths["/api/v1/agency/properties/{propertyId}"].patch.parameters
    .find((parameter: any) => parameter.in === "path" && parameter.name === "propertyId");
  expect(propertyIdParameter.schema).toEqual({ type: "string", format: "uuid" });
  expect(document.paths["/api/v1/agency/analytics/summary"].get.parameters ?? []).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ in: "query", name: "from" }),
  ]));
});
