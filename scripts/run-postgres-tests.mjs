import "dotenv/config";
import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/integration"],
  {
    stdio: "inherit",
    env: { ...process.env, RUN_POSTGRES_INTEGRATION: "1" },
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
