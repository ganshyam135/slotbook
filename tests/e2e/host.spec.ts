import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { readE2EFixture } from "./fixture";
import { e2eDb } from "./test-db";

test.afterEach(async () => {
  const fixture = readE2EFixture();
  const eventTypes = await e2eDb.eventType.findMany({
    where: {
      hostId: fixture.hostId,
      OR: [
        { slug: { startsWith: "e2e-schedule-" } },
        { slug: { startsWith: "e2e-delete-" } },
      ],
    },
    select: { id: true },
  });
  const eventTypeIds = eventTypes.map((eventType) => eventType.id);
  if (eventTypeIds.length > 0) {
    await e2eDb.booking.deleteMany({ where: { eventTypeId: { in: eventTypeIds } } });
    await e2eDb.eventType.deleteMany({ where: { id: { in: eventTypeIds } } });
  }
  await e2eDb.host.update({
    where: { id: fixture.hostId },
    data: { name: fixture.hostName, timezone: "UTC" },
  });
});

async function login(page: Page, fixture: ReturnType<typeof readE2EFixture>) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("Password").fill(fixture.password);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("protects the dashboard and rejects invalid host credentials", async ({ page }) => {
  const fixture = readE2EFixture();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email").fill(fixture.email);
  await page.getByLabel("Password").fill("incorrect-password");
  const loginResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  expect((await loginResponsePromise).status()).toBe(401);
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("host manages event types, profile, weekly hours, and date overrides", async ({ page, request }) => {
  test.setTimeout(45_000);
  const fixture = readE2EFixture();
  const browserErrors: string[] = [];
  let expectingConflict = false;
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !(expectingConflict && message.text().includes("409 (Conflict)"))
    ) {
      browserErrors.push(message.text());
    }
  });

  await login(page, fixture);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Add event type" }).click();

  const suffix = randomUUID().slice(-8);
  const eventName = "E2E Schedule Review";
  const eventSlug = `e2e-schedule-${suffix}`;
  await page.getByLabel("Name", { exact: true }).fill(eventName);
  await page.getByLabel("URL slug").fill(eventSlug);
  await page.getByLabel("Group capacity").fill("1");
  await page.getByRole("button", { name: "Create event type" }).click();
  const eventCard = page.locator("article").filter({ hasText: eventSlug });
  await expect(eventCard).toContainText(eventName);

  await eventCard.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E Schedule Review Updated");
  await page.getByLabel("Group capacity").fill("2");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(eventCard).toContainText("E2E Schedule Review Updated");
  await expect(eventCard).toContainText("capacity 2");

  await page.getByLabel("Host name").fill("E2E Host Updated");
  await page.getByLabel("Home time zone (IANA)").fill("America/New_York");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E Host Updated" })).toBeVisible();

  await eventCard.getByText("Availability and date overrides").click();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (const day of days) {
    await eventCard.getByLabel(day).check();
  }
  await eventCard
    .getByLabel("Monday")
    .locator("xpath=../..")
    .getByRole("button", { name: "Add window" })
    .click();
  await eventCard.locator("select").nth(4).selectOption("1080");
  await eventCard.locator("select").nth(5).selectOption("1140");
  await eventCard.getByRole("button", { name: "Save weekly hours" }).click();
  await expect(eventCard.getByRole("status").filter({ hasText: "Weekly availability saved." })).toBeVisible();

  const localDate = DateTime.utc().plus({ days: 10 }).setZone("America/New_York").toISODate();
  if (!localDate) throw new Error("Could not calculate the test override date.");
  const dateInput = eventCard.getByLabel("Host-local date");
  await dateInput.fill(localDate);
  await eventCard.getByLabel("Mark unavailable").check();
  await eventCard.getByRole("button", { name: "Add override" }).click();
  const overrideRow = eventCard.locator("li").filter({ hasText: localDate });
  await expect(overrideRow).toContainText("Unavailable");

  const eventTypesResponse = await page.request.get("/api/host/event-types");
  expect(eventTypesResponse.ok()).toBeTruthy();
  const eventTypes = await eventTypesResponse.json() as {
    eventTypes: Array<{ id: string; slug: string }>;
  };
  const managedEvent = eventTypes.eventTypes.find((event) => event.slug === eventSlug);
  expect(managedEvent).toBeDefined();
  if (!managedEvent) throw new Error("Host-created event type was missing from the authenticated API.");

  const unavailableRange = DateTime.fromISO(localDate, { zone: "America/New_York" });
  const query = new URLSearchParams({
    from: unavailableRange.startOf("day").toUTC().toISO()!,
    to: unavailableRange.plus({ days: 1 }).startOf("day").toUTC().toISO()!,
    tz: "UTC",
  });
  const guestSlotsResponse = await page.request.get(
    `/api/hosts/${fixture.hostSlug}/events/${eventSlug}/slots?${query}`,
  );
  expect(guestSlotsResponse.ok()).toBeTruthy();
  expect((await guestSlotsResponse.json() as { slots: unknown[] }).slots).toHaveLength(0);

  await overrideRow.getByRole("button", { name: "Edit" }).click();
  await eventCard.getByLabel("Mark unavailable").uncheck();
  await eventCard.locator("form").last().locator("select").nth(0).selectOption("600");
  await eventCard.locator("form").last().locator("select").nth(1).selectOption("660");
  await eventCard.getByRole("button", { name: "Update override" }).click();
  await expect(overrideRow).toContainText("10:00–11:00");

  const customSlotsResponse = await page.request.get(
    `/api/hosts/${fixture.hostSlug}/events/${eventSlug}/slots?${query}`,
  );
  expect(customSlotsResponse.ok()).toBeTruthy();
  const customSlots = (await customSlotsResponse.json() as {
    slots: Array<{ start: string }>;
  }).slots;
  expect(customSlots.length).toBeGreaterThan(0);
  expect(
    customSlots.every((slot) => {
      const local = DateTime.fromISO(slot.start, { zone: "utc" }).setZone("America/New_York");
      return local.hour === 10;
    }),
  ).toBe(true);

  await overrideRow.getByRole("button", { name: "Remove" }).click();
  await expect(eventCard.getByText("No date overrides.")).toBeVisible();
  const restoredSlotsResponse = await page.request.get(
    `/api/hosts/${fixture.hostSlug}/events/${eventSlug}/slots?${query}`,
  );
  expect(restoredSlotsResponse.ok()).toBeTruthy();
  const restoredSlots = (await restoredSlotsResponse.json() as {
    slots: Array<{ start: string; guestDay: string; guestTime: string }>;
  }).slots;
  expect(restoredSlots.length).toBeGreaterThan(0);
  const held = await page.request.post("/api/holds", {
    data: {
      eventTypeId: managedEvent.id,
      start: restoredSlots[0].start,
      timezone: "UTC",
    },
  });
  expect(held.status()).toBe(201);
  const limitedAvailabilityResponse = await page.request.get(
    `/api/hosts/${fixture.hostSlug}/events/${eventSlug}/slots?${query}`,
  );
  const limitedAvailability = await limitedAvailabilityResponse.json() as {
    slots: Array<{ start: string; remainingCapacity: number }>;
    availability: Array<{
      start: string;
      available: boolean;
      remainingCapacity: number;
      guestName?: string;
      guestEmail?: string;
      bookingId?: string;
      id?: string;
    }>;
  };
  const heldSlotSummary = limitedAvailability.availability.find(
    (slot) => slot.start === restoredSlots[0].start,
  );
  expect(heldSlotSummary).toMatchObject({ available: true, remainingCapacity: 1 });
  expect(limitedAvailability.slots.find((slot) => slot.start === restoredSlots[0].start)?.remainingCapacity)
    .toBe(1);
  expect(heldSlotSummary).not.toHaveProperty("guestName");
  expect(heldSlotSummary).not.toHaveProperty("guestEmail");
  expect(heldSlotSummary).not.toHaveProperty("bookingId");
  expect(heldSlotSummary).not.toHaveProperty("id");

  const guestDateLabel = DateTime.fromISO(`${restoredSlots[0].guestDay}T12:00`, { zone: "UTC" })
    .setLocale("en-US")
    .toLocaleString({ month: "short", day: "numeric" });
  await page.goto(`/${fixture.hostSlug}/${eventSlug}`);
  await expect(page.getByText("Loading...")).toBeHidden();
  const guestDate = page.getByRole("button", { name: new RegExp(`^${guestDateLabel},`) });
  await guestDate.click();
  await expect(page.getByRole("button", {
    name: `${restoredSlots[0].guestTime}, 1 spaces remaining`,
  })).toBeVisible();

  const secondSeat = await request.post("/api/holds", {
    data: {
      eventTypeId: managedEvent.id,
      start: restoredSlots[0].start,
      timezone: "UTC",
    },
  });
  expect(secondSeat.status()).toBe(201);
  const fullAvailabilityResponse = await page.request.get(
    `/api/hosts/${fixture.hostSlug}/events/${eventSlug}/slots?${query}`,
  );
  const fullAvailability = await fullAvailabilityResponse.json() as {
    slots: Array<{ start: string }>;
    availability: Array<{ start: string; available: boolean; remainingCapacity: number }>;
  };
  expect(fullAvailability.availability.find((slot) => slot.start === restoredSlots[0].start))
    .toMatchObject({ available: false, remainingCapacity: 0 });
  expect(fullAvailability.slots.some((slot) => slot.start === restoredSlots[0].start)).toBe(false);
  await page.reload();
  await expect(page.getByText("Loading...")).toBeHidden();
  await page.getByRole("button", { name: new RegExp(`^${guestDateLabel},`) }).click();
  const unavailableTime = page.getByRole("button", {
    name: `${restoredSlots[0].guestTime}, unavailable`,
  });
  await expect(unavailableTime).toBeVisible();
  await expect(unavailableTime).toBeDisabled();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  expectingConflict = true;
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/host/event-types/${managedEvent.id}`) &&
      response.request().method() === "DELETE",
  );
  await page.once("dialog", (dialog) => dialog.accept());
  await eventCard.getByRole("button", { name: "Delete" }).click();
  expect((await deleteResponsePromise).status()).toBe(409);
  await expect(page.getByText(/booking history/i)).toBeVisible();
  expectingConflict = false;
  await expect(eventCard).toBeVisible();

  await page.getByRole("button", { name: "Add event type" }).click();
  await page.getByLabel("Name", { exact: true }).fill("E2E Deletable Event");
  await page.getByLabel("URL slug").fill(`e2e-delete-${suffix}`);
  await page.getByRole("button", { name: "Create event type" }).click();
  const deletableCard = page.locator("article").filter({ hasText: `e2e-delete-${suffix}` });
  await page.once("dialog", (dialog) => dialog.accept());
  await deletableCard.getByRole("button", { name: "Delete" }).click();
  await expect(deletableCard).toHaveCount(0);

  expect(browserErrors).toEqual([]);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("guest availability and browser rendering have no hydration or responsive overflow errors", async ({ page }) => {
  const fixture = readE2EFixture();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/${fixture.hostSlug}/${fixture.guestEventSlug}`);
  await expect(page.getByRole("heading", { name: "E2E Guest Booking", level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Guest time zone" })).toBeVisible();
  await expect(
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).resolves.toBe(true);
  expect(browserErrors).toEqual([]);
});
