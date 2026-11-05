import { config } from "dotenv";

config();

export const E2E_SCHEMA = "slotbook_e2e";

export function getE2EDatabaseUrl() {
  const configuredUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!configuredUrl) {
    throw new Error("Set E2E_DATABASE_URL or DATABASE_URL to a PostgreSQL test database.");
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("The E2E database URL must be a valid PostgreSQL connection URL.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Playwright E2E tests require PostgreSQL; other database providers are not supported.");
  }

  const database = url.pathname.slice(1);
  if (!database || ["postgres", "template0", "template1"].includes(database)) {
    throw new Error("Configure an application or dedicated test database for Playwright E2E tests.");
  }

  url.searchParams.set("schema", E2E_SCHEMA);
  return url.toString();
}
