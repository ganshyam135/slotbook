import { spawn, spawnSync } from "node:child_process";
import { config } from "dotenv";

config();
config({ path: ".env.test.local", override: true });

const configuredTestUrl = process.env.E2E_DATABASE_URL;
if (!configuredTestUrl) {
  throw new Error(
    "Set up .env.test.local with npm run db:test:env before starting the local app.",
  );
}
if (!process.env.HOST_PASSWORD || process.env.HOST_PASSWORD.length < 12) {
  throw new Error("Set HOST_PASSWORD to at least 12 characters in .env before starting the app.");
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
  return url;
}

const databaseUrl = parseDatabaseUrl(configuredTestUrl, "E2E_DATABASE_URL");
if (
  !["localhost", "127.0.0.1"].includes(databaseUrl.hostname.toLowerCase()) ||
  databaseUrl.port !== "5434" ||
  decodeURIComponent(databaseUrl.pathname.slice(1)) !== "slotbook_test"
) {
  throw new Error(
    "The local app bootstrap only accepts the isolated slotbook_test database on localhost:5434.",
  );
}

if (process.env.DATABASE_URL) {
  const developmentUrl = parseDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
  if (
    developmentUrl.hostname.toLowerCase() === databaseUrl.hostname.toLowerCase() &&
    decodeURIComponent(developmentUrl.pathname.slice(1)) ===
      decodeURIComponent(databaseUrl.pathname.slice(1))
  ) {
    throw new Error(
      "The app database must differ from DATABASE_URL; refusing to run setup against the development database.",
    );
  }
}

databaseUrl.searchParams.set("schema", "public");
const appEnvironment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(),
};

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

run("docker", ["compose", "--env-file", ".env.test.local", "up", "-d", "db"]);

let healthy = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const result = spawnSync(
    "docker",
    ["inspect", "--format={{.State.Health.Status}}", "slotbook-test-postgres"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  if (result.status === 0 && result.stdout.trim() === "healthy") {
    healthy = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
if (!healthy) {
  throw new Error("Slotbook PostgreSQL did not become healthy within 120 seconds.");
}

const node = process.execPath;
run(node, ["node_modules/prisma/build/index.js", "migrate", "deploy"], appEnvironment);
run(node, ["node_modules/tsx/dist/cli.mjs", "src/lib/seed.ts"], appEnvironment);

const next = spawn(node, ["node_modules/next/dist/bin/next", "dev"], {
  env: appEnvironment,
  stdio: "inherit",
});
process.on("SIGINT", () => next.kill("SIGINT"));
process.on("SIGTERM", () => next.kill("SIGTERM"));
next.on("error", (error) => {
  console.error("Could not start the Next.js development server:", error);
  process.exitCode = 1;
});
next.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
