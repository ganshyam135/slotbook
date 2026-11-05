import { describe, expect, it } from "vitest";
import {
  availabilityOverrideInputSchema,
  eventTypeInputSchema,
  hostProfileInputSchema,
  weeklyAvailabilityInputSchema,
} from "../../src/lib/host-management";

const validEventType = {
  name: "Strategy session",
  slug: "strategy-session",
  durationMinutes: 45,
  capacity: 4,
  bufferBeforeMinutes: 10,
  bufferAfterMinutes: 5,
  minNoticeMinutes: 60,
  bookingHorizonDays: 45,
};

describe("event type validation", () => {
  it("accepts valid settings", () => {
    expect(eventTypeInputSchema.safeParse(validEventType).success).toBe(true);
  });

  describe("host profile validation", () => {
    it("accepts a valid name and IANA time zone", () => {
      expect(
        hostProfileInputSchema.safeParse({ name: "Alex Morgan", timezone: "Asia/Kolkata" }).success,
      ).toBe(true);
    });

    describe("availability validation", () => {
      it("accepts multiple non-overlapping windows for one weekday", () => {
        expect(weeklyAvailabilityInputSchema.safeParse({
          windows: [
            { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
            { dayOfWeek: 1, startMinute: 780, endMinute: 1020 },
          ],
        }).success).toBe(true);
      });

      it("rejects overlapping windows, invalid weekdays, and non-quarter-hour boundaries", () => {
        for (const windows of [
          [
            { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
            { dayOfWeek: 1, startMinute: 705, endMinute: 900 },
          ],
          [{ dayOfWeek: 7, startMinute: 540, endMinute: 720 }],
          [{ dayOfWeek: 1, startMinute: 541, endMinute: 720 }],
        ]) {
          expect(weeklyAvailabilityInputSchema.safeParse({ windows }).success).toBe(false);
        }
      });

      it("accepts unavailable and custom-hour date overrides", () => {
        expect(availabilityOverrideInputSchema.safeParse({
          localDate: "2027-01-02",
          isUnavailable: true,
        }).success).toBe(true);
        expect(availabilityOverrideInputSchema.safeParse({
          localDate: "2027-01-02",
          isUnavailable: false,
          startMinute: 600,
          endMinute: 900,
        }).success).toBe(true);
      });

      it("rejects invalid override dates, missing hours, and hours on unavailable dates", () => {
        for (const override of [
          { localDate: "2027-02-30", isUnavailable: true },
          { localDate: "2027-01-02", isUnavailable: false, startMinute: 600 },
          { localDate: "2027-01-02", isUnavailable: true, startMinute: 600, endMinute: 900 },
        ]) {
          expect(availabilityOverrideInputSchema.safeParse(override).success).toBe(false);
        }
      });
    });

    it.each([
      { name: "A", timezone: "Asia/Kolkata" },
      { name: "Alex Morgan", timezone: "Not/A-Timezone" },
      { name: "Alex Morgan", timezone: "" },
    ])("rejects invalid profile data: %o", (profile) => {
      expect(hostProfileInputSchema.safeParse(profile).success).toBe(false);
    });
  });

  it.each([
    { durationMinutes: 20 },
    { capacity: 0 },
    { bufferBeforeMinutes: 31 },
    { minNoticeMinutes: -1 },
    { bookingHorizonDays: 366 },
    { slug: "Upper Case" },
  ])("rejects invalid settings: %o", (override) => {
    expect(eventTypeInputSchema.safeParse({ ...validEventType, ...override }).success).toBe(false);
  });
});
