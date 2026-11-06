import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import {
  buildSlotRange,
  hasHostCalendarConflict,
  isSlotAvailable,
  type BookingRow,
  type EventTypeLike,
} from "@/lib/booking";
import {
  buildManagementUrl,
  hashManagementToken,
  managementTokenForBooking,
} from "@/lib/auth";

type Transaction = Prisma.TransactionClient;

interface LockedEvent extends EventTypeLike {
  hostId: string;
  durationMinutes: number;
  timezone: string;
}

interface LockedBooking {
  id: string;
  hostId: string;
  eventTypeId: string;
  status: "held" | "confirmed" | "cancelled" | "expired";
  startUtc: Date;
  endUtc: Date;
  expiresAt: Date | null;
  guestName: string | null;
  guestEmail: string | null;
  managementTokenHash: string | null;
  cancellationReason: string | null;
}

interface IdempotencyRecord {
  key: string;
  requestHash: string;
  response: { bookingId: string; status: string; expiresAt: string } | null;
}

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

async function lockEvent(tx: Transaction, eventTypeId: string) {
  const rows = await tx.$queryRaw<LockedEvent[]>`
    SELECT
      e."id",
      e."hostId",
      e."durationMinutes",
      e."capacity",
      e."bufferBeforeMinutes",
      e."bufferAfterMinutes",
      e."minNoticeMinutes",
      e."bookingHorizonDays",
      h."timezone"
    FROM "EventType" e
    JOIN "Host" h ON h."id" = e."hostId"
    WHERE e."id" = ${eventTypeId}
    FOR UPDATE OF e
  `;
  return rows[0] ?? null;
}

