import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { agencies, agencyMemberships, documentStorageCleanup, properties, sessions, users } from "../../db/schema.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { createTestApp } from "../../test/test-app.js";
import { LocalDeterministicDocumentScanner, MemoryPrivateDocumentStorage } from "../rentals/storage.js";

let context: Awaited<ReturnType<typeof createTestApp>>;
const agencyId = "61000000-0000-4000-8000-000000000001";
const userId = "61000000-0000-4000-8000-000000000002";
const propertyId = "61000000-0000-4000-8000-000000000003";
const storage = new MemoryPrivateDocumentStorage();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

beforeEach(async () => {
  context = await createTestApp({}, undefined, { rentals: { storage, scanner: new LocalDeterministicDocumentScanner(), maxDocumentBytes: 1_024 } });
  const now = new Date();
  await context.db.insert(users).values({ id: userId, kind: "agency", email: "imagenes@example.es", fullName: "Ana", passwordHash: "test", emailVerifiedAt: now, createdAt: now, updatedAt: now });
  await context.db.insert(agencies).values({ id: agencyId, name: "Agencia Imagen", createdAt: now, updatedAt: now });
  await context.db.insert(agencyMemberships).values({ agencyId, userId, role: "admin", createdAt: now });
  await context.db.insert(sessions).values({ id: newId(), userId, tokenHash: hashSecret("image-token"), createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + 86_400_000) });
  await context.db.insert(properties).values({
    id: propertyId, agencyId, internalReference: "IMG-001", title: "Piso con foto", address: "Calle Mayor 1", city: "Madrid", province: "Madrid", postalCode: "28001",
    propertyType: "Piso", bedrooms: 2, bathrooms: 1, floorAreaSqm: 70, availableFrom: "2026-09-01", description: "Descripción", publicLocation: "Madrid",
    monthlyRentCents: 120_000, createdAt: now, updatedAt: now,
  });
});

afterEach(async () => context.close());

describe("property cover images", () => {
  it("requires agency scope, scans and stores an image, then serves only its current immutable URL", async () => {
    const unauthorized = await context.app.inject({ method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, payload: { originalName: "portada.png", contentType: "image/png", dataBase64: png.toString("base64") } });
    expect(unauthorized.statusCode).toBe(401);

    const uploaded = await context.app.inject({
      method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, headers: { cookie: "inquilink_session=image-token" },
      payload: { originalName: "portada.png", contentType: "image/png", dataBase64: png.toString("base64") },
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().data).toMatchObject({ contentType: "image/png", scanProvider: "local-eicar-policy", version: 2 });
    expect(uploaded.json().data.byteSize).toBeGreaterThan(0);
    const firstUrl = new URL(uploaded.json().data.coverImageUrl);
    expect(firstUrl.pathname).toMatch(new RegExp(`^/api/v1/property-images/${propertyId}/[0-9a-f-]{36}$`));
    expect((await context.db.select().from(properties))[0]).toMatchObject({ coverImageUrl: uploaded.json().data.coverImageUrl, version: 2 });

    const content = await context.app.inject({ method: "GET", url: firstUrl.pathname });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toContain("image/png");
    expect(content.headers["cache-control"]).toContain("immutable");
    await expect(sharp(content.rawPayload).metadata()).resolves.toMatchObject({ format: "png", width: 1, height: 1 });

    const replaced = await context.app.inject({
      method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, headers: { cookie: "inquilink_session=image-token" },
      payload: { originalName: "nueva.png", contentType: "image/png", dataBase64: png.toString("base64") },
    });
    expect(replaced.statusCode).toBe(201);
    expect(replaced.json().data.version).toBe(3);
    expect(replaced.json().data.coverImageUrl).not.toBe(uploaded.json().data.coverImageUrl);
    expect(await context.db.select().from(documentStorageCleanup)).toHaveLength(0);
    expect((await context.app.inject({ method: "GET", url: firstUrl.pathname })).statusCode).toBe(404);
  });

  it("rejects spoofed and unsafe image payloads without changing the property", async () => {
    const mismatch = await context.app.inject({
      method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, headers: { cookie: "inquilink_session=image-token" },
      payload: { originalName: "portada.jpg", contentType: "image/png", dataBase64: png.toString("base64") },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe("CONTENT_TYPE_MISMATCH");

    const fakePng = Buffer.concat([png.subarray(0, 8), Buffer.from("not-an-image")]);
    const invalid = await context.app.inject({
      method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, headers: { cookie: "inquilink_session=image-token" },
      payload: { originalName: "portada.png", contentType: "image/png", dataBase64: fakePng.toString("base64") },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("INVALID_IMAGE_STRUCTURE");

    const undecodableJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0xff, 0xda, 0x00, 0x06, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
    const invalidJpeg = await context.app.inject({
      method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, headers: { cookie: "inquilink_session=image-token" },
      payload: { originalName: "portada.jpg", contentType: "image/jpeg", dataBase64: undecodableJpeg.toString("base64") },
    });
    expect(invalidJpeg.statusCode).toBe(422);
    expect(invalidJpeg.json().error.code).toBe("INVALID_IMAGE_STRUCTURE");

    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const textChunk = Buffer.alloc(12 + eicar.length);
    textChunk.writeUInt32BE(eicar.length, 0); textChunk.write("tEXt", 4, "ascii"); eicar.copy(textChunk, 8);
    const eicarPng = Buffer.concat([png.subarray(0, -12), textChunk, png.subarray(-12)]);
    const infected = await context.app.inject({
      method: "POST", url: `/api/v1/agency/properties/${propertyId}/cover-image`, headers: { cookie: "inquilink_session=image-token" },
      payload: { originalName: "portada.png", contentType: "image/png", dataBase64: eicarPng.toString("base64") },
    });
    expect(infected.statusCode).toBe(422);
    expect(infected.json().error.code).toBe("IMAGE_INFECTED");
    expect((await context.db.select().from(properties))[0]?.coverImageUrl).toBeNull();
  });
});
