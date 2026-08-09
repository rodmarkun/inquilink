import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildApp } from "../app.js";
import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";
import { LocalBillingProvider } from "../modules/billing/provider.js";
import type { BillingProvider } from "../modules/billing/provider.js";
import type { EmailMessage, EmailProvider, EmailTemplateName } from "../modules/email/provider.js";
import type { RentalRouteOptions } from "../modules/rentals/routes.js";

export class MemoryEmailProvider implements EmailProvider {
  readonly messages: EmailMessage[] = [];
  private readonly dedupeKeys = new Set<string>();
  failTemplateOnce: EmailTemplateName | null = null;
  async send(message: EmailMessage): Promise<void> {
    if (this.failTemplateOnce === message.template) {
      this.failTemplateOnce = null;
      throw new Error("EMAIL_OUTBOX_ENQUEUE_FAILED");
    }
    if (message.dedupeKey && this.dedupeKeys.has(message.dedupeKey)) return;
    if (message.dedupeKey) this.dedupeKeys.add(message.dedupeKey);
    this.messages.push(message);
  }
}

export async function createTestApp(configOverrides: Partial<Config> = {}, now?: () => Date, overrides: { emailProvider?: EmailProvider; billingProvider?: BillingProvider; rentals?: RentalRouteOptions; loggerStream?: { write(chunk: string): void } } = {}) {
  const client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const db = pgliteDb as unknown as Database;
  const emailProvider = new MemoryEmailProvider();
  const config: Config = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3001,
    DATABASE_URL: "pglite://memory",
    APP_ORIGIN: "http://localhost:8080",
    TRUSTED_PROXY_RANGES: "",
    SESSION_TTL_DAYS: 30,
    TOKEN_TTL_MINUTES: 60,
    AUTH_EMAIL_COOLDOWN_SECONDS: 0,
    COOKIE_SECURE: false,
    ALLOW_LOCAL_PROVIDERS: true,
    EMAIL_TRANSPORT: "local",
    EMAIL_WORKER_INTERVAL_MS: 15_000,
    EMAIL_WORKER_ONCE: true,
    BODY_LIMIT_BYTES: 15_000_000,
    DOCUMENT_STORAGE_PATH: "./data/test-documents",
    DOCUMENT_STORAGE_MODE: "local",
    DOCUMENT_STORAGE_GATEWAY_URL: undefined,
    DOCUMENT_STORAGE_GATEWAY_TOKEN: undefined,
    MALWARE_SCANNER_MODE: "local",
    MALWARE_SCANNER_URL: undefined,
    MALWARE_SCANNER_TOKEN: undefined,
    DOCUMENT_MAX_BYTES: 10_485_760,
    DOCUMENT_ACCESS_TTL_SECONDS: 300,
    ACCOUNT_CLOSURE_RETENTION_DAYS: undefined,
    PUBLIC_LINK_VAULT_SECRET: "test-public-link-vault-secret-32-bytes-minimum",
    DOCUMENT_ACCESS_TOKEN_SECRET: "test-document-access-token-secret-32-bytes-minimum",
    EMAIL_SMTP_PORT: 1025,
    EMAIL_SMTP_SECURE: false,
    EMAIL_SMTP_REQUIRE_TLS: false,
    EMAIL_FROM: "no-reply@inquilink.test",
    EMAIL_WORKER_HEALTH_FILE: "/tmp/inquilink-test-email-worker-heartbeat",
    LOG_LEVEL: "silent",
    ...configOverrides,
  };
  const app = await buildApp(
    { config, db, emailProvider: overrides.emailProvider ?? emailProvider, billingProvider: overrides.billingProvider ?? new LocalBillingProvider(), ...(now ? { now } : {}) },
    { ...(overrides.rentals ? { rentals: overrides.rentals } : {}), ...(overrides.loggerStream ? { loggerStream: overrides.loggerStream } : {}) },
  );
  return {
    app,
    db,
    emailProvider,
    close: async () => { await app.close(); await client.close(); },
  };
}

export function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }): string {
  const value = response.headers["set-cookie"];
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error("Expected a session cookie");
  return cookie.split(";", 1)[0] ?? "";
}
