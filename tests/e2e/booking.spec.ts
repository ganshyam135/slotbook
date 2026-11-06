import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import { DateTime } from "luxon";
import { readE2EFixture } from "./fixture";
import { e2eDb } from "./test-db";

async function availableSlots(
  request: APIRequestContext,
  hostSlug: string,
  eventSlug: string,
  from: Date,
  to: Date,
) {
  const query = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    tz: "UTC",
  });
  const response = await request.get(`/api/hosts/${hostSlug}/events/${eventSlug}/slots?${query}`);
  expect(response.ok()).toBeTruthy();
  const slots = (await response.json() as {
    slots: Array<{ start: string; guestDay: string; guestTime: string; remainingCapacity: number }>;
  }).slots;
  for (const slot of slots) {
    expect(slot.remainingCapacity).toBeGreaterThan(0);
    const keys = Object.keys(slot);
    for (const sensitiveKey of ["guestName", "guestEmail", "bookingId", "id"]) {
      expect(keys).not.toContain(sensitiveKey);
    }
  }
  return slots;
}

async function openSlot(page: Page, slot: { guestDay: string; guestTime: string }) {
  await expect(page.getByText("Loading...")).toBeHidden();
  const dateLabel = DateTime.fromISO(slot.guestDay, { zone: "UTC" })
    .setLocale("en-US")
    .toLocaleString({ month: "short", day: "numeric" });
  await page.getByRole("button", { name: new RegExp(`^${dateLabel},`) }).click();
  const normalizedTime = slot.guestTime
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const timeButton = page.getByRole("button", {
    name: new RegExp(`^${normalizedTime},`, "i"),
  }).first();
  await expect(timeButton).toBeEnabled();
  await timeButton.click();
}

