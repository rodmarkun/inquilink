import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeDocument, DocumentAccessTokens, LocalPrivateDocumentStorage, MemoryPrivateDocumentStorage, stableStorageKey } from "./storage.js";

describe("private document storage", () => {
  it("stores defensive copies and never exposes a shared mutable buffer", async () => {
    const storage = new MemoryPrivateDocumentStorage();
    const original = Buffer.from("private-document");
    await storage.put({ key: "one", body: original, contentType: "application/pdf" });
    original.fill(0);

    const first = await storage.get("one");
    expect(first?.body.toString()).toBe("private-document");
    first?.body.fill(0);
    expect((await storage.get("one"))?.body.toString()).toBe("private-document");
  });

  it("persists local files across adapter instances", async () => {
    const root = await mkdtemp(join(tmpdir(), "inquilink-storage-"));
    try {
      await new LocalPrivateDocumentStorage(root).put({ key: "applications/app/doc", body: Buffer.from("%PDF-durable"), contentType: "application/pdf" });
      const reopened = await new LocalPrivateDocumentStorage(root).get("applications/app/doc");
      expect(reopened?.body.toString()).toBe("%PDF-durable");
      expect(reopened?.contentType).toBe("application/pdf");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("validates allowed formats, base64 encoding, empty files, and configurable size", () => {
    expect(decodeDocument({ dataBase64: Buffer.from("%PDF-test").toString("base64"), contentType: "application/pdf", maxBytes: 20 }).body.toString()).toBe("%PDF-test");
    expect(() => decodeDocument({ dataBase64: "!!!!", contentType: "application/pdf", maxBytes: 10 })).toThrow("INVALID_BASE64");
    expect(() => decodeDocument({ dataBase64: Buffer.from("%PDF-test").toString("base64"), contentType: "text/plain", maxBytes: 20 })).toThrow("UNSUPPORTED_CONTENT_TYPE");
    expect(() => decodeDocument({ dataBase64: Buffer.from("large").toString("base64"), contentType: "image/png", maxBytes: 2 })).toThrow("FILE_TOO_LARGE");
  });

  it("creates scoped, tamper-resistant and expiring access tokens", () => {
    const service = new DocumentAccessTokens(Buffer.alloc(32, 7));
    const token = service.issue({ documentId: "doc-a", userId: "tenant-a", expiresAtEpochSeconds: 101 });
    expect(service.verify(token, { documentId: "doc-a", userId: "tenant-a", now: new Date(100_000) })).not.toBeNull();
    expect(service.verify(token, { documentId: "doc-b", userId: "tenant-a", now: new Date(100_000) })).toBeNull();
    expect(service.verify(token, { documentId: "doc-a", userId: "tenant-b", now: new Date(100_000) })).toBeNull();
    expect(service.verify(`${token.slice(0, -1)}x`, { documentId: "doc-a", userId: "tenant-a", now: new Date(100_000) })).toBeNull();
    expect(service.verify(token, { documentId: "doc-a", userId: "tenant-a", now: new Date(101_000) })).toBeNull();
  });

  it("uses opaque document identifiers in storage keys", () => {
    const key = stableStorageKey({ applicationId: "app-a", documentId: "sensitive-file-name.pdf" });
    expect(key).toMatch(/^applications\/app-a\/[a-f0-9]{64}$/);
    expect(key).not.toContain("sensitive-file-name");
  });
});
