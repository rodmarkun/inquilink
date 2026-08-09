import { describe, expect, it } from "vitest";
import { AesGcmPublicLinkTokenVault } from "./public-link-vault.js";

describe("public-link token vault", () => {
  it("round-trips a token only for the bound property", () => {
    const vault = new AesGcmPublicLinkTokenVault("test-vault-secret-that-is-at-least-thirty-two-bytes");
    const ciphertext = vault.seal("property-a", "opaque-public-token");
    expect(ciphertext).not.toContain("opaque-public-token");
    expect(vault.open("property-a", ciphertext)).toBe("opaque-public-token");
    expect(() => vault.open("property-b", ciphertext)).toThrow("PUBLIC_LINK_VAULT_VALUE_INVALID");
  });

  it("rejects tampering", () => {
    const vault = new AesGcmPublicLinkTokenVault("test-vault-secret-that-is-at-least-thirty-two-bytes");
    const ciphertext = vault.seal("property-a", "opaque-public-token");
    expect(() => vault.open("property-a", `${ciphertext.slice(0, -1)}x`)).toThrow("PUBLIC_LINK_VAULT_VALUE_INVALID");
  });
});
