import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../../src/lib/db";
import {
  createAvailabilityOverride,
  createHostEventType,
  deleteAvailabilityOverride,
  listAvailabilityOverrides,
  listWeeklyAvailability,
  replaceWeeklyAvailability,
  updateAvailabilityOverride,
} from "../../src/lib/host-management";
import type { EventTypeInput } from "../../src/lib/host-management";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)("PostgreSQL host availability and date overrides", () => {
  const suffix = randomUUID();
  let hostId = "";
  let otherHostId = "";
  let eventTypeId = "";

  const eventInput: EventTypeInput = {
    name: "Availability integration",
    slug: `availability-${suffix.slice(0, 8)}`,
    durationMinutes: 30,
    capacity: 1,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    bookingHorizonDays: 45,
  };

  beforeAll(async () => {
    await db.$queryRaw`SELECT 1`;
    const [host, otherHost] = await Promise.all([
      db.host.create({
        data: {
          email: `availability-${suffix}@example.test`,
          name: "Availability test host",
          slug: `availability-${suffix}`,
          passwordHash: "not-used-by-integration-test",
        },
      }),
      db.host.create({
        data: {
          email: `availability-other-${suffix}@example.test`,
          name: "Other availability host",
          slug: `availability-other-${suffix}`,
          passwordHash: "not-used-by-integration-test",
        },
      }),
    ]);
    hostId = host.id;
    otherHostId = otherHost.id;
    eventTypeId = (await createHostEventType(hostId, eventInput)).id;
  });

  afterAll(async () => {
    if (hostId) await db.host.delete({ where: { id: hostId } });
    if (otherHostId) await db.host.delete({ where: { id: otherHostId } });
    await db.$disconnect();
  });

  it("replaces weekly rules with multiple windows and supports disabling a day", async () => {
    const saved = await replaceWeeklyAvailability(hostId, eventTypeId, {
      windows: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 780, endMinute: 1020 },
        { dayOfWeek: 3, startMinute: 600, endMinute: 900 },
      ],
    });
    expect(saved).toHaveLength(3);
    expect(await listWeeklyAvailability(hostId, eventTypeId)).toHaveLength(3);

    const disabled = await replaceWeeklyAvailability(hostId, eventTypeId, {
      windows: [{ dayOfWeek: 3, startMinute: 600, endMinute: 900 }],
    });
    expect(disabled).toMatchObject([{ dayOfWeek: 3, startMinute: 600, endMinute: 900 }]);
  });

  it("restricts weekly schedule reads to the owning host", async () => {
    await expect(listWeeklyAvailability(otherHostId, eventTypeId)).rejects.toMatchObject({ status: 404 });
  });

  it("creates, edits, lists, and deletes date overrides", async () => {
    const unavailable = await createAvailabilityOverride(hostId, eventTypeId, {
      localDate: "2027-01-03",
      isUnavailable: true,
    });
    expect(unavailable).toMatchObject({ localDate: "2027-01-03", isUnavailable: true });

    await expect(
      createAvailabilityOverride(hostId, eventTypeId, {
        localDate: "2027-01-03",
        isUnavailable: true,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const customHours = await updateAvailabilityOverride(hostId, eventTypeId, unavailable.id, {
      localDate: "2027-01-03",
      isUnavailable: false,
      startMinute: 600,
      endMinute: 900,
    });
    expect(customHours).toMatchObject({
      localDate: "2027-01-03",
      isUnavailable: false,
      startMinute: 600,
      endMinute: 900,
    });

    expect(await listAvailabilityOverrides(hostId, eventTypeId)).toMatchObject([
      { id: unavailable.id, localDate: "2027-01-03", isUnavailable: false },
    ]);
    await deleteAvailabilityOverride(hostId, eventTypeId, unavailable.id);
    expect(await listAvailabilityOverrides(hostId, eventTypeId)).toHaveLength(0);
  });
});
