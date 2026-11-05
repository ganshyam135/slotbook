import { config } from "dotenv";

config();

export const E2E_SCHEMA = "slotbook_e2e";

export function getE2EDatabaseUrl() {
  const configuredUrl = process.env.E2E_DATABASE_URL;
  if (!configuredUrl) {
    throw new Error(
      "Set E2E_DATABASE_URL to a dedicated PostgreSQL test database; refusing to run E2E tests against DATABASE_URL.",
    );
  }

  const url = parsePostgresDatabaseUrl(configuredUrl, "E2E_DATABASE_URL");
  if (process.env.DATABASE_URL) {
    const appUrl = parsePostgresDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
    if (
      url.hostname.toLowerCase() === appUrl.hostname.toLowerCase() &&
      decodeURIComponent(url.pathname.slice(1)) === decodeURIComponent(appUrl.pathname.slice(1))
    ) {
      throw new Error(
        "E2E_DATABASE_URL must target a different PostgreSQL database than DATABASE_URL; the development database will not be modified.",
      );
    }
  }

  url.searchParams.set("schema", E2E_SCHEMA);
  return url.toString();
}

function parsePostgresDatabaseUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${name} must use PostgreSQL.`);
  }

  const database = url.pathname.slice(1);
  if (!database || ["postgres", "template0", "template1"].includes(database)) {
    throw new Error(`${name} must target a dedicated application/test database.`);
  }
  return url;
}
