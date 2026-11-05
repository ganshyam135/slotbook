import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  buildSlotRange,
  hasHostCalendarConflict,
  isSlotAvailable,
} from "../../src/lib/booking";

const eventType = {
  id: "evt_1",
  durationMinutes: 60,
  capacity: 1,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  bookingHorizonDays: 45,
};

describe("booking availability", () => {
  it("generates local weekday availability as UTC instants", () => {
    const slots = buildSlotRange({
      eventType,
      hostTimezone: "America/New_York",
      from: "2026-03-09T00:00:00.000Z",
      to: "2026-03-10T00:00:00.000Z",
      rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 660 }],
      overrides: [],
      bookings: [],
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    expect(slots[0]).toMatchObject({
      day: "2026-03-09",
      start: "2026-03-09T13:00:00.000Z",
      end: "2026-03-09T14:00:00.000Z",
    });
  });

  it("gives a date override precedence over weekly hours", () => {
    const slots = buildSlotRange({
      eventType: { ...eventType, durationMinutes: 30 },
      hostTimezone: "UTC",
      from: "2026-03-09T00:00:00.000Z",
      to: "2026-03-10T00:00:00.000Z",
      rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      overrides: [
        {
          localDate: "2026-03-09",
          isUnavailable: false,
          startMinute: 600,
          endMinute: 660,
        },
      ],
      bookings: [],
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(slots).toHaveLength(3);
    expect(slots[0].start).toBe("2026-03-09T10:00:00.000Z");
  });

  it("makes an unavailable date override suppress weekly availability", () => {
    const slots = buildSlotRange({
      eventType: { ...eventType, durationMinutes: 30 },
      hostTimezone: "UTC",
      from: "2026-03-09T00:00:00.000Z",
      to: "2026-03-10T00:00:00.000Z",
      rules: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      overrides: [{ localDate: "2026-03-09", isUnavailable: true }],
      bookings: [],
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(slots).toHaveLength(0);
  });

  it("skips nonexistent and ambiguous local wall times at daylight-saving transitions", () => {
    const springSlots = buildSlotRange({
      eventType: { ...eventType, durationMinutes: 15 },
      hostTimezone: "America/New_York",
      from: "2026-03-08T00:00:00.000Z",
      to: "2026-03-09T00:00:00.000Z",
      rules: [{ dayOfWeek: 0, startMinute: 60, endMinute: 240 }],
      overrides: [],
      bookings: [],
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const fallSlots = buildSlotRange({
      eventType: { ...eventType, durationMinutes: 15 },
      hostTimezone: "America/New_York",
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-02T00:00:00.000Z",
      rules: [{ dayOfWeek: 0, startMinute: 60, endMinute: 180 }],
      overrides: [],
      bookings: [],
      now: new Date("2026-10-25T00:00:00.000Z"),
    });

    expect(springSlots.some((slot) => slot.start === "2026-03-08T06:00:00.000Z")).toBe(true);
    expect(springSlots.every((slot) => DateTime.fromISO(slot.start).setZone("America/New_York").hour !== 2)).toBe(true);
    expect(fallSlots.some((slot) => slot.start === "2026-11-01T07:00:00.000Z")).toBe(true);
    expect(fallSlots.some((slot) => slot.start === "2026-11-01T05:00:00.000Z")).toBe(false);
    expect(fallSlots.some((slot) => slot.start === "2026-11-01T06:00:00.000Z")).toBe(false);
  });

  it("applies minimum notice and the host-local booking horizon", () => {
    const slots = buildSlotRange({
      eventType: {
        ...eventType,
        durationMinutes: 30,
        minNoticeMinutes: 120,
        bookingHorizonDays: 1,
      },
      hostTimezone: "UTC",
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-04T00:00:00.000Z",
      rules: [{ dayOfWeek: 0, startMinute: 540, endMinute: 660 }, { dayOfWeek: 1, startMinute: 540, endMinute: 660 }, { dayOfWeek: 2, startMinute: 540, endMinute: 660 }],
      overrides: [],
      bookings: [],
      now: new Date("2026-03-01T08:00:00.000Z"),
    });

    expect(slots[0].start).toBe("2026-03-01T10:00:00.000Z");
    expect(slots.every((slot) => new Date(slot.start) <= new Date("2026-03-02T08:00:00.000Z"))).toBe(true);
  });

  it("counts active holds and confirmed bookings but ignores expired and cancelled records", () => {
    const slotStart = new Date("2026-03-09T10:00:00.000Z");
    const slotEnd = new Date("2026-03-09T11:00:00.000Z");
    const now = new Date("2026-03-01T00:00:00.000Z");
    const createAvailability = (status: string, expiresAt?: Date | null) =>
      isSlotAvailable({
        eventType,
        slotStartUtc: slotStart,
        slotEndUtc: slotEnd,
        now,
        bookings: [{ id: "b1", startUtc: slotStart, endUtc: slotEnd, status, expiresAt }],
      });

    expect(createAvailability("held", new Date("2026-03-01T00:05:00.000Z"))).toBe(false);
    expect(createAvailability("held", new Date("2026-02-28T23:59:59.000Z"))).toBe(true);
    expect(createAvailability("cancelled")).toBe(true);
    expect(createAvailability("expired")).toBe(true);
    expect(createAvailability("confirmed")).toBe(false);
  });

  it("reserves the configured buffers around overlapping slots", () => {
    const available = isSlotAvailable({
      eventType: {
        ...eventType,
        bufferAfterMinutes: 15,
      },
      slotStartUtc: new Date("2026-03-09T10:00:00.000Z"),
      slotEndUtc: new Date("2026-03-09T11:00:00.000Z"),
      now: new Date("2026-03-01T00:00:00.000Z"),
      bookings: [
        {
          id: "existing",
          startUtc: new Date("2026-03-09T11:14:00.000Z"),
          endUtc: new Date("2026-03-09T12:14:00.000Z"),
          status: "confirmed",
        },
      ],
    });
    expect(available).toBe(false);
  });

  it("supports limited group capacity and excluding the booking being moved", () => {
    const bookings = [0, 1].map((index) => ({
      id: `booking-${index}`,
      startUtc: new Date("2026-03-09T10:00:00.000Z"),
      endUtc: new Date("2026-03-09T11:00:00.000Z"),
      status: "confirmed",
    }));
    const groupEvent = { ...eventType, capacity: 2 };
    const args = {
      eventType: groupEvent,
      slotStartUtc: new Date("2026-03-09T10:00:00.000Z"),
      slotEndUtc: new Date("2026-03-09T11:00:00.000Z"),
      bookings,
    };

    expect(isSlotAvailable(args)).toBe(false);
    expect(isSlotAvailable({ ...args, excludeBookingId: "booking-0" })).toBe(true);
  });

  it("blocks cross-event overlaps using both event types' buffers", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const candidateEventType = { ...eventType, id: "candidate", bufferBeforeMinutes: 5, bufferAfterMinutes: 5 };
    const start = new Date("2026-03-09T10:00:00.000Z");
    const blocked = hasHostCalendarConflict({
      eventType: candidateEventType,
      slotStartUtc: start,
      slotEndUtc: new Date("2026-03-09T11:00:00.000Z"),
      now,
      bookings: [{
        id: "other-event-booking",
        eventTypeId: "other-event",
        startUtc: new Date("2026-03-09T11:09:00.000Z"),
        endUtc: new Date("2026-03-09T12:09:00.000Z"),
        status: "confirmed",
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 0,
      }],
    });

    expect(blocked).toBe(true);

    expect(hasHostCalendarConflict({
      eventType: candidateEventType,
      slotStartUtc: start,
      slotEndUtc: new Date("2026-03-09T11:00:00.000Z"),
      now,
      bookings: [{
        id: "other-event-after-buffer",
        eventTypeId: "other-event",
        startUtc: new Date("2026-03-09T08:55:00.000Z"),
        endUtc: new Date("2026-03-09T09:55:00.000Z"),
        status: "confirmed",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 10,
      }],
    })).toBe(true);
  });

  it("counts an unexpired hold from another event type as a host conflict", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const start = new Date("2026-03-09T10:00:00.000Z");

    expect(hasHostCalendarConflict({
      eventType,
      slotStartUtc: start,
      slotEndUtc: new Date("2026-03-09T11:00:00.000Z"),
      now,
      bookings: [{
        id: "active-cross-event-hold",
        eventTypeId: "other-event",
        startUtc: start,
        endUtc: new Date("2026-03-09T11:00:00.000Z"),
        status: "held",
        expiresAt: new Date("2026-03-01T00:05:00.000Z"),
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      }],
    })).toBe(true);
  });

  it("ignores same-event group bookings and expired or cancelled cross-event bookings", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const start = new Date("2026-03-09T10:00:00.000Z");
    const candidateEventType = { ...eventType, capacity: 3 };
    const bookings = [
      {
        id: "same-event-group-seat",
        eventTypeId: candidateEventType.id,
        startUtc: start,
        endUtc: new Date("2026-03-09T11:00:00.000Z"),
        status: "confirmed",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      },
      {
        id: "expired-other-event",
        eventTypeId: "other-event",
        startUtc: start,
        endUtc: new Date("2026-03-09T11:00:00.000Z"),
        status: "held",
        expiresAt: new Date("2026-02-28T23:59:59.000Z"),
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      },
      {
        id: "cancelled-other-event",
        eventTypeId: "other-event",
        startUtc: start,
        endUtc: new Date("2026-03-09T11:00:00.000Z"),
        status: "cancelled",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      },
    ];

    expect(hasHostCalendarConflict({
      eventType: candidateEventType,
      slotStartUtc: start,
      slotEndUtc: new Date("2026-03-09T11:00:00.000Z"),
      bookings,
      now,
    })).toBe(false);
  });
});