async function lockHost(tx: Transaction, hostId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Host"
    WHERE "id" = ${hostId}
    FOR UPDATE
  `;
  return rows.length > 0;
}

async function lockHostEvent(tx: Transaction, hostId: string, eventTypeId: string) {
  if (!(await lockHost(tx, hostId))) return null;
  const event = await lockEvent(tx, eventTypeId);
  return event?.hostId === hostId ? event : null;
}

async function lockBooking(tx: Transaction, bookingId: string) {
  const rows = await tx.$queryRaw<LockedBooking[]>`
    SELECT
      "id", "hostId", "eventTypeId", "status", "startUtc", "endUtc",
      "expiresAt", "guestName", "guestEmail", "managementTokenHash", "cancellationReason"
    FROM "Booking"
    WHERE "id" = ${bookingId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function databaseNow(tx: Transaction) {
  const rows = await tx.$queryRaw<Array<{ now: Date; holdExpiresAt: Date }>>`
    WITH database_clock AS (SELECT clock_timestamp() AS "now")
    SELECT "now", "now" + INTERVAL '5 minutes' AS "holdExpiresAt"
    FROM database_clock
  `;
  return rows[0];
}

async function activeBookings(
  tx: Transaction,
  eventType: EventTypeLike,
  slotStartUtc: Date,
  slotEndUtc: Date,
  now: Date,
  excludeId?: string,
) {
  const bufferWindow = (eventType.bufferBeforeMinutes + eventType.bufferAfterMinutes) * 60_000;
  const rows = await tx.booking.findMany({
    where: {
      eventTypeId: eventType.id,
      id: excludeId ? { not: excludeId } : undefined,
      startUtc: { lt: new Date(slotEndUtc.getTime() + bufferWindow) },
      endUtc: { gt: new Date(slotStartUtc.getTime() - bufferWindow) },
      OR: [
        { status: "confirmed" },
        { status: "held", expiresAt: { gt: now } },
      ],
    },
    select: {
      id: true,
      startUtc: true,
      endUtc: true,
      status: true,
      expiresAt: true,
    },
  });
  return rows satisfies BookingRow[];
}

async function activeHostBookings(
  tx: Transaction,
  hostId: string,
  eventType: EventTypeLike,
  slotStartUtc: Date,
  slotEndUtc: Date,
  now: Date,
) {
  const bufferLimits = await tx.eventType.aggregate({
    where: { hostId },
    _max: { bufferBeforeMinutes: true, bufferAfterMinutes: true },
  });
  const earliestEnd = new Date(
    slotStartUtc.getTime() -
      (eventType.bufferBeforeMinutes + (bufferLimits._max.bufferAfterMinutes ?? 0)) * 60_000,
  );
  const latestStart = new Date(
    slotEndUtc.getTime() +
      (eventType.bufferAfterMinutes + (bufferLimits._max.bufferBeforeMinutes ?? 0)) * 60_000,
  );
  const rows = await tx.booking.findMany({
    where: {
      hostId,
      startUtc: { lt: latestStart },
      endUtc: { gt: earliestEnd },
      OR: [
        { status: "confirmed" },
        { status: "held", expiresAt: { gt: now } },
      ],
    },
    select: {
      id: true,
      eventTypeId: true,
      startUtc: true,
      endUtc: true,
      status: true,
      expiresAt: true,
      eventType: {
        select: {
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
        },
      },
    },
  });
  return rows.map((booking) => ({
    ...booking,
    bufferBeforeMinutes: booking.eventType.bufferBeforeMinutes,
    bufferAfterMinutes: booking.eventType.bufferAfterMinutes,
  }));
}

function eventAsAvailabilityType(event: LockedEvent): EventTypeLike {
  return {
    id: event.id,
    durationMinutes: event.durationMinutes,
    capacity: event.capacity,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    bufferAfterMinutes: event.bufferAfterMinutes,
    minNoticeMinutes: event.minNoticeMinutes,
    bookingHorizonDays: event.bookingHorizonDays,
  };
}

async function isSlotConfigured(
  tx: Transaction,
  event: LockedEvent,
  start: Date,
  end: Date,
  now: Date,
) {
  const [rules, overrides] = await Promise.all([
    tx.availabilityRule.findMany({ where: { eventTypeId: event.id } }),
    tx.availabilityOverride.findMany({ where: { eventTypeId: event.id } }),
  ]);
  const proposed = buildSlotRange({
    eventType: eventAsAvailabilityType(event),
    hostTimezone: event.timezone,
    from: new Date(start.getTime() - 1),
    to: new Date(start.getTime() + 1),
    rules,
    overrides,
    bookings: [],
    now,
  });
  return proposed.some((slot) => slot.start === start.toISOString() && slot.end === end.toISOString());
}

async function readIdempotencyRecord(
  tx: Transaction,
  key: string,
  requestHash: string,
): Promise<IdempotencyRecord> {
  await tx.$executeRaw`
    INSERT INTO "IdempotencyKey" ("id", "key", "requestHash", "response", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${key}, ${requestHash}, NULL, clock_timestamp(), clock_timestamp())
    ON CONFLICT ("key") DO NOTHING
  `;
  const records = await tx.$queryRaw<IdempotencyRecord[]>`
    SELECT "key", "requestHash", "response"
    FROM "IdempotencyKey"
    WHERE "key" = ${key}
    FOR UPDATE
  `;
  const record = records[0];
  if (!record) throw new Error("Could not persist the idempotency record.");
  if (record.requestHash !== requestHash) {
    throw new BookingError("Idempotency key reused for a different request.", 409);
  }
  return record;
}

export async function createHold({
  eventTypeId,
  start,
  guestName,
  guestEmail,
  idempotencyKey,
  requestHash,
}: {
  eventTypeId: string;
  start: Date;
  guestName?: string;
  guestEmail?: string;
  idempotencyKey?: string;
  requestHash: string;
}) {
  const result = await db.$transaction(async (tx) => {
    let idempotency: IdempotencyRecord | undefined;
    if (idempotencyKey) {
      idempotency = await readIdempotencyRecord(tx, idempotencyKey, requestHash);
      if (idempotency.response) return { ...idempotency.response, replay: true };
    }

    const identity = await tx.eventType.findUnique({
      where: { id: eventTypeId },
      select: { hostId: true },
    });
    if (!identity) throw new BookingError("Event not found.", 404);
    const event = await lockHostEvent(tx, identity.hostId, eventTypeId);
    if (!event) throw new BookingError("Event not found.", 404);
    const { now, holdExpiresAt } = await databaseNow(tx);
    const end = new Date(start.getTime() + event.durationMinutes * 60_000);

    if (!(await isSlotConfigured(tx, event, start, end, now))) {
      throw new BookingError("The selected time is outside the event's available schedule.", 409);
    }

    const eventType = eventAsAvailabilityType(event);
    const existing = await activeBookings(tx, eventType, start, end, now);
    if (
      !isSlotAvailable({
        eventType,
        slotStartUtc: start,
        slotEndUtc: end,
        bookings: existing,
        now,
      })
    ) {
      throw new BookingError("This slot is no longer available.", 409);
    }
    const hostBookings = await activeHostBookings(tx, event.hostId, eventType, start, end, now);
    if (
      hasHostCalendarConflict({
        eventType,
        slotStartUtc: start,
        slotEndUtc: end,
        bookings: hostBookings,
        now,
      })
    ) {
      throw new BookingError("This time conflicts with another booking on the host's calendar.", 409);
    }

    const bookingId = randomUUID();
    const managementToken = managementTokenForBooking(bookingId);
    const booking = await tx.booking.create({
      data: {
        id: bookingId,
        hostId: event.hostId,
        eventTypeId: event.id,
        status: "held",
        startUtc: start,
        endUtc: end,
        guestName: guestName ?? null,
        guestEmail: guestEmail ?? null,
        managementTokenHash: hashManagementToken(managementToken),
        expiresAt: holdExpiresAt,
      },
    });
    const expiryRows = await tx.$queryRaw<Array<{ expiresAt: Date }>>`
      UPDATE "Booking"
      SET "expiresAt" = clock_timestamp() + INTERVAL '5 minutes',
          "updatedAt" = clock_timestamp()
      WHERE "id" = ${booking.id}
      RETURNING "expiresAt"
    `;
    const expiresAt = expiryRows[0]?.expiresAt;
    if (!expiresAt) throw new Error("Could not set the hold expiry.");

    await tx.notification.create({
      data: {
        bookingId: booking.id,
        type: "booking_held",
        payload: {
          guestName: guestName ?? null,
          guestEmail: guestEmail ?? null,
          startUtc: start.toISOString(),
          endUtc: end.toISOString(),
        },
      },
    });

    const response = {
      bookingId: booking.id,
      status: "held",
      expiresAt: expiresAt.toISOString(),
    };
    if (idempotencyKey) {
      await tx.idempotencyKey.update({
        where: { key: idempotencyKey },
        data: { response },
      });
    }
    return { ...response, expiresAt: expiresAt.toISOString(), replay: false };
  });

  const token = managementTokenForBooking(result.bookingId);
  return {
    id: result.bookingId,
    status: result.status,
    expiresAt: result.expiresAt,
    managementLink: buildManagementUrl(token),
    message: "Slot held successfully.",
    replay: result.replay,
  };
}

export async function confirmHold(
  bookingId: string,
  guestDetails?: { guestName: string; guestEmail: string },
) {
  const bookingIdentity = await db.booking.findUnique({
    where: { id: bookingId },
    select: { hostId: true, eventTypeId: true },
  });
  if (!bookingIdentity) throw new BookingError("Hold not found.", 404);

  const result = await db.$transaction(async (tx) => {
    const event = await lockHostEvent(tx, bookingIdentity.hostId, bookingIdentity.eventTypeId);
    if (!event) throw new BookingError("Hold not found.", 404);
    const booking = await lockBooking(tx, bookingId);
    if (
      !booking ||
      booking.hostId !== bookingIdentity.hostId ||
      booking.eventTypeId !== bookingIdentity.eventTypeId
    ) {
      throw new BookingError("Hold not found.", 404);
    }
    if (booking.status !== "held") {
      throw new BookingError("Only active holds can be confirmed.", 409);
    }

    const { now } = await databaseNow(tx);
    if (!booking.expiresAt || booking.expiresAt.getTime() <= now.getTime()) {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: "expired" },
      });
      return { expired: true as const };
    }

    const guestName = guestDetails?.guestName ?? booking.guestName;
    const guestEmail = guestDetails?.guestEmail ?? booking.guestEmail;
    if (!guestName || !guestEmail) {
      throw new BookingError("Guest name and email are required before confirmation.", 400);
    }

    const eventType = eventAsAvailabilityType(event);
    const hostBookings = await activeHostBookings(
      tx,
      event.hostId,
      eventType,
      booking.startUtc,
      booking.endUtc,
      now,
    );
    if (
      hasHostCalendarConflict({
        eventType,
        slotStartUtc: booking.startUtc,
        slotEndUtc: booking.endUtc,
        bookings: hostBookings,
        now,
        excludeBookingId: booking.id,
      })
    ) {
      throw new BookingError("This hold conflicts with another booking on the host's calendar.", 409);
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: "confirmed", expiresAt: null, guestName, guestEmail },
    });
    await tx.notification.create({
      data: {
        bookingId: updated.id,
        type: "booking_confirmed",
        payload: {
          guestName: updated.guestName,
          guestEmail: updated.guestEmail,
          startUtc: updated.startUtc.toISOString(),
          endUtc: updated.endUtc.toISOString(),
        },
      },
    });

    const token = managementTokenForBooking(updated.id);
    return {
      expired: false as const,
      id: updated.id,
      status: "confirmed",
      managementLink: buildManagementUrl(token),
    };
  });

  if (result.expired) throw new BookingError("This hold expired before confirmation.", 409);
  return result;
}

