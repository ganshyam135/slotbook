import { DateTime, IANAZone } from "luxon";

export interface AvailabilityWindow {
  day: string;
  start: string;
  end: string;
}

export interface BookingRow {
  id: string;
  startUtc: Date | string;
  endUtc: Date | string;
  status: string;
  expiresAt?: Date | string | null;
}

export interface HostCalendarBooking extends BookingRow {
  eventTypeId: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

export interface EventTypeLike {
  id: string;
  durationMinutes: number;
  capacity: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
}

interface AvailabilityRule {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

interface AvailabilityOverride {
  localDate: Date | string;
  isUnavailable: boolean;
  startMinute?: number | null;
  endMinute?: number | null;
}

export function parseUtc(value: string | Date) {
  return value instanceof Date
    ? DateTime.fromJSDate(value, { zone: "utc" })
    : DateTime.fromISO(value, { zone: "utc" });
}

export function getHostDateTime(value: string | Date, timezone: string) {
  return value instanceof Date
    ? DateTime.fromJSDate(value, { zone: timezone })
    : DateTime.fromISO(value, { zone: timezone });
}

function localDateKey(value: string | Date) {
  return value instanceof Date
    ? DateTime.fromJSDate(value, { zone: "utc" }).toISODate()
    : DateTime.fromISO(value, { zone: "utc" }).toISODate();
}

function wallTimeCandidates(date: string, minute: number, timezone: string) {
  const dayOffset = Math.floor(minute / 1440);
  const minuteOfDay = minute % 1440;
  const localDay = DateTime.fromISO(date, { zone: timezone }).plus({ days: dayOffset });
  const candidate = DateTime.fromObject(
    {
      year: localDay.year,
      month: localDay.month,
      day: localDay.day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      second: 0,
      millisecond: 0,
    },
    { zone: timezone },
  );

  if (!candidate.isValid) return [];

  const exact =
    candidate.year === localDay.year &&
    candidate.month === localDay.month &&
    candidate.day === localDay.day &&
    candidate.hour === Math.floor(minuteOfDay / 60) &&
    candidate.minute === minuteOfDay % 60;

  if (!exact) return [];
  return candidate.getPossibleOffsets();
}

function resolveWindowBoundary(date: string, minute: number, timezone: string, useLatest: boolean) {
  const candidates = wallTimeCandidates(date, minute, timezone);
  if (candidates.length > 0) {
    return [...candidates].sort((a, b) => a.toMillis() - b.toMillis())[useLatest ? candidates.length - 1 : 0];
  }

  const dayOffset = Math.floor(minute / 1440);
  const minuteOfDay = minute % 1440;
  const localDay = DateTime.fromISO(date, { zone: timezone }).plus({ days: dayOffset });
  return DateTime.fromObject(
    {
      year: localDay.year,
      month: localDay.month,
      day: localDay.day,
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
    },
    { zone: timezone },
  );
}

export function buildSlotRange({
  eventType,
  hostTimezone,
  from,
  to,
  rules,
  overrides,
  bookings,
  now = new Date(),
}: {
  eventType: EventTypeLike;
  hostTimezone: string;
  from: string | Date;
  to: string | Date;
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  bookings: BookingRow[];
  now?: Date;
}) {
  const startInstant = parseUtc(from);
  const endInstant = parseUtc(to);
  if (!IANAZone.isValidZone(hostTimezone)) throw new RangeError("Invalid host time zone.");
  if (!startInstant.isValid || !endInstant.isValid || endInstant <= startInstant) {
    throw new RangeError("Invalid slot range.");
  }

  const nowMillis = now.getTime();
  const noticeBoundary = nowMillis + eventType.minNoticeMinutes * 60_000;
  const horizon = DateTime.fromJSDate(now, { zone: hostTimezone }).plus({ days: eventType.bookingHorizonDays });
  const rangeStart = startInstant.setZone(hostTimezone).startOf("day");
  const rangeEnd = endInstant.setZone(hostTimezone).startOf("day");
  const overridesByDate = new Map(overrides.map((override) => [localDateKey(override.localDate), override]));
  const slots: AvailabilityWindow[] = [];

  for (let cursor = rangeStart; cursor <= rangeEnd; cursor = cursor.plus({ days: 1 })) {
    const date = cursor.toISODate();
    if (!date) continue;

    const dayRules = rules.filter((rule) => rule.dayOfWeek === cursor.weekday % 7);
    const override = overridesByDate.get(date);
    const windows = override
      ? override.isUnavailable
        ? []
        : [
            {
              startMinute: override.startMinute ?? 0,
              endMinute: override.endMinute ?? 1440,
            },
          ]
      : dayRules;

    for (const window of windows) {
      if (
        !Number.isInteger(window.startMinute) ||
        !Number.isInteger(window.endMinute) ||
        window.startMinute < 0 ||
        window.endMinute > 1440 ||
        window.endMinute <= window.startMinute
      ) {
        continue;
      }

      const windowEnd = resolveWindowBoundary(date, window.endMinute, hostTimezone, true);
      if (!windowEnd.isValid) continue;

      for (let minute = window.startMinute; minute < window.endMinute; minute += 15) {
        const starts = wallTimeCandidates(date, minute, hostTimezone);
        if (starts.length !== 1) continue;

        const slotStart = starts[0];
        const slotEnd = slotStart.plus({ minutes: eventType.durationMinutes });
        if (!slotEnd.isValid || slotEnd.toMillis() > windowEnd.toMillis()) continue;

        const startUtc = slotStart.toUTC().toJSDate();
        const endUtc = slotEnd.toUTC().toJSDate();
        if (
          startUtc.getTime() < startInstant.toMillis() ||
          startUtc.getTime() >= endInstant.toMillis() ||
          startUtc.getTime() < noticeBoundary ||
          startUtc.getTime() > horizon.toMillis()
        ) {
          continue;
        }

        if (
          isSlotAvailable({
            eventType,
            slotStartUtc: startUtc,
            slotEndUtc: endUtc,
            bookings,
            now,
          })
        ) {
          slots.push({
            day: date,
            start: startUtc.toISOString(),
            end: endUtc.toISOString(),
          });
        }
      }
    }
  }

  return slots;
}

export function getConflictCount({
  eventType,
  slotStartUtc,
  slotEndUtc,
  bookings,
  now = new Date(),
  excludeBookingId,
}: {
  eventType: EventTypeLike;
  slotStartUtc: Date;
  slotEndUtc: Date;
  bookings: BookingRow[];
  now?: Date;
  excludeBookingId?: string;
}) {
  const candidateStart = slotStartUtc.getTime() - eventType.bufferBeforeMinutes * 60_000;
  const candidateEnd = slotEndUtc.getTime() + eventType.bufferAfterMinutes * 60_000;
  let activeSeats = 0;

  for (const booking of bookings) {
    if (booking.id === excludeBookingId || booking.status === "cancelled" || booking.status === "expired") continue;
    if (booking.status === "held") {
      if (!booking.expiresAt || new Date(booking.expiresAt).getTime() <= now.getTime()) continue;
    } else if (booking.status !== "confirmed") {
      continue;
    }

    const bookingStart = new Date(booking.startUtc).getTime() - eventType.bufferBeforeMinutes * 60_000;
    const bookingEnd = new Date(booking.endUtc).getTime() + eventType.bufferAfterMinutes * 60_000;
    if (bookingStart < candidateEnd && bookingEnd > candidateStart) activeSeats += 1;
  }

  return activeSeats;
}

export function isSlotAvailable({
  eventType,
  slotStartUtc,
  slotEndUtc,
  bookings,
  now,
  excludeBookingId,
}: {
  eventType: EventTypeLike;
  slotStartUtc: Date;
  slotEndUtc: Date;
  bookings: BookingRow[];
  now?: Date;
  excludeBookingId?: string;
}) {
  return (
    getConflictCount({ eventType, slotStartUtc, slotEndUtc, bookings, now, excludeBookingId }) <
    eventType.capacity
  );
}

export function hasHostCalendarConflict({
  eventType,
  slotStartUtc,
  slotEndUtc,
  bookings,
  now = new Date(),
  excludeBookingId,
}: {
  eventType: EventTypeLike;
  slotStartUtc: Date;
  slotEndUtc: Date;
  bookings: HostCalendarBooking[];
  now?: Date;
  excludeBookingId?: string;
}) {
  const candidateStart = slotStartUtc.getTime() - eventType.bufferBeforeMinutes * 60_000;
  const candidateEnd = slotEndUtc.getTime() + eventType.bufferAfterMinutes * 60_000;

  return bookings.some((booking) => {
    if (
      booking.id === excludeBookingId ||
      booking.eventTypeId === eventType.id ||
      booking.status === "cancelled" ||
      booking.status === "expired"
    ) {
      return false;
    }
    if (booking.status === "held") {
      if (!booking.expiresAt || new Date(booking.expiresAt).getTime() <= now.getTime()) return false;
    } else if (booking.status !== "confirmed") {
      return false;
    }

    const bookingStart =
      new Date(booking.startUtc).getTime() - booking.bufferBeforeMinutes * 60_000;
    const bookingEnd =
      new Date(booking.endUtc).getTime() + booking.bufferAfterMinutes * 60_000;
    return bookingStart < candidateEnd && bookingEnd > candidateStart;
  });
}

export function formatGuestTime(value: string, timezone: string) {
  return DateTime.fromISO(value, { zone: "utc" }).setZone(timezone).toLocaleString(DateTime.DATETIME_MED);
}
