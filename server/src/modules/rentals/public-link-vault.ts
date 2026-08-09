import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface PublicLinkTokenVault {
  seal(propertyId: string, token: string): string;
  open(propertyId: string, ciphertext: string): string;
}

/** AES-256-GCM vault backed by a stable deployment secret. */
export class AesGcmPublicLinkTokenVault implements PublicLinkTokenVault {
  readonly #key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("PUBLIC_LINK_VAULT_SECRET_TOO_SHORT");
    this.#key = createHash("sha256").update(secret, "utf8").digest();
  }

  seal(propertyId: string, token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv);
    cipher.setAAD(Buffer.from(propertyId, "utf8"));
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  open(propertyId: string, ciphertext: string): string {
    const [version, ivRaw, tagRaw, encryptedRaw, extra] = ciphertext.split(".");
    if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw || extra) throw new Error("PUBLIC_LINK_VAULT_VALUE_INVALID");
    try {
      const decodeCanonical = (value: string) => {
        const decoded = Buffer.from(value, "base64url");
        if (decoded.toString("base64url") !== value) throw new Error("NON_CANONICAL_BASE64URL");
        return decoded;
      };
      const iv = decodeCanonical(ivRaw);
      const tag = decodeCanonical(tagRaw);
      const encrypted = decodeCanonical(encryptedRaw);
      if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error("INVALID_VAULT_LENGTH");
      const decipher = createDecipheriv("aes-256-gcm", this.#key, iv);
      decipher.setAAD(Buffer.from(propertyId, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("PUBLIC_LINK_VAULT_VALUE_INVALID");
    }
  }
}