export async function rescheduleBooking(token: string, newStart: Date) {
  const tokenHash = hashManagementToken(token);
  const bookingIdentity = await db.booking.findUnique({
    where: { managementTokenHash: tokenHash },
    select: { id: true, hostId: true, eventTypeId: true },
  });
  if (!bookingIdentity) throw new BookingError("Booking not found or token invalid.", 404);

  return db.$transaction(async (tx) => {
    const event = await lockHostEvent(tx, bookingIdentity.hostId, bookingIdentity.eventTypeId);
    if (!event) throw new BookingError("Event not found.", 404);
    const booking = await lockBooking(tx, bookingIdentity.id);
    if (
      !booking ||
      booking.hostId !== bookingIdentity.hostId ||
      booking.eventTypeId !== bookingIdentity.eventTypeId ||
      booking.status !== "confirmed"
    ) {
      throw new BookingError("Only confirmed bookings can be rescheduled.", 409);
    }

    const { now } = await databaseNow(tx);
    const newEnd = new Date(newStart.getTime() + event.durationMinutes * 60_000);
    if (!(await isSlotConfigured(tx, event, newStart, newEnd, now))) {
      throw new BookingError("The selected time is outside the event's available schedule.", 409);
    }

    const eventType = eventAsAvailabilityType(event);
    const existing = await activeBookings(tx, eventType, newStart, newEnd, now, booking.id);
    if (
      !isSlotAvailable({
        eventType,
        slotStartUtc: newStart,
        slotEndUtc: newEnd,
        bookings: existing,
        now,
      })
    ) {
      throw new BookingError("The selected slot is unavailable for rescheduling.", 409);
    }
    const hostBookings = await activeHostBookings(tx, event.hostId, eventType, newStart, newEnd, now);
    if (
      hasHostCalendarConflict({
        eventType,
        slotStartUtc: newStart,
        slotEndUtc: newEnd,
        bookings: hostBookings,
        now,
        excludeBookingId: booking.id,
      })
    ) {
      throw new BookingError("The selected time conflicts with another booking on the host's calendar.", 409);
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { startUtc: newStart, endUtc: newEnd },
    });
    await tx.notification.create({
      data: {
        bookingId: updated.id,
        type: "booking_rescheduled",
        payload: {
          previousStartUtc: booking.startUtc.toISOString(),
          previousEndUtc: booking.endUtc.toISOString(),
          newStartUtc: newStart.toISOString(),
          newEndUtc: newEnd.toISOString(),
        },
      },
    });
    return { id: updated.id, status: updated.status, message: "Booking rescheduled successfully." };
  });
}

