import { describe, expect, it } from "vitest";
import {
  confirmHoldRequestSchema,
  createHoldRequestSchema,
} from "../../src/lib/booking-validation";

const holdRequest = {
  eventTypeId: "event-1",
  start: "2027-01-03T10:00:00.000Z",
  timezone: "Asia/Kolkata",
};

describe("booking request validation", () => {
  it("allows reserving a slot before guest contact details are entered", () => {
    expect(createHoldRequestSchema.safeParse(holdRequest).success).toBe(true);
  });

  it("continues accepting requests that provide both guest details with the hold", () => {
    expect(createHoldRequestSchema.safeParse({
      ...holdRequest,
      guestName: "Alex Morgan",
      guestEmail: "alex@example.test",
    }).success).toBe(true);
  });

  it("rejects partial guest contact data on hold requests", () => {
    expect(createHoldRequestSchema.safeParse({
      ...holdRequest,
      guestName: "Alex Morgan",
    }).success).toBe(false);
  });

  it("requires a complete name/email pair when details are submitted at confirmation", () => {
    expect(confirmHoldRequestSchema.safeParse({}).success).toBe(true);
    expect(confirmHoldRequestSchema.safeParse({
      guestName: "Alex Morgan",
      guestEmail: "alex@example.test",
    }).success).toBe(true);
    expect(confirmHoldRequestSchema.safeParse({ guestEmail: "alex@example.test" }).success).toBe(false);
  });
});
