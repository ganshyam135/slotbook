import { DateTime, IANAZone } from "luxon";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSlotRange, getConflictCount, hasHostCalendarConflict } from "@/lib/booking";
import { getBookingByToken } from "@/lib/booking-service";
import db from "@/lib/db";

const querySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  tz: z.string().refine(IANAZone.isValidZone, "Invalid IANA timezone."),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ host: string; slug: string }> },
) {
  const { host, slug } = await params;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? new Date().toISOString(),
    to: url.searchParams.get("to") ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    tz: url.searchParams.get("tz") ?? "UTC",
  });
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid slots query.", issues: parsed.error.issues }, { status: 400 });
  }

  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (to <= from || to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ message: "The requested range must be positive and no longer than 31 days." }, { status: 400 });
  }

  let managementBooking: Awaited<ReturnType<typeof getBookingByToken>> = null;
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const token = /^Bearer ([a-f0-9]{64})$/i.exec(authorization)?.[1];
    managementBooking = token ? await getBookingByToken(token) : null;
    if (!managementBooking || managementBooking.status !== "confirmed") {
      return NextResponse.json({ message: "Booking not found or token invalid." }, { status: 404 });
    }
  }

  const clock = await db.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  const now = clock[0].now;
  const hostRecord = await db.host.findUnique({
    where: { slug: host },
    include: {
      eventTypes: {
        where: { slug },
        include: {
          availabilityRules: true,
          availabilityOverrides: true,
        },
      },
    },
  });

  if (!hostRecord) return NextResponse.json({ message: "Host not found." }, { status: 404 });
  const event = hostRecord.eventTypes[0];
  if (!event) return NextResponse.json({ message: "Event type not found." }, { status: 404 });
  if (
    managementBooking &&
    (managementBooking.eventTypeId !== event.id || managementBooking.eventType.host.slug !== host)
  ) {
    return NextResponse.json({ message: "Booking not found or token invalid." }, { status: 404 });
  }
  const excludedBookingId = managementBooking?.id;

  const bufferLimits = await db.eventType.aggregate({
    where: { hostId: hostRecord.id },
    _max: { bufferBeforeMinutes: true, bufferAfterMinutes: true },
  });
  const earliestEnd = new Date(
    from.getTime() -
      (event.bufferBeforeMinutes + (bufferLimits._max.bufferAfterMinutes ?? 0)) * 60_000,
  );
  const latestStart = new Date(
    to.getTime() +
      (event.durationMinutes +
        event.bufferAfterMinutes +
        (bufferLimits._max.bufferBeforeMinutes ?? 0)) *
        60_000,
  );
  const hostBookings = await db.booking.findMany({
    where: {
      hostId: hostRecord.id,
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
  const hostCalendarBookings = hostBookings.map((booking) => ({
    ...booking,
    bufferBeforeMinutes: booking.eventType.bufferBeforeMinutes,
    bufferAfterMinutes: booking.eventType.bufferAfterMinutes,
  }));
  const eventBookings = hostCalendarBookings.filter((booking) => booking.eventTypeId === event.id);
  const availability = buildSlotRange({
    eventType: event,
    hostTimezone: hostRecord.timezone,
    from,
    to,
    rules: event.availabilityRules,
    overrides: event.availabilityOverrides,
    bookings: [],
    now,
  }).map((slot) => {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);
    const remainingCapacity = Math.max(0, event.capacity - getConflictCount({
      eventType: event,
      slotStartUtc: slotStart,
      slotEndUtc: slotEnd,
      bookings: eventBookings,
      now,
      excludeBookingId: excludedBookingId,
    }));
    const hostConflict = hasHostCalendarConflict({
      eventType: event,
      slotStartUtc: slotStart,
      slotEndUtc: slotEnd,
      bookings: hostCalendarBookings,
      now,
      excludeBookingId: excludedBookingId,
    });
    const guestStart = DateTime.fromISO(slot.start, { zone: "utc" }).setZone(parsed.data.tz);
    return {
      ...slot,
      guestDay: guestStart.toFormat("yyyy-MM-dd"),
      guestTime: guestStart.toLocaleString(DateTime.TIME_SIMPLE),
      available: remainingCapacity > 0 && !hostConflict,
      remainingCapacity,
    };
  });

  const slots = availability
    .filter((slot) => slot.available)
    .map((slot) => ({
      start: slot.start,
      end: slot.end,
      guestDay: slot.guestDay,
      guestTime: slot.guestTime,
      remainingCapacity: slot.remainingCapacity,
    }));
  return NextResponse.json({ slots, availability }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
