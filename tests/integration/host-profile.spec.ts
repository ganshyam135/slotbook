import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../../src/lib/db";
import { updateHostProfile } from "../../src/lib/host-management";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)("PostgreSQL host profile", () => {
  const suffix = randomUUID();
  let hostId = "";

  beforeAll(async () => {
    await db.$queryRaw`SELECT 1`;
    const host = await db.host.create({
      data: {
        email: `profile-${suffix}@example.test`,
        name: "Original profile name",
        slug: `profile-${suffix}`,
        passwordHash: "not-used-by-integration-test",
        timezone: "UTC",
      },
    });
    hostId = host.id;
  });

  afterAll(async () => {
    if (hostId) await db.host.delete({ where: { id: hostId } });
    await db.$disconnect();
  });

  it("persists the host name and home timezone in PostgreSQL", async () => {
    const updated = await updateHostProfile(hostId, {
      name: "Updated profile name",
      timezone: "America/Los_Angeles",
    });
    expect(updated).toMatchObject({
      id: hostId,
      name: "Updated profile name",
      timezone: "America/Los_Angeles",
    });

    const stored = await db.host.findUniqueOrThrow({ where: { id: hostId } });
    expect(stored.name).toBe("Updated profile name");
    expect(stored.timezone).toBe("America/Los_Angeles");
  });
});
