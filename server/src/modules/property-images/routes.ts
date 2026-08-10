import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAgency } from "../../auth/session.js";
import { agencies, documentStorageCleanup, properties } from "../../db/schema.js";
import { ApiError } from "../../lib/errors.js";
import { newId } from "../../lib/ids.js";
import type { AppDependencies } from "../../types.js";
import { lockActiveAgency } from "../agency-lock.js";
import type { RentalRouteOptions } from "../rentals/routes.js";
import { decodeDocument, LocalDeterministicDocumentScanner, LocalPrivateDocumentStorage, type DocumentScanner, type PrivateDocumentStorage } from "../rentals/storage.js";
import { PROPERTY_COVER_STAGING_CLEANUP_REASON, PROPERTY_COVER_STAGING_LEASE_MS, PROPERTY_COVER_STAGING_REASON, propertyImagePath, propertyImageStorageKey, propertyImageStorageKeyFromUrl } from "./storage-key.js";
import { decodeAndNormalizeImage } from "./validation.js";

const paramsSchema = z.object({ propertyId: z.string().uuid(), version: z.string().uuid() });
const uploadSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png"]),
  dataBase64: z.string().min(4),
}).strict();

export { propertyImageStorageKey } from "./storage-key.js";

function providers(deps: AppDependencies, options: RentalRouteOptions): { storage: PrivateDocumentStorage; scanner: DocumentScanner; maxBytes: number } {
  if ((!options.storage || !options.scanner) && !deps.config.ALLOW_LOCAL_PROVIDERS) throw new Error("PROPERTY_IMAGE_PROVIDERS_REQUIRED");
  return {
    storage: options.storage ?? new LocalPrivateDocumentStorage(deps.config.DOCUMENT_STORAGE_PATH),
    scanner: options.scanner ?? new LocalDeterministicDocumentScanner(),
    maxBytes: options.maxDocumentBytes ?? deps.config.DOCUMENT_MAX_BYTES,
  };
}

