import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "../config.js";
import { createDatabase } from "./client.js";
import { backfillSubmittedApplicationColumns, ensureApplicationScaleIndexes } from "./application-scale-migration.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);

try {
  await migrate(database.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  const promoted = await backfillSubmittedApplicationColumns(database.db);
  await ensureApplicationScaleIndexes(database.db);
  if (promoted > 0) console.info(`Promoted ${promoted} submitted applications in bounded batches.`);
  console.info("Database migrations completed.");
} finally {
  await database.close();
}