export async function cancelBooking(token: string, reason: string) {
  const bookingIdentity = await db.booking.findUnique({
    where: { managementTokenHash: hashManagementToken(token) },
    select: { id: true, hostId: true, eventTypeId: true },
  });
  if (!bookingIdentity) throw new BookingError("Booking not found or token invalid.", 404);

  return db.$transaction(async (tx) => {
    const event = await lockHostEvent(tx, bookingIdentity.hostId, bookingIdentity.eventTypeId);
    if (!event) throw new BookingError("Booking not found.", 404);
    const booking = await lockBooking(tx, bookingIdentity.id);
    if (
      !booking ||
      booking.hostId !== bookingIdentity.hostId ||
      booking.eventTypeId !== bookingIdentity.eventTypeId ||
      booking.status !== "confirmed"
    ) {
      throw new BookingError("Only confirmed bookings can be cancelled.", 409);
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled", cancellationReason: reason },
    });
    await tx.notification.create({
      data: {
        bookingId: updated.id,
        type: "booking_cancelled",
        payload: {
          reason: updated.cancellationReason,
          startUtc: updated.startUtc.toISOString(),
          endUtc: updated.endUtc.toISOString(),
        },
      },
    });
    return { id: updated.id, status: updated.status, message: "Booking cancelled successfully." };
  });
}

export async function cancelBookingForHost(bookingId: string, hostId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const identity = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { hostId: true, eventTypeId: true },
    });
    if (!identity || identity.hostId !== hostId) {
      throw new BookingError("Booking not found.", 404);
    }
    const event = await lockHostEvent(tx, hostId, identity.eventTypeId);
    if (!event) throw new BookingError("Booking not found.", 404);
    const booking = await lockBooking(tx, bookingId);
    if (
      !booking ||
      booking.hostId !== hostId ||
      booking.eventTypeId !== identity.eventTypeId
    ) {
      throw new BookingError("Booking not found.", 404);
    }
    if (booking.status !== "held" && booking.status !== "confirmed") {
      throw new BookingError("Only active bookings can be cancelled.", 409);
    }

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: { status: "cancelled", expiresAt: null, cancellationReason: reason },
    });
    await tx.notification.create({
      data: {
        bookingId: updated.id,
        type: "booking_cancelled",
        payload: {
          reason: updated.cancellationReason,
          startUtc: updated.startUtc.toISOString(),
          endUtc: updated.endUtc.toISOString(),
          cancelledBy: "host",
        },
      },
    });
    return { id: updated.id, status: updated.status, message: "Booking cancelled successfully." };
  });
}

export async function getBookingByToken(token: string) {
  return db.booking.findUnique({
    where: { managementTokenHash: hashManagementToken(token) },
    include: { eventType: { include: { host: { select: { slug: true, timezone: true } } } } },
  });
}

export function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
