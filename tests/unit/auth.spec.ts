import { beforeAll, describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashManagementToken,
  managementTokenForBooking,
  verifySessionToken,
} from "../../src/lib/auth";

beforeAll(() => {
  process.env.AUTH_SECRET = "unit-test-secret-that-is-long-enough-123456";
});

describe("authentication tokens", () => {
  it("accepts a signed, unexpired host session and rejects tampering or expiry", () => {
    const now = Date.parse("2026-11-05T00:00:00.000Z");
    const token = createSessionToken("host_123", now);
    expect(verifySessionToken(token, now)).toBe("host_123");
    expect(verifySessionToken(`${token}x`, now)).toBeNull();
    expect(verifySessionToken(token, now + 9 * 60 * 60 * 1000)).toBeNull();
  });

  it("derives stable private booking tokens while storing only their hash", () => {
    const first = managementTokenForBooking("booking_123");
    const retry = managementTokenForBooking("booking_123");
    expect(first).toHaveLength(64);
    expect(first).toBe(retry);
    expect(hashManagementToken(first)).not.toBe(first);
  });
});
