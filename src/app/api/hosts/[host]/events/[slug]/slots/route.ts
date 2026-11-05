import { DateTime, IANAZone } from "luxon";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSlotRange, hasHostCalendarConflict } from "@/lib/booking";
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
  const slots = buildSlotRange({
    eventType: event,
    hostTimezone: hostRecord.timezone,
    from,
    to,
    rules: event.availabilityRules,
    overrides: event.availabilityOverrides,
    bookings: eventBookings,
    now,
  }).filter((slot) => !hasHostCalendarConflict({
    eventType: event,
    slotStartUtc: new Date(slot.start),
    slotEndUtc: new Date(slot.end),
    bookings: hostCalendarBookings,
    now,
  })).map((slot) => {
    const guestStart = DateTime.fromISO(slot.start, { zone: "utc" }).setZone(parsed.data.tz);
    return {
      ...slot,
      guestDay: guestStart.toFormat("yyyy-MM-dd"),
      guestTime: guestStart.toLocaleString(DateTime.TIME_SIMPLE),
    };
  });

  return NextResponse.json({ slots });
}
