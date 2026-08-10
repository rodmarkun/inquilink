import argon2 from "argon2";
import { and, asc, count, desc, eq, gt, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAgency, requireUser } from "../../auth/session.js";
import {
  agencies,
  agencyInvitationOperations,
  agencyInvitations,
  agencyMemberships,
  applications,
  appointments,
  emailOutbox,
  properties,
  users,
} from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { hashSecret, newId, newSecret } from "../../lib/ids.js";
import type { AppDependencies } from "../../types.js";
import { registerAnalyticsRoutes } from "../analytics/routes.js";
import { enqueueEmail } from "../email/provider.js";
import { lockActiveAgency } from "../agency-lock.js";
import { enforceAuthRateLimits } from "../../auth/rate-limit.js";
import { CURRENT_ACCOUNT_TERMS_VERSION } from "../auth/routes.js";
import { enforceInvitationAcceptanceAllowance, enforceInvitationCreationAllowance } from "../plan-allowances.js";

const uuidParams = z.object({ userId: z.string().uuid() });
const invitationParams = z.object({ invitationId: z.string().uuid() });
const roleInput = z.object({ role: z.enum(["admin", "collaborator"]) }).strict();
const dashboardTrendQuery = z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") });
const dashboardTrendDays = { "7d": 7, "30d": 30, "90d": 90 } as const;
const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function pagination(page: number, pageSize: number, total: number) {
  const totalPages = Math.ceil(total / pageSize);
  return { page, pageSize, total, totalPages, hasMore: page < totalPages };
}

const bodySchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object", additionalProperties: false, ...(required.length ? { required } : {}), properties,
});

function invalidInvitation(): ApiError {
  return new ApiError(400, "INVITATION_INVALID", "La invitación no es válida, ya se ha usado o ha caducado.");
}

function operationKey(request: { headers: Record<string, unknown> }): string {
  return z.string().trim().min(16).max(200).regex(/^[\x21-\x7E]+$/).parse(request.headers["idempotency-key"]);
}

function databaseConstraintCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

async function expireInvitationEmails(
  db: AppDependencies["db"],
  invitationId: string,
  at: Date,
  reason: "INVITATION_SUPERSEDED" | "INVITATION_REVOKED" | "INVITATION_ACCEPTED",
): Promise<void> {
  await db.update(emailOutbox).set({
    state: "expired",
    recipient: "eliminado@inquilink.invalid",
    variables: {},
    claimToken: null,
    claimedAt: null,
    lastErrorCode: reason,
  }).where(and(
    eq(emailOutbox.subjectType, "team_invitation"),
    eq(emailOutbox.subjectId, invitationId),
    or(eq(emailOutbox.state, "pending"), eq(emailOutbox.state, "processing")),
  ));
}

