import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config, parse } from "dotenv";

config();

const file = ".env.test.local";
if (existsSync(file)) {
  throw new Error(`${file} already exists; refusing to replace local test credentials.`);
}

const developmentDatabaseUrl = process.env.DATABASE_URL;
if (!developmentDatabaseUrl) {
  throw new Error("DATABASE_URL must be configured before creating the isolated test database URL.");
}

let developmentDatabase;
try {
  developmentDatabase = new URL(developmentDatabaseUrl);
} catch {
  throw new Error("DATABASE_URL is not a valid connection URL.");
}

if (!["postgres:", "postgresql:"].includes(developmentDatabase.protocol)) {
  throw new Error("DATABASE_URL must use PostgreSQL.");
}

const testDatabase = {
  hostname: "localhost",
  port: "5434",
  database: "slotbook_test",
};
if (
  developmentDatabase.hostname.toLowerCase() === testDatabase.hostname &&
  decodeURIComponent(developmentDatabase.pathname.slice(1)) === testDatabase.database
) {
  throw new Error("The isolated test database must differ from DATABASE_URL.");
}

const password = randomBytes(32).toString("hex");
const contents = [
  `SLOTBOOK_TEST_DB_PASSWORD=${password}`,
  `E2E_DATABASE_URL=postgresql://slotbook_test_app:${password}@localhost:5434/slotbook_test`,
  "",
].join("\n");
writeFileSync(file, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });

const localValues = parse(readFileSync(file));
if (!localValues.SLOTBOOK_TEST_DB_PASSWORD || !localValues.E2E_DATABASE_URL) {
  throw new Error("Could not verify the generated local test database configuration.");
}

console.log("Created ignored .env.test.local with credentials for the isolated slotbook_test database.");
