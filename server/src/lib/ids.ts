import { createHash, randomBytes, randomUUID } from "node:crypto";

export const newId = (): string => randomUUID();

export function newSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
