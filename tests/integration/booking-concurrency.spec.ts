import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../../src/lib/db";
import {
  BookingError,
  cancelBooking,
  confirmHold,
  createHold,
  rescheduleBooking,
} from "../../src/lib/booking-service";
import { managementTokenForBooking } from "../../src/lib/auth";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const suite = describe.skipIf(!enabled)("PostgreSQL booking concurrency", () => {
  const suffix = randomUUID();
  let hostId = "";
  let singleEventId = "";
  let groupEventId = "";

  async function createEvent(slug: string, capacity: number) {
    return db.eventType.create({
      data: {
        hostId,
        name: slug,
        slug: `${slug}-${suffix}`,
        durationMinutes: 60,
        capacity,
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
  }

  function slot(daysAhead: number, hour: number) {
    return DateTime.utc().plus({ days: daysAhead }).startOf("day").set({ hour }).toJSDate();
  }

  function hashRequest(eventTypeId: string, start: Date, guest: string) {
    return createHash("sha256")
      .update(JSON.stringify({
        eventTypeId,
        start: start.toISOString(),
        timezone: "UTC",
        guestName: guest,
        guestEmail: `${guest}@example.test`,
      }))
      .digest("hex");
  }

  function hold(eventTypeId: string, start: Date, guest: string, idempotencyKey?: string) {
    return createHold({
      eventTypeId,
      start,
      guestName: guest,
      guestEmail: `${guest}@example.test`,
      idempotencyKey,
      requestHash: hashRequest(eventTypeId, start, guest),
    });
  }

  beforeAll(async () => {
    await db.$queryRaw`SELECT 1`;
    const host = await db.host.create({
      data: {
        email: `test-${suffix}@example.test`,
        name: "Concurrency test host",
        slug: `test-${suffix}`,
        passwordHash: "not-used-by-integration-test",
        timezone: "UTC",
      },
    });
    hostId = host.id;
    singleEventId = (await createEvent("single", 1)).id;
    groupEventId = (await createEvent("group", 3)).id;
  });

  afterAll(async () => {
    if (hostId) await db.host.delete({ where: { id: hostId } });
    await db.$disconnect();
  });

  it("allows only one simultaneous hold for a capacity-one event", async () => {
    const start = slot(7, 9);
    const attempts = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) => hold(singleEventId, start, `single-${index}`, randomUUID())),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const conflicts = attempts.filter(
      (attempt) => attempt.status === "rejected" && attempt.reason instanceof BookingError && attempt.reason.status === 409,
    );
    expect(conflicts).toHaveLength(1);
  });

  it("never exceeds limited group capacity under simultaneous requests", async () => {
    const start = slot(8, 10);
    const attempts = await Promise.allSettled(
      Array.from({ length: 9 }, (_, index) => hold(groupEventId, start, `group-${index}`, randomUUID())),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(3);
    const active = await db.booking.count({
      where: {
        eventTypeId: groupEventId,
        startUtc: start,
        status: "held",
        expiresAt: { gt: new Date() },
      },
    });
    expect(active).toBe(3);
  });

  it("allows only one of two simultaneous reschedules into a capacity-one slot", async () => {
    const firstHold = await hold(singleEventId, slot(10, 9), "reschedule-a");
    const secondHold = await hold(singleEventId, slot(10, 10), "reschedule-b");
    await confirmHold(firstHold.id);
    await confirmHold(secondHold.id);
    const target = slot(11, 11);
    const results = await Promise.allSettled([
      rescheduleBooking(managementTokenForBooking(firstHold.id), target),
      rescheduleBooking(managementTokenForBooking(secondHold.id), target),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(
      (result) => result.status === "rejected" && result.reason instanceof BookingError && result.reason.status === 409,
    )).toHaveLength(1);
    const current = await db.booking.findMany({
      where: { id: { in: [firstHold.id, secondHold.id] }, startUtc: target, status: "confirmed" },
    });
    expect(current).toHaveLength(1);
  });

  it("serializes retries with the same idempotency key into one hold", async () => {
    const start = slot(12, 12);
    const key = randomUUID();
    const attempts = await Promise.all([
      hold(singleEventId, start, "idempotent", key),
      hold(singleEventId, start, "idempotent", key),
    ]);
    expect(attempts[0].id).toBe(attempts[1].id);
    expect(attempts.filter((attempt) => attempt.replay)).toHaveLength(1);
    expect(await db.booking.count({ where: { id: attempts[0].id } })).toBe(1);
    await expect(
      hold(singleEventId, start, "different-request", key),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("expires holds using database time and rejects late confirmation", async () => {
    const start = slot(13, 13);
    const held = await hold(singleEventId, start, "expired-guest");
    const created = await db.booking.findUniqueOrThrow({ where: { id: held.id } });
    const remaining = await db.$queryRaw<Array<{ milliseconds: number }>>`
      SELECT (EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp())) * 1000)::int AS "milliseconds"
      FROM "Booking" WHERE "id" = ${held.id}
    `;
    expect(remaining[0].milliseconds).toBeGreaterThan(298_000);
    expect(remaining[0].milliseconds).toBeLessThanOrEqual(300_000);
    await db.booking.update({
      where: { id: held.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await expect(confirmHold(held.id)).rejects.toMatchObject({ status: 409 });
    expect((await db.booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("expired");
    const replacement = await hold(singleEventId, start, "replacement-after-expiry");
    expect(replacement.id).not.toBe(created.id);
  });

  it("confirms a hold at most once under concurrent retries", async () => {
    const held = await hold(singleEventId, slot(15, 13), "confirm-once");
    const results = await Promise.allSettled([confirmHold(held.id), confirmHold(held.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(
      (result) => result.status === "rejected" && result.reason instanceof BookingError && result.reason.status === 409,
    )).toHaveLength(1);
    expect(
      await db.notification.count({ where: { bookingId: held.id, type: "booking_confirmed" } }),
    ).toBe(1);
  });

  it("holds a slot before guest details and saves the details when confirmed", async () => {
    const start = slot(16, 15);
    const held = await createHold({
      eventTypeId: singleEventId,
      start,
      requestHash: "guest-details-added-at-confirmation",
    });
    expect(await db.booking.findUniqueOrThrow({ where: { id: held.id } })).toMatchObject({
      status: "held",
      guestName: null,
      guestEmail: null,
    });
    await expect(confirmHold(held.id)).rejects.toMatchObject({ status: 400 });

    await confirmHold(held.id, {
      guestName: "Guest After Hold",
      guestEmail: "guest-after-hold@example.test",
    });
    expect(await db.booking.findUniqueOrThrow({ where: { id: held.id } })).toMatchObject({
      status: "confirmed",
      guestName: "Guest After Hold",
      guestEmail: "guest-after-hold@example.test",
    });
    const notification = await db.notification.findFirstOrThrow({
      where: { bookingId: held.id, type: "booking_confirmed" },
    });
    expect(notification.payload).toMatchObject({
      guestName: "Guest After Hold",
      guestEmail: "guest-after-hold@example.test",
    });
  });

  it("releases capacity after cancellation and preserves a booking when a reschedule conflicts", async () => {
    const first = await hold(singleEventId, slot(14, 9), "cancelled-guest");
    await confirmHold(first.id);
    const firstToken = managementTokenForBooking(first.id);
    await cancelBooking(firstToken, "test cancellation");
    const replacement = await hold(singleEventId, slot(14, 9), "replacement");
    expect(replacement.id).not.toBe(first.id);

    await confirmHold(replacement.id);
    const blocker = await hold(singleEventId, slot(14, 10), "blocking-guest");
    await confirmHold(blocker.id);
    await expect(
      rescheduleBooking(managementTokenForBooking(replacement.id), slot(14, 10)),
    ).rejects.toMatchObject({ status: 409 });
    const unchanged = await db.booking.findUniqueOrThrow({ where: { id: replacement.id } });
    expect(unchanged.startUtc).toEqual(slot(14, 9));
  });
});

void suite;
