import { createHash } from "node:crypto";
import type { Config } from "../../config.js";
import { AesGcmPublicLinkTokenVault } from "./public-link-vault.js";
import type { RentalRouteOptions } from "./routes.js";
import {
  DocumentAccessTokens,
  GatewayPrivateDocumentStorage,
  LocalDeterministicDocumentScanner,
  LocalPrivateDocumentStorage,
  WebhookDocumentScanner,
} from "./storage.js";
import type { PrivateDocumentStorage } from "./storage.js";

export function createPrivateDocumentStorage(config: Config): PrivateDocumentStorage {
  const storage = config.DOCUMENT_STORAGE_MODE === "gateway" && config.DOCUMENT_STORAGE_GATEWAY_URL && config.DOCUMENT_STORAGE_GATEWAY_TOKEN
    ? new GatewayPrivateDocumentStorage(config.DOCUMENT_STORAGE_GATEWAY_URL, config.DOCUMENT_STORAGE_GATEWAY_TOKEN)
    : config.DOCUMENT_STORAGE_MODE === "local" && config.ALLOW_LOCAL_PROVIDERS
      ? new LocalPrivateDocumentStorage(config.DOCUMENT_STORAGE_PATH)
      : null;
  if (!storage) throw new Error("Private document storage is not configured. Refusing to start.");
  return storage;
}

export function createRentalProviders(config: Config): Required<Pick<RentalRouteOptions, "storage" | "scanner" | "accessTokens" | "publicLinkVault">> {
  const storage = createPrivateDocumentStorage(config);

  const scanner = config.MALWARE_SCANNER_MODE === "webhook" && config.MALWARE_SCANNER_URL && config.MALWARE_SCANNER_TOKEN
    ? new WebhookDocumentScanner(config.MALWARE_SCANNER_URL, config.MALWARE_SCANNER_TOKEN)
    : config.MALWARE_SCANNER_MODE === "local" && config.ALLOW_LOCAL_PROVIDERS
      ? new LocalDeterministicDocumentScanner()
      : null;
  if (!scanner) throw new Error("A malware scanner is not configured. Refusing to start.");

  return {
    storage,
    scanner,
    accessTokens: new DocumentAccessTokens(createHash("sha256").update(config.DOCUMENT_ACCESS_TOKEN_SECRET, "utf8").digest()),
    publicLinkVault: new AesGcmPublicLinkTokenVault(config.PUBLIC_LINK_VAULT_SECRET),
  };
}
