import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { hashSecret, newId } from "../../lib/ids.js";
import { loadConfig } from "../../config.js";
import { createDatabase } from "../../db/client.js";
import { agencies, applicationDocuments, applications, documentStorageCleanup, properties, sessions, users } from "../../db/schema.js";
import { LocalBillingProvider } from "../billing/provider.js";
import { OutboxEmailProvider } from "../email/provider.js";
import { runDataLifecycle } from "./lifecycle.js";
import { MemoryPrivateDocumentStorage, type PrivateDocumentStorage, type StoredObject } from "./storage.js";

const realDatabaseUrl = process.env.REAL_DATABASE_URL;

class BlockingPutStorage implements PrivateDocumentStorage {
  private readonly delegate = new MemoryPrivateDocumentStorage();
  private releasePut!: () => void;
  private markEntered!: () => void;
  readonly entered = new Promise<void>((resolve) => { this.markEntered = resolve; });
  private readonly released = new Promise<void>((resolve) => { this.releasePut = resolve; });
  release(): void { this.releasePut(); }
  async put(input: { key: string; body: Buffer; contentType: "application/pdf" | "image/jpeg" | "image/png" }): Promise<void> {
    this.markEntered();
    await this.released;
    await this.delegate.put(input);
  }
  get(key: string): Promise<StoredObject | null> { return this.delegate.get(key); }
  delete(key: string): Promise<void> { return this.delegate.delete(key); }
}

it.skipIf(!realDatabaseUrl)("serializes real PostgreSQL account closure against a staged upload without orphaning bytes", async () => {
  const database = createDatabase(realDatabaseUrl!);
  await migrate(database.db, { migrationsFolder: new URL("../../../drizzle", import.meta.url).pathname });
  const storage = new BlockingPutStorage();
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: realDatabaseUrl!, LOG_LEVEL: "silent" });
  const app = await buildApp({ config, db: database.db, emailProvider: new OutboxEmailProvider(database.db), billingProvider: new LocalBillingProvider() }, { rentals: { storage } });
  const agencyId = newId();
  const tenantId = newId();
  const propertyId = newId();
  const applicationId = newId();
  const sessionToken = `real-pg-${newId()}`;
  const createdAt = new Date();
  let storageKey: string | undefined;
  try {
    await database.db.insert(users).values({ id: tenantId, kind: "tenant", email: `${tenantId}@example.es`, fullName: "Prueba Real", passwordHash: await argon2.hash("test-password"), emailVerifiedAt: createdAt, createdAt, updatedAt: createdAt });
    await database.db.insert(agencies).values({ id: agencyId, name: "Agencia prueba PostgreSQL", createdAt, updatedAt: createdAt });
    await database.db.insert(properties).values({ id: propertyId, agencyId, internalReference: `PG-${propertyId}`, title: "Piso PostgreSQL", city: "Madrid", province: "Madrid", monthlyRentCents: 100_000, requestedDocumentCategories: ["payslips"], state: "published", publicLinkTokenHash: hashSecret(`link-${propertyId}`), publicLinkIssuedAt: createdAt, createdAt, updatedAt: createdAt });
    await database.db.insert(applications).values({ id: applicationId, agencyId, propertyId, tenantUserId: tenantId, status: "new", createdAt, updatedAt: createdAt });
    await database.db.insert(sessions).values({ id: newId(), userId: tenantId, tokenHash: hashSecret(sessionToken), createdAt, lastSeenAt: createdAt, expiresAt: new Date(createdAt.getTime() + 86_400_000) });

    const upload = app.inject({ method: "POST", url: `/api/v1/tenant/applications/${applicationId}/documents`, headers: { cookie: `inquilink_session=${sessionToken}` }, payload: { category: "payslips", originalName: "nomina.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-real-postgres").toString("base64") } });
    await storage.entered;
    const staged = (await database.db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId)))[0]!;
    storageKey = staged.storageKey;
    expect(staged.malwareScanState).toBe("pending");

    const closed = await app.inject({ method: "POST", url: "/api/v1/account/close", headers: { cookie: `inquilink_session=${sessionToken}` }, payload: { confirmation: "CERRAR MI CUENTA" } });
    expect(closed.statusCode).toBe(202);
    const deferred = await runDataLifecycle(database.db, storage, { now: new Date(createdAt.getTime() + 5 * 60_000), accountRetentionDays: 0 });
    expect(deferred.accountClosuresDeferred).toBe(1);
    expect((await database.db.select().from(applicationDocuments).where(eq(applicationDocuments.id, staged.id)))[0]?.malwareScanState).toBe("pending");

    storage.release();
    const uploadResult = await upload;
    expect(uploadResult.statusCode).toBe(409);
    expect(await storage.get(storageKey)).toBeNull();
    await runDataLifecycle(database.db, storage, { now: new Date(createdAt.getTime() + 20 * 60_000), accountRetentionDays: 0 });
    expect(await database.db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId))).toHaveLength(0);
    expect(await database.db.select().from(documentStorageCleanup).where(eq(documentStorageCleanup.applicationId, applicationId))).toHaveLength(0);
  } finally {
    if (storageKey) storage.release();
    await database.db.delete(agencies).where(eq(agencies.id, agencyId));
    await database.db.delete(users).where(eq(users.id, tenantId));
    await app.close();
    await database.close();
  }
}, 30_000);
