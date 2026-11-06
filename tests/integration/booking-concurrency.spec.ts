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
import { GET as getPublicSlots } from "../../src/app/api/hosts/[host]/events/[slug]/slots/route";

const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const suite = describe.skipIf(!enabled)("PostgreSQL booking concurrency", () => {
  const suffix = randomUUID();
  let hostId = "";
  let hostSlug = "";
  let singleEventId = "";
  let singleEventSlug = "";
  let groupEventId = "";
  let otherEventId = "";
  let otherEventSlug = "";

  async function createEvent(
    slug: string,
    capacity: number,
    options: { durationMinutes?: number; bufferBeforeMinutes?: number; bufferAfterMinutes?: number } = {},
  ) {
    return db.eventType.create({
      data: {
        hostId,
        name: slug,
        slug: `${slug}-${suffix}`,
        durationMinutes: options.durationMinutes ?? 60,
        capacity,
        bufferBeforeMinutes: options.bufferBeforeMinutes ?? 0,
        bufferAfterMinutes: options.bufferAfterMinutes ?? 0,
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
    hostSlug = host.slug;
    const singleEvent = await createEvent("single", 1);
    singleEventId = singleEvent.id;
    singleEventSlug = singleEvent.slug;
    groupEventId = (await createEvent("group", 3)).id;
    const otherEvent = await createEvent("other", 1, {
      durationMinutes: 30,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 10,
    });
    otherEventId = otherEvent.id;
    otherEventSlug = otherEvent.slug;
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

  it("allows non-overlapping bookings for different event types", async () => {
    const first = await hold(singleEventId, slot(18, 9), "different-event-a");
    const second = await hold(otherEventId, slot(18, 11), "different-event-b");

    expect(first.status).toBe("held");
    expect(second.status).toBe("held");
  });

  it("omits another event type's slot from the public availability response", async () => {
    const blockedSlot = slot(27, 9);
    await hold(singleEventId, blockedSlot, "public-availability-blocker");
    const from = slot(27, 0);
    const url = new URL("http://localhost/api/hosts/test/events/other/slots");
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", new Date(from.getTime() + 24 * 60 * 60_000).toISOString());
    url.searchParams.set("tz", "UTC");
    const response = await getPublicSlots(new Request(url), {
      params: Promise.resolve({ host: hostSlug, slug: otherEventSlug }),
    });
    const body = await response.json() as { slots: Array<{ start: string }> };

    expect(response.status).toBe(200);
    expect(body.slots.some((available) => available.start === blockedSlot.toISOString())).toBe(false);
  });

  it("allows only the matching confirmed management token to exclude its own booking", async () => {
    const start = slot(29, 9);
    const booking = await hold(singleEventId, start, "self-exclusion");
    await confirmHold(booking.id);
    const token = managementTokenForBooking(booking.id);
    const from = slot(29, 0);
    const url = new URL("http://localhost/api/hosts/test/events/single/slots");
    url.searchParams.set("from", from.toISOString());
    url.searchParams.set("to", new Date(from.getTime() + 24 * 60 * 60_000).toISOString());
    url.searchParams.set("tz", "UTC");
    const params = Promise.resolve({ host: hostSlug, slug: singleEventSlug });
    const publicResponse = await getPublicSlots(new Request(url), { params });
    const ownResponse = await getPublicSlots(
      new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
      { params },
    );
    const invalidResponse = await getPublicSlots(
      new Request(url, { headers: { Authorization: `Bearer ${"0".repeat(64)}` } }),
      { params },
    );
    const mismatchedEventResponse = await getPublicSlots(
      new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({ host: hostSlug, slug: otherEventSlug }) },
    );

    expect(publicResponse.status).toBe(200);
    expect(ownResponse.status).toBe(200);
    expect(invalidResponse.status).toBe(404);
    expect(mismatchedEventResponse.status).toBe(404);
    const publicBody = await publicResponse.json() as { slots: Array<{ start: string }> };
    const ownBody = await ownResponse.json() as { slots: Array<{ start: string }> };
    expect(publicBody.slots.some((available) => available.start === start.toISOString())).toBe(false);
    expect(ownBody.slots.some((available) => available.start === start.toISOString())).toBe(true);
  });

  it("allows only one overlapping hold across different event types", async () => {
    const start = slot(19, 9);
    const attempts = await Promise.allSettled([
      hold(singleEventId, start, "cross-event-a", randomUUID()),
      hold(otherEventId, start, "cross-event-b", randomUUID()),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(
      (attempt) => attempt.status === "rejected" && attempt.reason instanceof BookingError && attempt.reason.status === 409,
    )).toHaveLength(1);
  });

  it("serializes many simultaneous requests competing for the host calendar", async () => {
    const start = slot(20, 9);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        hold(index % 2 === 0 ? singleEventId : otherEventId, start, `host-race-${index}`, randomUUID()),
      ),
    );

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(
      (attempt) => attempt.status === "rejected" && attempt.reason instanceof BookingError && attempt.reason.status === 409,
    )).toHaveLength(7);
  });

  it("treats an active hold for another event type as blocking the host calendar", async () => {
    const start = slot(21, 9);
    await hold(singleEventId, start, "host-calendar-active-hold");

    await expect(hold(otherEventId, start, "blocked-by-active-hold"))
      .rejects.toMatchObject({ status: 409 });
  });

  it("releases the host calendar when a hold expires", async () => {
    const start = slot(22, 9);
    const held = await hold(singleEventId, start, "host-calendar-expired-hold");
    await db.booking.update({
      where: { id: held.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const replacement = await hold(otherEventId, start, "available-after-expiry");
    expect(replacement.status).toBe("held");
  });

  it("releases the host calendar when a booking is cancelled", async () => {
    const start = slot(23, 9);
    const held = await hold(singleEventId, start, "host-calendar-cancelled");
    await confirmHold(held.id);
    await cancelBooking(managementTokenForBooking(held.id), "test cancellation");

    const replacement = await hold(otherEventId, start, "available-after-cancellation");
    expect(replacement.status).toBe("held");
  });

  it("preserves the original booking when rescheduling into another event's occupied interval", async () => {
    const originalStart = slot(24, 9);
    const target = slot(24, 11);
    const moving = await hold(singleEventId, originalStart, "cross-event-reschedule");
    await confirmHold(moving.id);
    await hold(otherEventId, target, "cross-event-reschedule-blocker");

    await expect(rescheduleBooking(managementTokenForBooking(moving.id), target))
      .rejects.toMatchObject({ status: 409 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: moving.id } }))
      .toMatchObject({ startUtc: originalStart, status: "confirmed" });
  });

  it("releases the old host-calendar interval after a successful reschedule", async () => {
    const originalStart = slot(26, 9);
    const newStart = slot(26, 11);
    const moving = await hold(singleEventId, originalStart, "successful-host-reschedule");
    await confirmHold(moving.id);
    await rescheduleBooking(managementTokenForBooking(moving.id), newStart);

    const notification = await db.notification.findFirstOrThrow({
      where: { bookingId: moving.id, type: "booking_rescheduled" },
    });
    expect(notification.payload).toMatchObject({
      previousStartUtc: originalStart.toISOString(),
      newStartUtc: newStart.toISOString(),
    });
    expect(await db.notification.count({
      where: { bookingId: moving.id, type: "booking_rescheduled" },
    })).toBe(1);

    const replacement = await hold(otherEventId, originalStart, "rebook-released-interval");
    expect(replacement.status).toBe("held");
    expect(await db.booking.findUniqueOrThrow({ where: { id: moving.id } }))
      .toMatchObject({ startUtc: newStart, status: "confirmed" });
  });

  it("rejects confirmation if another event already occupies the held interval", async () => {
    const start = slot(25, 9);
    const held = await hold(singleEventId, start, "confirmation-conflict");
    await db.booking.create({
      data: {
        hostId,
        eventTypeId: otherEventId,
        status: "confirmed",
        startUtc: start,
        endUtc: new Date(start.getTime() + 30 * 60_000),
      },
    });

    await expect(confirmHold(held.id, {
      guestName: "Confirmation Conflict",
      guestEmail: "confirmation-conflict@example.test",
    })).rejects.toMatchObject({ status: 409 });
    expect(await db.booking.findUniqueOrThrow({ where: { id: held.id } }))
      .toMatchObject({ status: "held", startUtc: start });
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
    expect(await db.notification.count({
      where: { bookingId: held.id, type: "booking_confirmed" },
    })).toBe(1);
  });

  it("releases capacity after cancellation and preserves a booking when a reschedule conflicts", async () => {
    const first = await hold(singleEventId, slot(14, 9), "cancelled-guest");
    await confirmHold(first.id);
    const firstToken = managementTokenForBooking(first.id);
    await cancelBooking(firstToken, "test cancellation");
    const cancellation = await db.notification.findFirstOrThrow({
      where: { bookingId: first.id, type: "booking_cancelled" },
    });
    expect(cancellation.payload).toMatchObject({
      reason: "test cancellation",
      startUtc: slot(14, 9).toISOString(),
    });
    expect(await db.notification.count({
      where: { bookingId: first.id, type: "booking_cancelled" },
    })).toBe(1);

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
