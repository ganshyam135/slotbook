import { describe, expect, it } from "vitest";
import {
  eventTypeInputSchema,
  hostProfileInputSchema,
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