export function registerPropertyImageRoutes(app: FastifyInstance, deps: AppDependencies, options: RentalRouteOptions = {}): void {
  const provider = providers(deps, options);
  const now = deps.now ?? (() => new Date());

  app.post("/api/v1/agency/properties/:propertyId/cover-image", {
    schema: {
      tags: ["Agencia"], summary: "Subir la imagen de portada de un anuncio",
      body: {
        type: "object", additionalProperties: false, required: ["originalName", "contentType", "dataBase64"],
        properties: {
          originalName: { type: "string", minLength: 1, maxLength: 255 },
          contentType: { type: "string", enum: ["image/jpeg", "image/png"] },
          dataBase64: { type: "string", minLength: 4 },
        },
      },
    },
  }, async (request, reply) => {
    const { user, agency } = requireAgency(request);
    const { propertyId } = z.object({ propertyId: z.string().uuid() }).parse(request.params);
    const input = uploadSchema.parse(request.body);
    const extensionMatches = input.contentType === "image/jpeg" ? /\.jpe?g$/i.test(input.originalName) : /\.png$/i.test(input.originalName);
    if (!extensionMatches) throw new ApiError(422, "CONTENT_TYPE_MISMATCH", "La extensión de la imagen no coincide con su formato.");
    const scoped = await deps.db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).limit(1);
    if (!scoped[0]) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");

    let decoded: ReturnType<typeof decodeDocument>;
    let normalizedBody: Buffer;
    try {
      decoded = decodeDocument({ dataBase64: input.dataBase64, contentType: input.contentType, maxBytes: provider.maxBytes });
      normalizedBody = await decodeAndNormalizeImage(decoded.body, input.contentType);
      if (normalizedBody.length > provider.maxBytes) throw new Error("FILE_TOO_LARGE");
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_IMAGE";
      const messages: Record<string, string> = {
        INVALID_BASE64: "La imagen no es válida.", EMPTY_FILE: "La imagen está vacía.",
        FILE_TOO_LARGE: `La imagen supera el límite de ${provider.maxBytes} bytes.`, CONTENT_TYPE_MISMATCH: "El contenido de la imagen no coincide con el formato indicado.",
        UNSUPPORTED_CONTENT_TYPE: "El formato no está permitido. Usa JPG o PNG.",
        INVALID_IMAGE_STRUCTURE: "El archivo no contiene una imagen válida.", INVALID_IMAGE_DIMENSIONS: "Las dimensiones de la imagen no son válidas.",
      };
      throw new ApiError(422, code, messages[code] ?? "No se ha podido procesar la imagen.");
    }
    let scan: Awaited<ReturnType<DocumentScanner["scan"]>>;
    try {
      scan = await provider.scanner.scan({ body: decoded.body, contentType: decoded.contentType, originalName: input.originalName });
    } catch {
      throw new ApiError(503, "IMAGE_SCAN_UNAVAILABLE", "No se ha podido comprobar la imagen. Inténtalo de nuevo más tarde.");
    }
    if (scan.state !== "clean") {
      if (scan.state === "infected") throw new ApiError(422, "IMAGE_INFECTED", "La imagen no ha superado la comprobación de seguridad.");
      throw new ApiError(503, "IMAGE_SCAN_UNAVAILABLE", "No se ha podido comprobar la imagen. Inténtalo de nuevo más tarde.");
    }

    const version = newId();
    const storageKey = propertyImageStorageKey(propertyId, version);
    const changedAt = now();
    const stagingCleanupId = newId();
    await deps.db.insert(documentStorageCleanup).values({
      id: stagingCleanupId, storageKey, agencyId: agency.id, applicationId: propertyId, reason: PROPERTY_COVER_STAGING_REASON,
      attempts: 0, nextAttemptAt: changedAt, createdAt: changedAt, updatedAt: changedAt,
    });
    const promoteStagingCleanup = async () => {
      const failedAt = now();
      await deps.db.update(documentStorageCleanup).set({
        reason: PROPERTY_COVER_STAGING_CLEANUP_REASON, nextAttemptAt: failedAt,
        claimedAt: null, claimToken: null, updatedAt: failedAt,
      }).where(eq(documentStorageCleanup.id, stagingCleanupId));
    };
    const leaseTimer = setInterval(() => {
      const renewedAt = now();
      void deps.db.update(documentStorageCleanup).set({ updatedAt: renewedAt }).where(and(
        eq(documentStorageCleanup.id, stagingCleanupId), eq(documentStorageCleanup.reason, PROPERTY_COVER_STAGING_REASON),
      )).catch(() => undefined);
    }, Math.floor(PROPERTY_COVER_STAGING_LEASE_MS / 3));
    leaseTimer.unref();
    try {
      await provider.storage.put({ key: storageKey, body: normalizedBody, contentType: decoded.contentType });
    } catch {
      clearInterval(leaseTimer);
      await promoteStagingCleanup();
      try {
        await provider.storage.delete(storageKey);
        await deps.db.delete(documentStorageCleanup).where(eq(documentStorageCleanup.id, stagingCleanupId));
      } catch { /* An ambiguous put remains represented by the durable staging row. */ }
      throw new ApiError(503, "IMAGE_STORAGE_UNAVAILABLE", "No se ha podido guardar la imagen. Inténtalo de nuevo más tarde.");
    }
    const coverImageUrl = `${deps.config.APP_ORIGIN.replace(/\/$/, "")}${propertyImagePath(propertyId, version)}`;
    let oldKey: string | null = null;
    let propertyVersion: number | null = null;
    try {
      await deps.db.transaction(async (tx) => {
        await lockActiveAgency(tx as unknown as AppDependencies["db"], agency.id, { userId: user.id });
        const rows = await tx.select({ coverImageUrl: properties.coverImageUrl, version: properties.version }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id))).for("update").limit(1);
        if (!rows[0]) throw new ApiError(404, "PROPERTY_NOT_FOUND", "No se ha encontrado el anuncio.");
        oldKey = propertyImageStorageKeyFromUrl(rows[0].coverImageUrl, propertyId);
        const updated = await tx.update(properties).set({ coverImageUrl, version: rows[0].version + 1, updatedAt: changedAt })
          .where(and(eq(properties.id, propertyId), eq(properties.agencyId, agency.id), eq(properties.version, rows[0].version)))
          .returning({ version: properties.version });
        if (!updated[0]) throw new ApiError(409, "PROPERTY_CHANGED", "El anuncio ha cambiado. Actualiza la vista antes de volver a intentarlo.");
        propertyVersion = updated[0].version;
        await tx.delete(documentStorageCleanup).where(eq(documentStorageCleanup.id, stagingCleanupId));
        if (oldKey && oldKey !== storageKey) await tx.insert(documentStorageCleanup).values({
          id: newId(), storageKey: oldKey, agencyId: agency.id, applicationId: propertyId, reason: "PROPERTY_COVER_REPLACED",
          attempts: 0, nextAttemptAt: changedAt, createdAt: changedAt, updatedAt: changedAt,
        }).onConflictDoNothing({ target: documentStorageCleanup.storageKey });
      });
    } catch (error) {
      clearInterval(leaseTimer);
      await promoteStagingCleanup();
      try {
        await provider.storage.delete(storageKey);
        await deps.db.delete(documentStorageCleanup).where(eq(documentStorageCleanup.id, stagingCleanupId));
      } catch { /* The durable staging row lets the lifecycle worker retry deletion. */ }
      throw error;
    }
    clearInterval(leaseTimer);
    if (oldKey && oldKey !== storageKey) {
      try {
        await provider.storage.delete(oldKey);
        await deps.db.delete(documentStorageCleanup).where(eq(documentStorageCleanup.storageKey, oldKey));
      } catch { /* The durable replacement row lets the lifecycle worker retry deletion. */ }
    }
    return reply.status(201).send({ data: { coverImageUrl, version: propertyVersion, contentType: decoded.contentType, byteSize: normalizedBody.length, scanProvider: scan.provider, updatedAt: changedAt } });
  });

  app.get("/api/v1/property-images/:propertyId/:version", {
    schema: { tags: ["Agencia", "Inquilinos"], summary: "Mostrar una imagen publicada por una agencia" },
  }, async (request, reply) => {
    const { propertyId, version } = paramsSchema.parse(request.params);
    const expectedPath = propertyImagePath(propertyId, version);
    const rows = await deps.db.select({ coverImageUrl: properties.coverImageUrl }).from(properties)
      .innerJoin(agencies, eq(agencies.id, properties.agencyId))
      .where(and(eq(properties.id, propertyId), eq(agencies.accountState, "active"))).limit(1);
    const currentPath = rows[0]?.coverImageUrl ? new URL(rows[0].coverImageUrl, deps.config.APP_ORIGIN).pathname : null;
    if (currentPath !== expectedPath) throw new ApiError(404, "PROPERTY_IMAGE_NOT_FOUND", "No se ha encontrado la imagen.");
    const object = await provider.storage.get(propertyImageStorageKey(propertyId, version));
    if (!object || object.contentType === "application/pdf") throw new ApiError(404, "PROPERTY_IMAGE_NOT_FOUND", "No se ha encontrado la imagen.");
    return reply.type(object.contentType).header("Cache-Control", "public, max-age=31536000, immutable").header("X-Content-Type-Options", "nosniff").send(object.body);
  });
}
