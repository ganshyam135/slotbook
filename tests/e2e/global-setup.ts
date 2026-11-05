import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { getE2EDatabaseUrl } from "./database-url";
import type { E2EFixture } from "./fixture";

const fixturePath = join(process.cwd(), ".playwright", "fixture.json");

interface PreviousFixture {
  hostId?: string;
  hostSlug?: string;
  email?: string;
}

function isOwnedFixture(value: PreviousFixture): value is Required<PreviousFixture> {
  return Boolean(
    value.hostId &&
    value.hostSlug?.startsWith("e2e-") &&
    value.email?.startsWith("e2e-") &&
    value.email.endsWith("@example.test"),
  );
}

export default async function globalSetup() {
  const databaseUrl = getE2EDatabaseUrl();
  const url = new URL(databaseUrl);
  const schema = url.searchParams.get("schema");
  if (schema !== "slotbook_e2e") {
    throw new Error("Refusing to run E2E setup outside the isolated slotbook_e2e schema.");
  }

  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS "slotbook_e2e"');

    if (existsSync(fixturePath)) {
      const previous = JSON.parse(readFileSync(fixturePath, "utf8")) as PreviousFixture;
      if (!isOwnedFixture(previous)) {
        throw new Error("Refusing to overwrite an unrecognized Playwright fixture record.");
      }
      const host = await db.host.findUnique({ where: { id: previous.hostId } });
      if (host && (host.slug !== previous.hostSlug || host.email !== previous.email)) {
        throw new Error("Refusing to clean up a host that does not match the recorded E2E fixture.");
      }
      if (host) {
        await db.host.delete({ where: { id: host.id } });
      }
    }

    execFileSync(
      process.execPath,
      [resolve("node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
      {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );

    const suffix = randomUUID();
    const hostSlug = `e2e-${suffix}`;
    const email = `e2e-${suffix}@example.test`;
    const password = randomBytes(24).toString("base64url");
    const hostName = "Slotbook E2E Host";
    const host = await db.host.create({
      data: {
        email,
        name: hostName,
        slug: hostSlug,
        passwordHash: await bcrypt.hash(password, 10),
        timezone: "UTC",
      },
    });

    const guestEventSlug = `guest-flow-${suffix}`;
    try {
      const guestEvent = await db.eventType.create({
        data: {
          hostId: host.id,
          name: "E2E Guest Booking",
          slug: guestEventSlug,
          durationMinutes: 30,
          capacity: 1,
          minNoticeMinutes: 0,
          bookingHorizonDays: 45,
          availabilityRules: {
            create: Array.from({ length: 7 }, (_, dayOfWeek) => ({
              dayOfWeek,
              startMinute: 540,
              endMinute: 1020,
            })),
          },
        },
      });

      const fixture: E2EFixture = {
        hostId: host.id,
        hostName,
        hostSlug,
        email,
        password,
        guestEventId: guestEvent.id,
        guestEventSlug: guestEvent.slug,
      };
      mkdirSync(join(process.cwd(), ".playwright"), { recursive: true });
      writeFileSync(fixturePath, JSON.stringify(fixture), { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      await db.host.delete({ where: { id: host.id } });
      throw error;
    }

    console.log(`Playwright fixtures migrated and created in PostgreSQL schema "${schema}".`);
  } finally {
    await db.$disconnect();
  }
}
