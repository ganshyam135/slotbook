import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../../src/lib/db";
import {
  createHostEventType,
  deleteHostEventType,
  updateHostEventType,
} from "../../src/lib/host-management";
import type { EventTypeInput } from "../../src/lib/host-management";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!enabled)("PostgreSQL host event type management", () => {
  const suffix = randomUUID();
  let hostId = "";
  let otherHostId = "";

  const input: EventTypeInput = {
    name: "Planning session",
    slug: `planning-${suffix.slice(0, 8)}`,
    durationMinutes: 45,
    capacity: 4,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 5,
    minNoticeMinutes: 60,
    bookingHorizonDays: 45,
  };

  beforeAll(async () => {
    await db.$queryRaw`SELECT 1`;
    const [host, otherHost] = await Promise.all([
      db.host.create({
        data: {
          email: `event-management-${suffix}@example.test`,
          name: "Event management test host",
          slug: `event-management-${suffix}`,
          passwordHash: "not-used-by-integration-test",
        },
      }),
      db.host.create({
        data: {
          email: `event-management-other-${suffix}@example.test`,
          name: "Other event management host",
          slug: `event-management-other-${suffix}`,
          passwordHash: "not-used-by-integration-test",
        },
      }),
    ]);
    hostId = host.id;
    otherHostId = otherHost.id;
  });

  afterAll(async () => {
    if (hostId) await db.host.delete({ where: { id: hostId } });
    if (otherHostId) await db.host.delete({ where: { id: otherHostId } });
    await db.$disconnect();
  });

  it("creates and updates every configured event field in PostgreSQL", async () => {
    const created = await createHostEventType(hostId, input);
    expect(created).toMatchObject({
      name: input.name,
      slug: input.slug,
      durationMinutes: 45,
      capacity: 4,
      bufferBeforeMinutes: 10,
      bufferAfterMinutes: 5,
      minNoticeMinutes: 60,
      bookingHorizonDays: 45,
    });

    const updatedInput = { ...input, name: "Updated planning session", capacity: 6 };
    const updated = await updateHostEventType(hostId, created.id, updatedInput);
    expect(updated).toMatchObject({ name: updatedInput.name, capacity: 6 });
  });

  it("does not allow another host to update an event", async () => {
    const created = await createHostEventType(hostId, {
      ...input,
      slug: `private-${suffix.slice(0, 8)}`,
    });
    await expect(
      updateHostEventType(otherHostId, created.id, { ...input, slug: `stolen-${suffix.slice(0, 8)}` }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("deletes unbooked event types and retains event types with booking history", async () => {
    const deletable = await createHostEventType(hostId, {
      ...input,
      slug: `deletable-${suffix.slice(0, 8)}`,
    });
    await expect(deleteHostEventType(hostId, deletable.id)).resolves.toBeUndefined();
    expect(await db.eventType.findUnique({ where: { id: deletable.id } })).toBeNull();

    const retained = await createHostEventType(hostId, {
      ...input,
      slug: `retained-${suffix.slice(0, 8)}`,
    });
    await db.booking.create({
      data: {
        hostId,
        eventTypeId: retained.id,
        status: "cancelled",
        startUtc: new Date("2027-01-01T10:00:00Z"),
        endUtc: new Date("2027-01-01T10:45:00Z"),
      },
    });
    await expect(deleteHostEventType(hostId, retained.id)).rejects.toMatchObject({ status: 409 });
    expect(await db.eventType.findUnique({ where: { id: retained.id } })).not.toBeNull();
  });

  it("returns not found for a missing event", async () => {
    await expect(deleteHostEventType(hostId, `missing-${suffix}`)).rejects.toMatchObject({ status: 404 });
  });
});
