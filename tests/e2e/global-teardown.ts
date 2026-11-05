import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { getE2EDatabaseUrl } from "./database-url";
import type { E2EFixture } from "./fixture";

export default async function globalTeardown() {
  const fixturePath = join(process.cwd(), ".playwright", "fixture.json");
  if (!existsSync(fixturePath)) return;

  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as E2EFixture;
  if (
    !fixture.hostId ||
    !fixture.hostSlug.startsWith("e2e-") ||
    !fixture.email.startsWith("e2e-") ||
    !fixture.email.endsWith("@example.test")
  ) {
    throw new Error("Refusing to delete an unrecognized Playwright host fixture.");
  }

  const db = new PrismaClient({
    datasources: { db: { url: getE2EDatabaseUrl() } },
  });
  try {
    const host = await db.host.findUnique({ where: { id: fixture.hostId } });
    if (host) {
      if (host.slug !== fixture.hostSlug || host.email !== fixture.email) {
        throw new Error("Refusing to clean up a host that does not match the recorded E2E fixture.");
      }
      await db.host.delete({ where: { id: host.id } });
    }
    unlinkSync(fixturePath);
    console.log("Playwright host and associated test records removed; PostgreSQL schema and migrations retained.");
  } finally {
    await db.$disconnect();
  }
}
