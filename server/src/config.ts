import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1).default("postgres://inquilink:inquilink@localhost:5432/inquilink"),
  APP_ORIGIN: z.string().url().default("http://localhost:8080"),
  TRUSTED_PROXY_RANGES: z.string().default(""),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  AUTH_EMAIL_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),
  COOKIE_SECURE: z.stringbool().default(true),
  ALLOW_LOCAL_PROVIDERS: z.stringbool().default(false),
  BILLING_PROVIDER_URL: z.string().url().optional(),
  BILLING_PROVIDER_TOKEN: z.string().min(20).optional(),
  EMAIL_TRANSPORT: z.enum(["unconfigured", "local", "smtp", "webhook"]).default("unconfigured"),
  EMAIL_PROVIDER_URL: z.string().url().optional(),
  EMAIL_PROVIDER_TOKEN: z.string().min(20).optional(),
  EMAIL_SMTP_HOST: z.string().min(1).optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().positive().max(65_535).default(1025),
  EMAIL_SMTP_SECURE: z.stringbool().default(false),
  EMAIL_SMTP_REQUIRE_TLS: z.stringbool().default(false),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().email().default("no-reply@inquilink.local"),
  EMAIL_WORKER_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  EMAIL_WORKER_ONCE: z.stringbool().default(false),
  EMAIL_WORKER_HEALTH_FILE: z.string().min(1).default("/tmp/inquilink-email-worker-heartbeat"),
  BODY_LIMIT_BYTES: z.coerce.number().int().min(1_000_000).max(50_000_000).default(15_000_000),
  DOCUMENT_STORAGE_PATH: z.string().min(1).default("./data/documents"),
  DOCUMENT_STORAGE_MODE: z.enum(["unconfigured", "local", "gateway"]).default("unconfigured"),
  DOCUMENT_STORAGE_GATEWAY_URL: z.string().url().optional(),
  DOCUMENT_STORAGE_GATEWAY_TOKEN: z.string().min(20).optional(),
  MALWARE_SCANNER_MODE: z.enum(["unconfigured", "local", "webhook"]).default("unconfigured"),
  MALWARE_SCANNER_URL: z.string().url().optional(),
  MALWARE_SCANNER_TOKEN: z.string().min(20).optional(),
  DOCUMENT_MAX_BYTES: z.coerce.number().int().min(1_024).max(25_000_000).default(10_485_760),
  DOCUMENT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  APPLICATION_RETENTION_DAYS: z.coerce.number().int().min(30).max(3_650).optional(),
  ACCOUNT_CLOSURE_RETENTION_DAYS: z.coerce.number().int().min(0).max(3_650).optional(),
  PUBLIC_LINK_VAULT_SECRET: z.string().min(32).default("local-only-public-link-vault-secret-change-me"),
  DOCUMENT_ACCESS_TOKEN_SECRET: z.string().min(32).default("local-only-document-access-secret-change-me"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const normalized = { ...source };
  if (normalized.COOKIE_SECURE === undefined && normalized.NODE_ENV !== "production") normalized.COOKIE_SECURE = "false";
  if (normalized.ALLOW_LOCAL_PROVIDERS === undefined && normalized.NODE_ENV !== "production") normalized.ALLOW_LOCAL_PROVIDERS = "true";
  if (normalized.DOCUMENT_STORAGE_MODE === undefined && normalized.NODE_ENV !== "production") normalized.DOCUMENT_STORAGE_MODE = "local";
  if (normalized.MALWARE_SCANNER_MODE === undefined && normalized.NODE_ENV !== "production") normalized.MALWARE_SCANNER_MODE = "local";
  const config = schema.parse(normalized);
  if (config.NODE_ENV === "production") {
    if (config.ALLOW_LOCAL_PROVIDERS || config.EMAIL_TRANSPORT === "local" || config.DOCUMENT_STORAGE_MODE === "local" || config.MALWARE_SCANNER_MODE === "local") {
      throw new Error("Production local providers are forbidden.");
    }
    const localVaultSecret = "local-only-public-link-vault-secret-change-me";
    const localAccessSecret = "local-only-document-access-secret-change-me";
    if (config.PUBLIC_LINK_VAULT_SECRET === localVaultSecret || config.DOCUMENT_ACCESS_TOKEN_SECRET === localAccessSecret) {
      throw new Error("Production cryptographic secrets must be configured explicitly.");
    }
    if (new URL(config.APP_ORIGIN).protocol !== "https:") {
      throw new Error("Production APP_ORIGIN must use HTTPS.");
    }
    if (!config.COOKIE_SECURE) {
      throw new Error("Production session cookies must be secure.");
    }
    const databaseUrl = new URL(config.DATABASE_URL);
    if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") throw new Error("Production DATABASE_URL must use PostgreSQL.");
    if (!["require", "verify-ca", "verify-full"].includes(databaseUrl.searchParams.get("sslmode") ?? "")) {
      throw new Error("Production DATABASE_URL must require TLS (sslmode=verify-full recommended).");
    }
    if (config.EMAIL_TRANSPORT === "smtp") {
      if (!config.EMAIL_SMTP_HOST) throw new Error("Production SMTP host must be configured.");
      if (!config.EMAIL_SMTP_SECURE && !config.EMAIL_SMTP_REQUIRE_TLS) throw new Error("Production SMTP must require TLS.");
      if (Boolean(config.EMAIL_SMTP_USER) !== Boolean(config.EMAIL_SMTP_PASSWORD)) {
        throw new Error("Production SMTP user and password must be configured together.");
      }
    } else if (config.EMAIL_TRANSPORT === "webhook") {
      if (!config.EMAIL_PROVIDER_URL || !config.EMAIL_PROVIDER_TOKEN) throw new Error("Production email webhook credentials must be configured.");
    } else {
      throw new Error("Production email delivery must use TLS-secure SMTP or an HTTPS webhook.");
    }
    for (const value of [config.BILLING_PROVIDER_URL, config.EMAIL_PROVIDER_URL, config.DOCUMENT_STORAGE_GATEWAY_URL, config.MALWARE_SCANNER_URL]) {
      if (value && new URL(value).protocol !== "https:") throw new Error("Production provider URLs must use HTTPS.");
    }
  }
  return config;
}

export function trustedProxyRanges(config: Pick<Config, "TRUSTED_PROXY_RANGES">): string[] {
  return config.TRUSTED_PROXY_RANGES.split(",").map((value) => value.trim()).filter(Boolean);
}
