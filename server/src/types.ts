import type { Config } from "./config.js";
import type { Database } from "./db/client.js";
import type { BillingProvider } from "./modules/billing/provider.js";
import type { EmailProvider } from "./modules/email/provider.js";

export interface AuthenticatedUser {
  id: string;
  kind: "agency" | "tenant";
  email: string;
  fullName: string;
  emailVerified: boolean;
}

export interface AgencyContext {
  id: string;
  name: string;
  role: "admin" | "collaborator";
}

export interface AppDependencies {
  config: Config;
  db: Database;
  emailProvider: EmailProvider;
  billingProvider: BillingProvider;
  now?: () => Date;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser: AuthenticatedUser | null;
    currentAgency: AgencyContext | null;
    sessionId: string | null;
  }
}
