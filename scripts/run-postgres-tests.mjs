import "dotenv/config";
import { execFileSync, spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const integrationDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!integrationDatabaseUrl) {
  throw new Error(
    "Set E2E_DATABASE_URL to a dedicated PostgreSQL test database; refusing to run integration tests against DATABASE_URL.",
  );
}

function parseDatabaseUrl(value, name) {
  let url;
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

function databaseIdentity(url) {
  return {
    hostname: url.hostname.toLowerCase(),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

const testUrl = parseDatabaseUrl(integrationDatabaseUrl, "E2E_DATABASE_URL");
if (process.env.DATABASE_URL) {
  const appUrl = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const testIdentity = databaseIdentity(testUrl);
  const appIdentity = databaseIdentity(appUrl);
  if (
    testIdentity.hostname === appIdentity.hostname &&
    testIdentity.database === appIdentity.database
  ) {
    throw new Error(
      "E2E_DATABASE_URL must target a different PostgreSQL database than DATABASE_URL; the development database will not be modified.",
    );
  }
}

const integrationUrl = new URL(testUrl);
integrationUrl.searchParams.set("schema", "slotbook_integration");
const bootstrapUrl = new URL(testUrl);
bootstrapUrl.searchParams.set("schema", "public");
const testEnvironment = {
  ...process.env,
  DATABASE_URL: integrationUrl.toString(),
  RUN_POSTGRES_INTEGRATION: "1",
};

const bootstrapDb = new PrismaClient({
  datasources: { db: { url: bootstrapUrl.toString() } },
});
try {
  await bootstrapDb.$executeRaw`CREATE SCHEMA IF NOT EXISTS "slotbook_integration"`;
} finally {
  await bootstrapDb.$disconnect();
}

execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { stdio: "inherit", env: testEnvironment },
);

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/integration"],
  {
    stdio: "inherit",
    env: testEnvironment,
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