test("guest holds, confirms, manages, reschedules, cancels, and releases capacity", async ({ page, request }) => {
  test.setTimeout(60_000);
  const fixture = readE2EFixture();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const from = DateTime.utc().plus({ days: 2 }).startOf("day").toJSDate();
  const to = DateTime.fromJSDate(from).plus({ days: 28 }).toJSDate();
  const slots = await availableSlots(request, fixture.hostSlug, fixture.guestEventSlug, from, to);
  expect(slots.length).toBeGreaterThan(10);
  const originalSlot = slots[0];
  const originalStart = new Date(originalSlot.start);
  const targetSlot = slots.find(
    (slot) => new Date(slot.start).getTime() >= originalStart.getTime() + 2 * 60 * 60 * 1000,
  );
  expect(targetSlot).toBeDefined();
  if (!targetSlot) throw new Error("No non-overlapping reschedule target was available.");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${fixture.hostSlug}/${fixture.guestEventSlug}`);
  await expect(page.getByRole("heading", { name: "E2E Guest Booking", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Guest time zone")).toHaveValue("UTC");
  await expect(page.getByLabel("Availability legend")).toContainText("Limited capacity");
  await openSlot(page, originalSlot);
  await page.getByRole("button", { name: "Hold this time for 5 minutes" }).click();
  await expect(page.getByRole("status")).toContainText(/Held for you/);
  await expect(page.getByLabel("Time remaining to confirm")).toHaveText(/\d:\d{2}/);

  const email = page.getByLabel("Email address");
  await email.fill("not-an-email");
  expect(await email.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  const holdFromBookingUi = await e2eDb.booking.findFirstOrThrow({
    where: {
      hostId: fixture.hostId,
      eventTypeId: fixture.guestEventId,
      status: "held",
      startUtc: new Date(originalSlot.start),
    },
    orderBy: { createdAt: "desc" },
  });
  const invalidConfirmation = await request.post(`/api/holds/${holdFromBookingUi.id}/confirm`, {
    data: { guestName: "A", guestEmail: "not-an-email" },
  });
  expect(invalidConfirmation.status()).toBe(400);

  await page.getByLabel("Full name").fill("E2E Guest");
  await email.fill("guest@example.test");
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
  const managementLink = page.getByRole("link", { name: "Manage your booking" });
  await expect(managementLink).toHaveAttribute("href", /\/bookings\/[a-f0-9]{64}$/);

  const duplicateConfirmation = await request.post(`/api/holds/${holdFromBookingUi.id}/confirm`, {
    data: { guestName: "E2E Guest", guestEmail: "guest@example.test" },
  });
  expect(duplicateConfirmation.status()).toBe(409);

  await managementLink.click();
  await expect(page.getByText("Manage booking", { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Status: confirmed")).toBeVisible();
  const managementToken = new URL(page.url()).pathname.split("/").at(-1);
  if (!managementToken) throw new Error("Management token was missing from the private link.");
  const availabilityQuery = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    tz: "UTC",
  });
  const publicRescheduleAvailability = await request.get(
    `/api/hosts/${fixture.hostSlug}/events/${fixture.guestEventSlug}/slots?${availabilityQuery}`,
  );
  const publicSlots = (await publicRescheduleAvailability.json() as {
    slots: Array<{ start: string }>;
  }).slots;
  expect(publicSlots.some((slot) => slot.start === originalSlot.start)).toBe(false);
  const ownRescheduleAvailability = await request.get(
    `/api/hosts/${fixture.hostSlug}/events/${fixture.guestEventSlug}/slots?${availabilityQuery}`,
    { headers: { Authorization: `Bearer ${managementToken}` } },
  );
  expect(ownRescheduleAvailability.ok()).toBeTruthy();
  const ownSlots = (await ownRescheduleAvailability.json() as {
    slots: Array<{ start: string }>;
  }).slots;
  expect(ownSlots.some((slot) => slot.start === originalSlot.start)).toBe(true);
  const invalidManagementAvailability = await request.get(
    `/api/hosts/${fixture.hostSlug}/events/${fixture.guestEventSlug}/slots?${availabilityQuery}`,
    { headers: { Authorization: `Bearer ${"0".repeat(64)}` } },
  );
  expect(invalidManagementAvailability.status()).toBe(404);

  const targetDateLabel = DateTime.fromISO(`${targetSlot.guestDay}T12:00`, { zone: "UTC" })
    .setLocale("en-US")
    .toLocaleString({ month: "short", day: "numeric" });
  await page.getByRole("button", { name: new RegExp(`^${targetDateLabel},`) }).click();
  const targetTimeButton = page.getByRole("button", {
    name: `${targetSlot.guestTime}, available`,
  });
  await targetTimeButton.click();
  await expect(targetTimeButton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Proposed appointment")).toBeVisible();
  await page.getByRole("button", { name: "Reschedule appointment" }).click();
  await expect(page.getByRole("status")).toContainText("Booking rescheduled successfully.");

  const rescheduled = await e2eDb.booking.findUniqueOrThrow({ where: { id: holdFromBookingUi.id } });
  expect(rescheduled.startUtc.toISOString()).toBe(targetSlot.start);
  await page.getByLabel("Cancellation reason").fill("E2E capacity release");
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByRole("status")).toContainText("Booking cancelled successfully.");
  await expect(page.getByText("This booking is cancelled")).toBeVisible();

  const afterCancellation = await availableSlots(request, fixture.hostSlug, fixture.guestEventSlug, from, to);
  const availableStarts = new Set(afterCancellation.map((slot) => slot.start));
  expect(availableStarts.has(originalSlot.start)).toBe(true);
  expect(availableStarts.has(targetSlot.start)).toBe(true);

  const unavailableStart = DateTime.fromJSDate(from, { zone: "utc" }).set({ hour: 4, minute: 0, second: 0, millisecond: 0 });
  const unavailable = await request.post("/api/holds", {
    data: {
      eventTypeId: fixture.guestEventId,
      start: unavailableStart.toISO(),
      timezone: "UTC",
    },
  });
  expect(unavailable.status()).toBe(409);
  const invalidGuestDetails = await request.post("/api/holds", {
    data: {
      eventTypeId: fixture.guestEventId,
      start: originalSlot.start,
      timezone: "UTC",
      guestName: "A",
      guestEmail: "not-an-email",
    },
  });
  expect(invalidGuestDetails.status()).toBe(400);

  const held = await request.post("/api/holds", {
    data: {
      eventTypeId: fixture.guestEventId,
      start: originalSlot.start,
      timezone: "UTC",
    },
  });
  expect(held.status()).toBe(201);
  const heldBooking = await held.json() as { id: string };
  await e2eDb.booking.update({
    where: { id: heldBooking.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  const expiredConfirmation = await request.post(`/api/holds/${heldBooking.id}/confirm`, {
    data: { guestName: "Late Guest", guestEmail: "late@example.test" },
  });
  expect(expiredConfirmation.status()).toBe(409);
  expect((await e2eDb.booking.findUniqueOrThrow({ where: { id: heldBooking.id } })).status).toBe("expired");
  const slotsAfterExpiry = await availableSlots(request, fixture.hostSlug, fixture.guestEventSlug, from, to);
  expect(new Set(slotsAfterExpiry.map((slot) => slot.start)).has(originalSlot.start)).toBe(true);

  const idempotencyKey = randomUUID();
  const idempotentPayload = {
    eventTypeId: fixture.guestEventId,
    start: originalSlot.start,
    timezone: "UTC",
  };
  const retryContexts = await Promise.all([
    apiRequest.newContext({ baseURL: "http://127.0.0.1:3100" }),
    apiRequest.newContext({ baseURL: "http://127.0.0.1:3100" }),
  ]);
  let retries: APIResponse[];
  let retryBodies: Array<{ id: string }>;
  try {
    retries = await Promise.all(
      retryContexts.map((context) =>
        context.post("/api/holds", {
          headers: { "Idempotency-Key": idempotencyKey },
          data: idempotentPayload,
        }),
      ),
    );
    retryBodies = await Promise.all(
      retries.map((response) => response.json() as Promise<{ id: string }>),
    );
  } finally {
    await Promise.all(retryContexts.map((context) => context.dispose()));
  }
  expect(retries.map((response) => response.status()).sort()).toEqual([200, 201]);
  expect(retryBodies[0].id).toBe(retryBodies[1].id);

  expect(browserErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("shows the real slot-loading state on the public booking page", async ({ page }) => {
  const fixture = readE2EFixture();
  await page.route("**/api/hosts/**/slots?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(`/${fixture.hostSlug}/${fixture.guestEventSlug}`);
  await expect(page.getByText("Loading...")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hold this time for 5 minutes" })).toBeDisabled();
});

test.afterAll(async () => {
  await e2eDb.$disconnect();
});