export function registerOperationalRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const now = deps.now ?? (() => new Date());
  registerAnalyticsRoutes(app, deps);

  app.get("/api/v1/agency/dashboard", {
    schema: { tags: ["Agencia"], summary: "Consultar nuevos interesados y próximas visitas" },
  }, async (request) => {
    const { agency } = requireAgency(request);
    const current = now();
    const last30Days = new Date(current.getTime() - 30 * 86_400_000);
    const applicantScope = and(
      eq(applications.agencyId, agency.id),
      eq(applications.status, "new"),
      isNotNull(applications.submittedAt),
      gte(applications.submittedAt, last30Days),
    );
    const [countRows, applicantRows, viewingRows, topPropertyRows] = await Promise.all([
      deps.db.select({ value: count() }).from(applications).where(applicantScope),
      deps.db.select({
        applicationId: applications.id,
        propertyId: applications.propertyId,
        applicantName: users.fullName,
        propertyTitle: properties.title,
        submittedAt: applications.submittedAt,
      }).from(applications)
        .innerJoin(users, eq(users.id, applications.tenantUserId))
        .innerJoin(properties, and(eq(properties.id, applications.propertyId), eq(properties.agencyId, agency.id)))
        .where(applicantScope).orderBy(desc(applications.submittedAt)).limit(5),
      deps.db.select({
        appointmentId: appointments.id,
        applicationId: appointments.applicationId,
        propertyId: appointments.propertyId,
        applicantName: users.fullName,
        propertyTitle: properties.title,
        startsAt: appointments.startsAt,
        durationMinutes: appointments.durationMinutes,
      }).from(appointments)
        .innerJoin(applications, and(eq(applications.id, appointments.applicationId), eq(applications.agencyId, agency.id)))
        .innerJoin(users, eq(users.id, applications.tenantUserId))
        .innerJoin(properties, and(eq(properties.id, appointments.propertyId), eq(properties.agencyId, agency.id)))
        .where(and(eq(appointments.agencyId, agency.id), eq(appointments.state, "scheduled"), gte(appointments.startsAt, current)))
        .orderBy(asc(appointments.startsAt)).limit(3),
      deps.db.select({
        propertyId: properties.id,
        internalReference: properties.internalReference,
        title: properties.title,
        city: properties.city,
        coverImageUrl: properties.coverImageUrl,
        applicantCount: count(applications.id),
      }).from(properties)
        .innerJoin(applications, and(
          eq(applications.propertyId, properties.id),
          eq(applications.agencyId, agency.id),
          isNotNull(applications.submittedAt),
        ))
        .where(eq(properties.agencyId, agency.id))
        .groupBy(properties.id)
        .orderBy(desc(count(applications.id)), asc(properties.title))
        .limit(3),
    ]);
    return {
      data: {
        newApplicants: {
          count: Number(countRows[0]?.value ?? 0),
          periodDays: 30,
          href: "/app/anuncios?estado=Nuevo",
          items: applicantRows.map((row) => ({ ...row, href: `/app/anuncios/${row.propertyId}/interesados/${row.applicationId}` })),
        },
        upcomingViewings: {
          href: "/app/citas?vista=proximas",
          items: viewingRows.map((row) => ({ ...row, href: `/app/citas/${row.appointmentId}` })),
        },
        topProperties: {
          href: "/app/anuncios",
          items: topPropertyRows.map((row) => ({
            ...row,
            applicantCount: Number(row.applicantCount),
            href: `/app/anuncios/${row.propertyId}`,
          })),
        },
      },
    };
  });

  app.get("/api/v1/agency/dashboard/applicant-trend", {
    schema: { tags: ["Agencia"], summary: "Consultar interesados recibidos por día" },
  }, async (request) => {
    const { agency } = requireAgency(request);
    const query = dashboardTrendQuery.parse(request.query);
    const periodDays = dashboardTrendDays[query.range];
    const current = now();
    const cutoff = new Date(current.getTime() - periodDays * 86_400_000);
    const dateExpression = sql<string>`to_char(timezone('Europe/Madrid', ${applications.submittedAt}), 'YYYY-MM-DD')`;
    const rows = await deps.db.select({
      date: dateExpression,
      propertyId: properties.id,
      internalReference: properties.internalReference,
      propertyTitle: properties.title,
      value: count(applications.id),
    }).from(applications)
      .innerJoin(properties, and(eq(properties.id, applications.propertyId), eq(properties.agencyId, agency.id)))
      .where(and(
        eq(applications.agencyId, agency.id),
        isNotNull(applications.submittedAt),
        gte(applications.submittedAt, cutoff),
        lte(applications.submittedAt, current),
      ))
      .groupBy(dateExpression, properties.id)
      .orderBy(asc(dateExpression), asc(properties.title));

    const madridDateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Madrid",
    }).format(date);
    const dateKeys = Array.from({ length: periodDays }, (_, index) =>
      madridDateKey(new Date(current.getTime() - (periodDays - index - 1) * 86_400_000)));
    const rowsByDate = new Map<string, typeof rows>();
    for (const row of rows) rowsByDate.set(row.date, [...(rowsByDate.get(row.date) ?? []), row]);

    return {
      data: {
        range: query.range,
        periodDays,
        items: dateKeys.map((date) => {
          const dayRows = rowsByDate.get(date) ?? [];
          return {
            date,
            total: dayRows.reduce((total, row) => total + Number(row.value), 0),
            properties: dayRows.map((row) => ({
              propertyId: row.propertyId,
              internalReference: row.internalReference,
              title: row.propertyTitle,
              count: Number(row.value),
              href: `/app/anuncios/${row.propertyId}`,
            })),
          };
        }),
      },
    };
  });

  app.get("/api/v1/agency/team", {
    schema: { tags: ["Equipo"], summary: "Listar el equipo del espacio actual" },
  }, async (request) => {
    const { agency } = requireAgency(request);
    const query = paginationQuery.parse(request.query);
    const totalRows = await deps.db.select({ total: count() }).from(agencyMemberships).where(eq(agencyMemberships.agencyId, agency.id));
    const total = totalRows[0]?.total ?? 0;
    const members = await deps.db.select({
      userId: users.id, fullName: users.fullName, email: users.email,
      role: agencyMemberships.role, joinedAt: agencyMemberships.createdAt,
    }).from(agencyMemberships)
      .innerJoin(users, eq(users.id, agencyMemberships.userId))
      .where(eq(agencyMemberships.agencyId, agency.id))
      .orderBy(asc(users.fullName), asc(users.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return { data: { members, pagination: pagination(query.page, query.pageSize, total) } };
  });

  app.get("/api/v1/agency/team/invitations", {
    schema: { tags: ["Equipo"], summary: "Listar invitaciones pendientes" },
  }, async (request) => {
    const { agency } = requireAdmin(request);
    const query = paginationQuery.parse(request.query);
    const clauses = and(
      eq(agencyInvitations.agencyId, agency.id), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt), gt(agencyInvitations.expiresAt, now()),
    );
    const totalRows = await deps.db.select({ total: count() }).from(agencyInvitations).where(clauses);
    const total = totalRows[0]?.total ?? 0;
    const rows = await deps.db.select({
      id: agencyInvitations.id, email: agencyInvitations.email, role: agencyInvitations.role,
      expiresAt: agencyInvitations.expiresAt, createdAt: agencyInvitations.createdAt,
    }).from(agencyInvitations).where(clauses).orderBy(desc(agencyInvitations.createdAt), asc(agencyInvitations.id))
      .limit(query.pageSize).offset((query.page - 1) * query.pageSize);
    return { data: { invitations: rows, pagination: pagination(query.page, query.pageSize, total) } };
  });

  app.post("/api/v1/agency/team/invitations", {
    schema: {
      tags: ["Equipo"], summary: "Invitar a un colaborador",
      headers: { type: "object", required: ["idempotency-key"], properties: { "idempotency-key": { type: "string", minLength: 16, maxLength: 200 } } },
      body: bodySchema({ email: { type: "string", format: "email", maxLength: 320 } }, ["email"]),
    },
  }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const { email: rawEmail } = z.object({ email: z.email().max(320) }).strict().parse(request.body);
    const email = rawEmail.toLowerCase();
    const key = operationKey(request);
    const keyHash = hashSecret(key);
    const fingerprint = hashSecret(email);
    const createdAt = now();
    const result = await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
      const previousOperations = await tx.select().from(agencyInvitationOperations).where(and(
        eq(agencyInvitationOperations.agencyId, agency.id), eq(agencyInvitationOperations.idempotencyKeyHash, keyHash),
      )).limit(1);
      if (previousOperations[0]) {
        if (previousOperations[0].requestFingerprint !== fingerprint) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Esta clave de idempotencia ya se utilizó con otros datos.");
        }
        return { ...previousOperations[0].response, expiresAt: new Date(previousOperations[0].response.expiresAt), replay: true, token: undefined };
      }
      const legacyInvitations = await tx.select({
        id: agencyInvitations.id, email: agencyInvitations.email, role: agencyInvitations.role, expiresAt: agencyInvitations.expiresAt,
      }).from(agencyInvitations).where(and(
        eq(agencyInvitations.agencyId, agency.id), eq(agencyInvitations.lastRequestKeyHash, keyHash),
      )).limit(1);
      if (legacyInvitations[0]) {
        if (legacyInvitations[0].email !== email) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Esta clave de idempotencia ya se utilizó con otros datos.");
        }
        const response = { email, role: legacyInvitations[0].role, expiresAt: legacyInvitations[0].expiresAt.toISOString() };
        await tx.insert(agencyInvitationOperations).values({
          id: newId(), agencyId: agency.id, idempotencyKeyHash: keyHash, requestFingerprint: fingerprint,
          invitationId: legacyInvitations[0].id, response, createdAt,
        }).onConflictDoNothing({ target: [agencyInvitationOperations.agencyId, agencyInvitationOperations.idempotencyKeyHash] });
        return { ...response, expiresAt: legacyInvitations[0].expiresAt, replay: true, token: undefined };
      }

      const existingMember = await tx.select({ id: users.id }).from(agencyMemberships)
        .innerJoin(users, eq(users.id, agencyMemberships.userId))
        .where(and(eq(agencyMemberships.agencyId, agency.id), eq(users.email, email))).limit(1);
      if (existingMember[0]) throw new ApiError(409, "MEMBER_ALREADY_EXISTS", "Esta persona ya pertenece al equipo.");

      await enforceInvitationCreationAllowance(tx as unknown as AppDependencies["db"], agency.id, email, createdAt);

      const supersededRows = await tx.select({ id: agencyInvitations.id }).from(agencyInvitations)
        .where(and(eq(agencyInvitations.agencyId, agency.id), eq(agencyInvitations.email, email))).limit(1);
      if (supersededRows[0]) {
        await expireInvitationEmails(tx as unknown as AppDependencies["db"], supersededRows[0].id, createdAt, "INVITATION_SUPERSEDED");
      }

      const token = newSecret();
      const invitation = {
        id: newId(), agencyId: agency.id, email, role: "collaborator" as const,
        tokenHash: hashSecret(token), invitedByUserId: user.id,
        lastRequestKeyHash: null,
        acceptedByUserId: null, acceptedAt: null, revokedAt: null,
        expiresAt: new Date(createdAt.getTime() + 7 * 86_400_000), createdAt, updatedAt: createdAt,
      };
      const saved = await tx.insert(agencyInvitations).values(invitation).onConflictDoUpdate({
        target: [agencyInvitations.agencyId, agencyInvitations.email],
        set: {
          tokenHash: invitation.tokenHash, role: invitation.role, invitedByUserId: user.id,
          lastRequestKeyHash: null,
          acceptedByUserId: null, acceptedAt: null, revokedAt: null,
          expiresAt: invitation.expiresAt, updatedAt: createdAt,
        },
      }).returning({ id: agencyInvitations.id, email: agencyInvitations.email, role: agencyInvitations.role, expiresAt: agencyInvitations.expiresAt });
      const operationId = newId();
      await tx.insert(agencyInvitationOperations).values({
        id: operationId, agencyId: agency.id, idempotencyKeyHash: keyHash, requestFingerprint: fingerprint,
        invitationId: saved[0]!.id,
        response: { email: saved[0]!.email, role: "collaborator", expiresAt: saved[0]!.expiresAt.toISOString() },
        createdAt,
      });
      await enqueueEmail(tx as unknown as Pick<AppDependencies["db"], "insert">, {
        agencyId: agency.id,
        subjectType: "team_invitation",
        subjectId: saved[0]!.id,
        recipient: email, template: "team_invitation", variables: { token, agencyName: agency.name }, dedupeKey: `team-invitation-operation:${operationId}`,
        expiresAt: invitation.expiresAt,
      }, createdAt);
      return { ...saved[0]!, replay: false, token };
    });
    if (result.replay) reply.header("idempotency-replayed", "true");
    return reply.status(201).send({
      data: {
        invitation: { email: result.email, role: result.role, expiresAt: result.expiresAt },
        message: "Invitación enviada.",
        ...(deps.config.NODE_ENV === "test" && result.token ? { debugToken: result.token } : {}),
      },
    });
  });

  app.delete("/api/v1/agency/team/invitations/:invitationId", {
    schema: { tags: ["Equipo"], summary: "Revocar una invitación pendiente" },
  }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const { invitationId } = invitationParams.parse(request.params);
    const revokedAt = now();
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
      const revoked = await tx.update(agencyInvitations).set({ revokedAt, updatedAt: revokedAt })
        .where(and(eq(agencyInvitations.id, invitationId), eq(agencyInvitations.agencyId, agency.id), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt)))
        .returning({ id: agencyInvitations.id });
      if (!revoked[0]) throw new ApiError(404, "INVITATION_NOT_FOUND", "No se ha encontrado la invitación pendiente.");
      await expireInvitationEmails(tx as unknown as AppDependencies["db"], revoked[0].id, revokedAt, "INVITATION_REVOKED");
    });
    return reply.status(204).send();
  });

  app.post("/api/v1/team/invitations/accept", {
    schema: {
      tags: ["Equipo"], summary: "Aceptar una invitación",
      body: {
        oneOf: [
          bodySchema({ token: { type: "string", minLength: 20 } }, ["token"]),
          bodySchema({
            token: { type: "string", minLength: 20 },
            fullName: { type: "string", minLength: 2, maxLength: 200 },
            password: { type: "string", minLength: 10, maxLength: 200 },
            termsAccepted: { type: "boolean", const: true },
          }, ["token", "fullName", "password", "termsAccepted"]),
        ],
      },
    },
  }, async (request) => {
    const input = z.object({
      token: z.string().min(20), fullName: z.string().trim().min(2).max(200).optional(),
      password: z.string().min(10).max(200).optional(), termsAccepted: z.literal(true).optional(),
    })
      .strict()
      .refine((value) => {
        const supplied = [value.fullName, value.password, value.termsAccepted].filter((item) => item !== undefined).length;
        return supplied === 0 || supplied === 3;
      }, "El nombre, la contraseña y la aceptación de términos deben enviarse juntos.")
      .parse(request.body);
    const acceptedAt = now();
    const tokenHash = hashSecret(input.token);
    await enforceAuthRateLimits(deps, request, "invitation_accept", tokenHash);
    const prechecked = await deps.db.select({ id: agencyInvitations.id }).from(agencyInvitations).where(and(
      eq(agencyInvitations.tokenHash, tokenHash), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt), gt(agencyInvitations.expiresAt, acceptedAt),
    )).limit(1);
    if (!prechecked[0]) throw invalidInvitation();
    const passwordHash = input.password ? await argon2.hash(input.password) : null;
    let acceptedAgencyId: string;
    try {
      acceptedAgencyId = await deps.db.transaction(async (tx) => {
        const invitationScope = await tx.select({ agencyId: agencyInvitations.agencyId }).from(agencyInvitations).where(and(
          eq(agencyInvitations.tokenHash, tokenHash), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt), gt(agencyInvitations.expiresAt, acceptedAt),
        )).limit(1);
        if (!invitationScope[0]) throw invalidInvitation();
        const agencyRows = await tx.select({ accountState: agencies.accountState }).from(agencies)
          .where(eq(agencies.id, invitationScope[0].agencyId)).for("update").limit(1);
        if (agencyRows[0]?.accountState !== "active") throw invalidInvitation();
        const invitationRows = await tx.select().from(agencyInvitations).where(and(
          eq(agencyInvitations.tokenHash, tokenHash), eq(agencyInvitations.agencyId, invitationScope[0].agencyId),
          isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt), gt(agencyInvitations.expiresAt, acceptedAt),
        )).for("update").limit(1);
        const invitation = invitationRows[0];
        if (!invitation) throw invalidInvitation();
        await enforceInvitationAcceptanceAllowance(tx as unknown as AppDependencies["db"], invitation.agencyId, acceptedAt);
        const existingUsers = await tx.select().from(users).where(and(eq(users.email, invitation.email), eq(users.kind, "agency"))).limit(1);
        const existingUser = existingUsers[0];
        if (existingUser && (request.currentUser?.id !== existingUser.id || request.currentUser.kind !== "agency")) throw invalidInvitation();
        if (!existingUser && (!input.fullName || !passwordHash)) {
          throw new ApiError(400, "INVITATION_ACCOUNT_DETAILS_REQUIRED", "Indica tu nombre y una contraseña para crear la cuenta.");
        }
        if (existingUser) {
          const membership = await tx.select({ agencyId: agencyMemberships.agencyId }).from(agencyMemberships).where(eq(agencyMemberships.userId, existingUser.id)).limit(1);
          if (membership[0]) throw invalidInvitation();
        }
        const userId = existingUser?.id ?? newId();
        const consumed = await tx.update(agencyInvitations).set({ acceptedAt, updatedAt: acceptedAt })
          .where(and(eq(agencyInvitations.id, invitation.id), isNull(agencyInvitations.acceptedAt), isNull(agencyInvitations.revokedAt), gt(agencyInvitations.expiresAt, acceptedAt)))
        .returning({ id: agencyInvitations.id });
        if (!consumed[0]) throw invalidInvitation();
        if (!existingUser) {
          const inserted = await tx.insert(users).values({
            id: userId, kind: "agency", email: invitation.email, fullName: input.fullName!,
            passwordHash: passwordHash!, emailVerifiedAt: acceptedAt,
            termsVersion: CURRENT_ACCOUNT_TERMS_VERSION, termsAcceptedAt: acceptedAt,
            createdAt: acceptedAt, updatedAt: acceptedAt,
          }).onConflictDoNothing().returning({ id: users.id });
          if (!inserted[0]) throw invalidInvitation();
        }
        await tx.insert(agencyMemberships).values({ agencyId: invitation.agencyId, userId, role: invitation.role, createdAt: acceptedAt });
        await tx.update(agencyInvitations).set({ acceptedByUserId: userId }).where(eq(agencyInvitations.id, invitation.id));
        await expireInvitationEmails(tx as unknown as AppDependencies["db"], invitation.id, acceptedAt, "INVITATION_ACCEPTED");
        return invitation.agencyId;
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (["23503", "23505"].includes(databaseConstraintCode(error) ?? "")) throw invalidInvitation();
      throw error;
    }
    return { data: { accepted: true, agencyId: acceptedAgencyId, message: "Ya formas parte del equipo. Inicia sesión para continuar." } };
  });

  app.patch("/api/v1/agency/team/members/:userId", {
    schema: {
      tags: ["Equipo"], summary: "Cambiar el rol de un miembro",
      body: bodySchema({ role: { type: "string", enum: ["admin", "collaborator"] } }, ["role"]),
    },
  }, async (request) => {
    const { user, agency } = requireAdmin(request);
    const { userId } = uuidParams.parse(request.params);
    const { role } = roleInput.parse(request.body);
    await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
      const targets = await tx.select().from(agencyMemberships).where(and(eq(agencyMemberships.agencyId, agency.id), eq(agencyMemberships.userId, userId))).limit(1);
      const target = targets[0];
      if (!target) throw new ApiError(404, "MEMBER_NOT_FOUND", "No se ha encontrado el miembro del equipo.");
      if (target.role === "admin" && role === "collaborator") {
        const admins = await tx.select({ value: count() }).from(agencyMemberships).where(and(eq(agencyMemberships.agencyId, agency.id), eq(agencyMemberships.role, "admin")));
        if (Number(admins[0]?.value ?? 0) <= 1) throw new ApiError(409, "LAST_ADMIN_REQUIRED", "La agencia debe conservar al menos una persona administradora.");
      }
      await tx.update(agencyMemberships).set({ role }).where(and(eq(agencyMemberships.agencyId, agency.id), eq(agencyMemberships.userId, userId)));
    });
    return { data: { userId, role } };
  });

  app.delete("/api/v1/agency/team/members/:userId", {
    schema: { tags: ["Equipo"], summary: "Eliminar un miembro del equipo" },
  }, async (request, reply) => {
    const { user, agency } = requireAdmin(request);
    const { userId } = uuidParams.parse(request.params);
    try {
      await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
      const targets = await tx.select().from(agencyMemberships).where(and(eq(agencyMemberships.agencyId, agency.id), eq(agencyMemberships.userId, userId))).limit(1);
      const target = targets[0];
      if (!target) throw new ApiError(404, "MEMBER_NOT_FOUND", "No se ha encontrado el miembro del equipo.");
      if (target.role === "admin") {
        const admins = await tx.select({ value: count() }).from(agencyMemberships).where(and(eq(agencyMemberships.agencyId, agency.id), eq(agencyMemberships.role, "admin")));
        if (Number(admins[0]?.value ?? 0) <= 1) throw new ApiError(409, "LAST_ADMIN_REQUIRED", "La agencia debe conservar al menos una persona administradora.");
      }
      const [propertyAssignments, applicationAssignments, appointmentAssignments] = await Promise.all([
        tx.select({ value: count() }).from(properties).where(and(eq(properties.agencyId, agency.id), eq(properties.responsibleUserId, userId))),
        tx.select({ value: count() }).from(applications).where(and(eq(applications.agencyId, agency.id), eq(applications.responsibleUserId, userId))),
        tx.select({ value: count() }).from(appointments).where(and(eq(appointments.agencyId, agency.id), eq(appointments.responsibleUserId, userId))),
      ]);
      const assignments = {
        properties: Number(propertyAssignments[0]?.value ?? 0),
        applications: Number(applicationAssignments[0]?.value ?? 0),
        appointments: Number(appointmentAssignments[0]?.value ?? 0),
      };
      if (assignments.properties + assignments.applications + assignments.appointments > 0) {
        throw new ApiError(409, "MEMBER_HAS_ASSIGNMENTS", "Reasigna sus anuncios, interesados y visitas antes de eliminar a esta persona.", assignments);
      }
      await tx.delete(agencyMemberships).where(and(eq(agencyMemberships.agencyId, agency.id), eq(agencyMemberships.userId, userId)));
      await tx.update(emailOutbox).set({
        state: "expired",
        recipient: "eliminado@inquilink.invalid",
        variables: {},
        claimToken: null,
        claimedAt: null,
        lastErrorCode: "AGENCY_MEMBERSHIP_REMOVED",
      }).where(and(
        eq(emailOutbox.agencyId, agency.id),
        eq(emailOutbox.userId, userId),
        or(eq(emailOutbox.state, "pending"), eq(emailOutbox.state, "processing")),
      ));
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (databaseConstraintCode(error) === "23503") {
        throw new ApiError(409, "MEMBER_IN_USE", "No se puede eliminar a esta persona mientras conserve actividad asociada.");
      }
      throw error;
    }
    return reply.status(204).send();
  });

  app.get("/api/v1/account/profile", {
    schema: { tags: ["Configuración"], summary: "Consultar el perfil actual" },
  }, async (request) => {
    const user = requireUser(request);
    return { data: { profile: { id: user.id, fullName: user.fullName, email: user.email, accountType: user.kind } } };
  });

  app.patch("/api/v1/account/profile", {
    schema: {
      tags: ["Configuración"], summary: "Actualizar el perfil actual",
      body: bodySchema({ fullName: { type: "string", minLength: 2, maxLength: 200 } }, ["fullName"]),
    },
  }, async (request) => {
    const user = requireUser(request);
    const { fullName } = z.object({ fullName: z.string().trim().min(2).max(200) }).strict().parse(request.body);
    await deps.db.transaction(async (tx) => {
      if (user.kind === "agency" && request.currentAgency) await lockActiveAgency(tx as unknown as AppDependencies["db"], request.currentAgency.id, { userId: user.id });
      const lockedUsers = await tx.select({ accountState: users.accountState }).from(users)
        .where(eq(users.id, user.id)).for("update").limit(1);
      if (lockedUsers[0]?.accountState !== "active") {
        throw new ApiError(409, "ACCOUNT_CLOSURE_IN_PROGRESS", "La cuenta se está cerrando y ya no admite cambios.");
      }
      const changed = await tx.update(users).set({ fullName, updatedAt: now() })
        .where(and(eq(users.id, user.id), eq(users.accountState, "active"))).returning({ id: users.id });
      if (!changed[0]) throw new ApiError(409, "ACCOUNT_CLOSURE_IN_PROGRESS", "La cuenta se está cerrando y ya no admite cambios.");
    });
    return { data: { profile: { id: user.id, fullName, email: user.email, accountType: user.kind } } };
  });

  app.get("/api/v1/agency/settings", {
    schema: { tags: ["Configuración"], summary: "Consultar los datos de la agencia" },
  }, async (request) => {
    const { agency } = requireAgency(request);
    const rows = await deps.db.select({ id: agencies.id, name: agencies.name, phone: agencies.phone, contactEmail: agencies.contactEmail, logoUrl: agencies.logoUrl, timezone: agencies.timezone })
      .from(agencies).where(eq(agencies.id, agency.id)).limit(1);
    return { data: { agency: rows[0] } };
  });

  app.patch("/api/v1/agency/settings", {
    schema: {
      tags: ["Configuración"], summary: "Actualizar los datos de la agencia",
      body: bodySchema({
        name: { type: "string", minLength: 2, maxLength: 200 },
        phone: { type: "string", maxLength: 40 },
        contactEmail: { type: "string", maxLength: 320 },
        logoUrl: { type: "string", format: "uri", maxLength: 2000 },
      }),
    },
  }, async (request) => {
    const { user, agency } = requireAdmin(request);
    const input = z.object({
      name: z.string().trim().min(2).max(200).optional(),
      phone: z.string().trim().max(40).optional(),
      contactEmail: z.union([z.email().max(320), z.literal("")]).optional(),
      logoUrl: z.union([z.url().max(2_000), z.literal("")]).optional(),
    }).strict().refine((value) => Object.keys(value).length > 0, "Debes indicar al menos un cambio.").parse(request.body);
    const changes = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail || null } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
      updatedAt: now(),
    };
    const updated = await deps.db.transaction(async (tx) => {
      await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id, requiredRole: "admin" });
      return tx.update(agencies).set(changes).where(eq(agencies.id, agency.id)).returning({
        id: agencies.id, name: agencies.name, phone: agencies.phone, contactEmail: agencies.contactEmail, logoUrl: agencies.logoUrl, timezone: agencies.timezone,
      });
    });
    return { data: { agency: updated[0] } };
  });
}
