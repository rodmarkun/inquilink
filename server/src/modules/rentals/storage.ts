import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { z } from "zod";

export const ALLOWED_DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

export interface StoredObject {
  body: Buffer;
  contentType: AllowedDocumentType;
}

export interface PrivateDocumentStorage {
  put(input: { key: string; body: Buffer; contentType: AllowedDocumentType }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/**
 * Durable local storage for explicitly configured development/self-hosted use.
 * The root must be a private mounted directory in Docker. Production SaaS must
 * replace this contract with encrypted private object storage.
 */
export class LocalPrivateDocumentStorage implements PrivateDocumentStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  #path(key: string, suffix: "body" | "metadata"): string {
    const candidate = resolve(this.#root, `${key}.${suffix === "body" ? "bin" : "json"}`);
    if (!candidate.startsWith(`${this.#root}${sep}`)) throw new Error("INVALID_STORAGE_KEY");
    return candidate;
  }

  async put(input: { key: string; body: Buffer; contentType: AllowedDocumentType }): Promise<void> {
    const bodyPath = this.#path(input.key, "body");
    const metadataPath = this.#path(input.key, "metadata");
    await mkdir(dirname(bodyPath), { recursive: true, mode: 0o700 });
    const nonce = randomBytes(8).toString("hex");
    const temporaryBody = `${bodyPath}.${nonce}.tmp`;
    const temporaryMetadata = `${metadataPath}.${nonce}.tmp`;
    await writeFile(temporaryBody, input.body, { mode: 0o600 });
    await writeFile(temporaryMetadata, JSON.stringify({ contentType: input.contentType }), { mode: 0o600 });
    await rename(temporaryBody, bodyPath);
    await rename(temporaryMetadata, metadataPath);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const [body, rawMetadata] = await Promise.all([readFile(this.#path(key, "body")), readFile(this.#path(key, "metadata"), "utf8")]);
      const metadata = JSON.parse(rawMetadata) as { contentType?: string };
      if (!ALLOWED_DOCUMENT_TYPES.includes(metadata.contentType as AllowedDocumentType)) throw new Error("INVALID_STORAGE_METADATA");
      return { body, contentType: metadata.contentType as AllowedDocumentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await Promise.all([rm(this.#path(key, "body"), { force: true }), rm(this.#path(key, "metadata"), { force: true })]);
  }
}

/** In-memory adapter is test-only and must be injected explicitly. */
export class MemoryPrivateDocumentStorage implements PrivateDocumentStorage {
  readonly #objects = new Map<string, StoredObject>();
  async put(input: { key: string; body: Buffer; contentType: AllowedDocumentType }): Promise<void> { this.#objects.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType }); }
  async get(key: string): Promise<StoredObject | null> { const value = this.#objects.get(key); return value ? { ...value, body: Buffer.from(value.body) } : null; }
  async delete(key: string): Promise<void> { this.#objects.delete(key); }
}

/** HTTPS object-storage gateway adapter. The gateway owns encryption at rest. */
export class GatewayPrivateDocumentStorage implements PrivateDocumentStorage {
  private readonly baseUrl: string;
  constructor(baseUrl: string, private readonly bearerToken: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  }

  #url(key: string): URL {
    const url = new URL("objects", this.baseUrl);
    url.searchParams.set("key", key);
    return url;
  }

  async put(input: { key: string; body: Buffer; contentType: AllowedDocumentType }): Promise<void> {
    const response = await fetch(this.#url(input.key), {
      method: "PUT",
      headers: { authorization: `Bearer ${this.bearerToken}`, "content-type": input.contentType },
      body: new Uint8Array(input.body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("DOCUMENT_STORAGE_WRITE_FAILED");
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await fetch(this.#url(key), {
      headers: { authorization: `Bearer ${this.bearerToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("DOCUMENT_STORAGE_READ_FAILED");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (!ALLOWED_DOCUMENT_TYPES.includes(contentType as AllowedDocumentType)) throw new Error("INVALID_STORAGE_METADATA");
    return { body: Buffer.from(await response.arrayBuffer()), contentType: contentType as AllowedDocumentType };
  }

  async delete(key: string): Promise<void> {
    const response = await fetch(this.#url(key), {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.bearerToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok && response.status !== 404) throw new Error("DOCUMENT_STORAGE_DELETE_FAILED");
  }
}

export type DocumentScanResult = { state: "clean" | "infected" | "error"; provider: string };
export interface DocumentScanner {
  scan(input: { body: Buffer; contentType: AllowedDocumentType; originalName: string }): Promise<DocumentScanResult>;
}

/**
 * Predictable local development scanner. It detects the standard EICAR fixture;
 * it is selected only through the explicit local-provider configuration gate.
 */
export class LocalDeterministicDocumentScanner implements DocumentScanner {
  async scan(input: { body: Buffer }): Promise<DocumentScanResult> {
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    return input.body.includes(Buffer.from(eicar, "ascii"))
      ? { state: "infected", provider: "local-eicar-policy" }
      : { state: "clean", provider: "local-eicar-policy" };
  }
}

const scanResponse = z.object({ state: z.enum(["clean", "infected", "error"]), provider: z.string().min(1).max(100) }).strict();

/** HTTPS malware-scanner adapter. Files are accepted only after an explicit clean verdict. */
export class WebhookDocumentScanner implements DocumentScanner {
  constructor(private readonly endpoint: string, private readonly bearerToken: string) {}
  async scan(input: { body: Buffer; contentType: AllowedDocumentType; originalName: string }): Promise<DocumentScanResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.bearerToken}`,
        "content-type": input.contentType,
        "x-inquilink-filename": encodeURIComponent(input.originalName),
      },
      body: new Uint8Array(input.body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("DOCUMENT_SCAN_FAILED");
    return scanResponse.parse(await response.json());
  }
}

type AccessClaims = {
  documentId: string;
  userId: string;
  expiresAtEpochSeconds: number;
};

export class DocumentAccessTokens {
  readonly #secret: Buffer;

  constructor(secret: Buffer = randomBytes(32)) {
    this.#secret = Buffer.from(secret);
  }

  issue(claims: AccessClaims): string {
    const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  verify(token: string, expected: { documentId: string; userId: string; now: Date }): AccessClaims | null {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return null;
    const expectedSignature = createHmac("sha256", this.#secret).update(payload).digest();
    let actualSignature: Buffer;
    try {
      actualSignature = Buffer.from(signature, "base64url");
    } catch {
      return null;
    }
    if (actualSignature.toString("base64url") !== signature) return null;
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) return null;
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AccessClaims>;
      if (claims.documentId !== expected.documentId || claims.userId !== expected.userId) return null;
      if (!Number.isInteger(claims.expiresAtEpochSeconds) || claims.expiresAtEpochSeconds! <= Math.floor(expected.now.getTime() / 1000)) return null;
      return claims as AccessClaims;
    } catch {
      return null;
    }
  }
}

export function decodeDocument(input: { dataBase64: string; contentType: string; maxBytes: number }): { body: Buffer; contentType: AllowedDocumentType } {
  if (!ALLOWED_DOCUMENT_TYPES.includes(input.contentType as AllowedDocumentType)) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64) || input.dataBase64.length % 4 !== 0) {
    throw new Error("INVALID_BASE64");
  }
  const body = Buffer.from(input.dataBase64, "base64");
  if (body.length === 0) throw new Error("EMPTY_FILE");
  if (body.length > input.maxBytes) throw new Error("FILE_TOO_LARGE");
  const matchesSignature = input.contentType === "application/pdf" ? body.subarray(0, 5).toString("ascii") === "%PDF-"
    : input.contentType === "image/jpeg" ? body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
    : body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!matchesSignature) throw new Error("CONTENT_TYPE_MISMATCH");
  return { body, contentType: input.contentType as AllowedDocumentType };
}

export function stableStorageKey(input: { applicationId: string; documentId: string }): string {
  return `applications/${input.applicationId}/${createHash("sha256").update(input.documentId).digest("hex")}`;
}
