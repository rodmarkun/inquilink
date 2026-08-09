import { describe, expect, it } from "vitest";
import { loadConfig, trustedProxyRanges } from "./config.js";

const production = {
  NODE_ENV: "production",
  APP_ORIGIN: "https://app.inquilink.es",
  COOKIE_SECURE: "true",
  PUBLIC_LINK_VAULT_SECRET: "production-public-link-vault-secret-value",
  DOCUMENT_ACCESS_TOKEN_SECRET: "production-document-access-secret-value",
  EMAIL_TRANSPORT: "webhook",
  EMAIL_PROVIDER_URL: "https://email.example/v1/send",
  EMAIL_PROVIDER_TOKEN: "production-email-token-value",
  DATABASE_URL: "postgres://user:password@db.example/inquilink?sslmode=verify-full",
} satisfies NodeJS.ProcessEnv;

describe("production configuration boundary", () => {
  it("requires HTTPS origin and secure session cookies", () => {
    expect(() => loadConfig({ ...production, APP_ORIGIN: "http://app.inquilink.es" })).toThrow(/APP_ORIGIN.*HTTPS/);
    expect(() => loadConfig({ ...production, COOKIE_SECURE: "false" })).toThrow(/cookies must be secure/);
  });

  it("requires encrypted PostgreSQL connections", () => {
    expect(() => loadConfig({ ...production, DATABASE_URL: "postgres://user:password@db.example/inquilink" })).toThrow(/DATABASE_URL must require TLS/);
    expect(loadConfig({ ...production, DATABASE_URL: "postgres://user:password@db.example/inquilink?sslmode=verify-full" }).NODE_ENV).toBe("production");
  });

  it("requires encrypted email delivery", () => {
    expect(() => loadConfig({ ...production, EMAIL_TRANSPORT: "smtp", EMAIL_SMTP_HOST: "smtp.example", EMAIL_SMTP_SECURE: "false", EMAIL_SMTP_REQUIRE_TLS: "false" })).toThrow(/SMTP must require TLS/);
    expect(loadConfig({ ...production, EMAIL_TRANSPORT: "smtp", EMAIL_SMTP_HOST: "smtp.example", EMAIL_SMTP_SECURE: "false", EMAIL_SMTP_REQUIRE_TLS: "true" }).EMAIL_SMTP_REQUIRE_TLS).toBe(true);
    expect(() => loadConfig({ ...production, EMAIL_TRANSPORT: "smtp", EMAIL_SMTP_HOST: "smtp.example", EMAIL_SMTP_REQUIRE_TLS: "true", EMAIL_SMTP_USER: "mailer" })).toThrow(/user and password must be configured together/);
    expect(() => loadConfig({ ...production, EMAIL_TRANSPORT: "smtp", EMAIL_SMTP_HOST: "smtp.example", EMAIL_SMTP_REQUIRE_TLS: "true", EMAIL_SMTP_PASSWORD: "secret" })).toThrow(/user and password must be configured together/);
    expect(() => loadConfig({ ...production, EMAIL_PROVIDER_URL: "http://email.example/send" })).toThrow(/provider URLs must use HTTPS/);
  });

  it.each([
    ["ALLOW_LOCAL_PROVIDERS", "true"],
    ["EMAIL_TRANSPORT", "local"],
    ["DOCUMENT_STORAGE_MODE", "local"],
    ["MALWARE_SCANNER_MODE", "local"],
  ])("rejects local production mode %s", (key, value) => {
    expect(() => loadConfig({ ...production, [key]: value })).toThrow(/local providers are forbidden/);
  });

  it("trusts no forwarding proxy by default and parses only explicit ranges", () => {
    expect(trustedProxyRanges(loadConfig({ NODE_ENV: "test" }))).toEqual([]);
    expect(trustedProxyRanges(loadConfig({ NODE_ENV: "test", TRUSTED_PROXY_RANGES: "172.30.0.10/32, 10.0.0.0/24" }))).toEqual(["172.30.0.10/32", "10.0.0.0/24"]);
  });
});
