import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { createBillingProvider } from "./modules/billing/provider.js";
import { OutboxEmailProvider } from "./modules/email/provider.js";
import { createRentalProviders } from "./modules/rentals/providers.js";

const config = loadConfig();
const billingProvider = createBillingProvider(config);
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({
  config,
  db: database.db,
  billingProvider,
  emailProvider: new OutboxEmailProvider(database.db),
}, { rentals: createRentalProviders(config) });

const shutdown = async () => {
  await app.close();
  await database.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: config.HOST, port: config.PORT });
