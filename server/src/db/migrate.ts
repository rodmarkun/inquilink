import { migrate } from "drizzle-orm/postgres-js/migrator";
import { loadConfig } from "../config.js";
import { createDatabase } from "./client.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);

try {
  await migrate(database.db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  console.info("Database migrations completed.");
} finally {
  await database.close();
}
