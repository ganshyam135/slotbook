import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { IANAZone } from "luxon";
import { z } from "zod";
import db from "@/lib/db";

const eventTypeFields = {
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  durationMinutes: z.number().int().min(15).max(120).multipleOf(15),
  capacity: z.number().int().min(1).max(100),
  bufferBeforeMinutes: z.number().int().min(0).max(30),
  bufferAfterMinutes: z.number().int().min(0).max(30),
  minNoticeMinutes: z.number().int().min(0).max(43_200),
  bookingHorizonDays: z.number().int().min(1).max(365),
};

export const eventTypeInputSchema = z.object(eventTypeFields).strict();
export type EventTypeInput = z.infer<typeof eventTypeInputSchema>;
export const hostProfileInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  timezone: z.string().trim().refine(IANAZone.isValidZone, "Enter a valid IANA time zone."),
}).strict();
export type HostProfileInput = z.infer<typeof hostProfileInputSchema>;
const availabilityWindowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1425).multipleOf(15),
  endMinute: z.number().int().min(15).max(1440).multipleOf(15),
}).strict();
export const weeklyAvailabilityInputSchema = z.object({
  windows: z.array(availabilityWindowSchema).max(35),
}).strict().superRefine(({ windows }, context) => {
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const dayWindows = windows
      .filter((window) => window.dayOfWeek === dayOfWeek)
      .sort((left, right) => left.startMinute - right.startMinute);
    for (let index = 0; index < dayWindows.length; index += 1) {
      const current = dayWindows[index];
      if (current.endMinute <= current.startMinute) {
        context.addIssue({
          code: "custom",
          message: "Window end must be after its start.",
          path: ["windows", index, "endMinute"],
        });
      }
      if (index > 0 && current.startMinute < dayWindows[index - 1].endMinute) {
        context.addIssue({
          code: "custom",
          message: "Availability windows on the same day cannot overlap.",
          path: ["windows", index, "startMinute"],
        });
      }
    }
  }
});
export type WeeklyAvailabilityInput = z.infer<typeof weeklyAvailabilityInputSchema>;

export const availabilityOverrideInputSchema = z.object({
  localDate: z.iso.date(),
  isUnavailable: z.boolean(),
  startMinute: z.number().int().min(0).max(1425).multipleOf(15).optional(),
  endMinute: z.number().int().min(15).max(1440).multipleOf(15).optional(),
}).strict().superRefine((override, context) => {
  if (override.isUnavailable) {
    if (override.startMinute !== undefined || override.endMinute !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Unavailable dates cannot include custom hours.",
        path: ["isUnavailable"],
      });
    }
    return;
  }

  if (
    override.startMinute === undefined ||
    override.endMinute === undefined ||
    override.endMinute <= override.startMinute
  ) {
    context.addIssue({
      code: "custom",
      message: "Custom hours require an end time after the start time.",
      path: ["endMinute"],
    });
  }
});
export type AvailabilityOverrideInput = z.infer<typeof availabilityOverrideInputSchema>;

export class HostManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HostManagementError";
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isRecordNotFoundError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function lockHostEventType(
  tx: Prisma.TransactionClient,
  hostId: string,
  eventTypeId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "EventType"
    WHERE "id" = ${eventTypeId} AND "hostId" = ${hostId}
    FOR UPDATE
  `;
  if (!rows[0]) throw new HostManagementError("Event type not found.", 404);
}

export async function listWeeklyAvailability(hostId: string, eventTypeId: string) {
  const event = await db.eventType.findFirst({
    where: { id: eventTypeId, hostId },
    select: { id: true },
  });
  if (!event) throw new HostManagementError("Event type not found.", 404);
  return db.availabilityRule.findMany({
    where: { eventTypeId },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
}

export async function replaceWeeklyAvailability(
  hostId: string,
  eventTypeId: string,
  input: WeeklyAvailabilityInput,
) {
  return db.$transaction(async (tx) => {
    await lockHostEventType(tx, hostId, eventTypeId);
    await tx.availabilityRule.deleteMany({ where: { eventTypeId } });
    if (input.windows.length > 0) {
      await tx.availabilityRule.createMany({
        data: input.windows.map((window) => ({ id: randomUUID(), eventTypeId, ...window })),
      });
    }
    return tx.availabilityRule.findMany({
      where: { eventTypeId },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    });
  });
}

export async function listAvailabilityOverrides(hostId: string, eventTypeId: string) {
  const event = await db.eventType.findFirst({
    where: { id: eventTypeId, hostId },
    select: { id: true },
  });
  if (!event) throw new HostManagementError("Event type not found.", 404);
  const overrides = await db.availabilityOverride.findMany({
    where: { eventTypeId },
    orderBy: { localDate: "asc" },
  });
  return overrides.map((override) => ({ ...override, localDate: dateOnly(override.localDate) }));
}

function overrideData(input: AvailabilityOverrideInput) {
  if (
    !input.isUnavailable &&
    (input.startMinute === undefined || input.endMinute === undefined)
  ) {
    throw new HostManagementError("Custom hours require a start and end time.", 400);
  }

  return {
    localDate: new Date(`${input.localDate}T00:00:00.000Z`),
    isUnavailable: input.isUnavailable,
    startMinute: input.isUnavailable ? null : input.startMinute,
    endMinute: input.isUnavailable ? null : input.endMinute,
  };
}

export async function createAvailabilityOverride(
  hostId: string,
  eventTypeId: string,
  input: AvailabilityOverrideInput,
) {
  try {
    return await db.$transaction(async (tx) => {
      await lockHostEventType(tx, hostId, eventTypeId);
      const override = await tx.availabilityOverride.create({
        data: { eventTypeId, ...overrideData(input) },
      });
      return { ...override, localDate: dateOnly(override.localDate) };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HostManagementError("An override already exists for this date.", 409);
    }
    throw error;
  }
}

export async function updateAvailabilityOverride(
  hostId: string,
  eventTypeId: string,
  overrideId: string,
  input: AvailabilityOverrideInput,
) {
  try {
    return await db.$transaction(async (tx) => {
      await lockHostEventType(tx, hostId, eventTypeId);
      const existing = await tx.availabilityOverride.findFirst({
        where: { id: overrideId, eventTypeId },
        select: { id: true },
      });
      if (!existing) throw new HostManagementError("Date override not found.", 404);
      const override = await tx.availabilityOverride.update({
        where: { id: existing.id },
        data: overrideData(input),
      });
      return { ...override, localDate: dateOnly(override.localDate) };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HostManagementError("An override already exists for this date.", 409);
    }
    throw error;
  }
}

export async function deleteAvailabilityOverride(
  hostId: string,
  eventTypeId: string,
  overrideId: string,
) {
  return db.$transaction(async (tx) => {
    await lockHostEventType(tx, hostId, eventTypeId);
    const existing = await tx.availabilityOverride.findFirst({
      where: { id: overrideId, eventTypeId },
      select: { id: true },
    });
    if (!existing) throw new HostManagementError("Date override not found.", 404);
    await tx.availabilityOverride.delete({ where: { id: existing.id } });
  });
}

export async function updateHostProfile(hostId: string, input: HostProfileInput) {
  try {
    return await db.host.update({
      where: { id: hostId },
      data: input,
      select: { id: true, name: true, timezone: true },
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      throw new HostManagementError("Host profile not found.", 404);
    }
    throw error;
  }
}

export async function listHostEventTypes(hostId: string) {
  return db.eventType.findMany({
    where: { hostId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { bookings: true } },
      availabilityRules: { orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] },
      availabilityOverrides: { orderBy: { localDate: "asc" } },
    },
  });
}

export async function createHostEventType(hostId: string, input: EventTypeInput) {
  try {
    return await db.eventType.create({
      data: { ...input, hostId },
      include: {
        _count: { select: { bookings: true } },
        availabilityRules: { orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] },
        availabilityOverrides: { orderBy: { localDate: "asc" } },
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HostManagementError("An event with this slug already exists.", 409);
    }
    throw error;
  }
}

export async function updateHostEventType(
  hostId: string,
  eventTypeId: string,
  input: EventTypeInput,
) {
  try {
    return await db.$transaction(async (tx) => {
      const event = await tx.eventType.findFirst({
        where: { id: eventTypeId, hostId },
        select: { id: true },
      });
      if (!event) throw new HostManagementError("Event type not found.", 404);

      return tx.eventType.update({
        where: { id: event.id },
        data: input,
        include: {
          _count: { select: { bookings: true } },
          availabilityRules: { orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }] },
          availabilityOverrides: { orderBy: { localDate: "asc" } },
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new HostManagementError("An event with this slug already exists.", 409);
    }
    throw error;
  }
}

export async function deleteHostEventType(hostId: string, eventTypeId: string) {
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "EventType"
      WHERE "id" = ${eventTypeId} AND "hostId" = ${hostId}
      FOR UPDATE
    `;
    if (!locked[0]) throw new HostManagementError("Event type not found.", 404);

    const bookingCount = await tx.booking.count({ where: { eventTypeId } });
    if (bookingCount > 0) {
      throw new HostManagementError(
        "This event has booking history and cannot be deleted. Edit its details instead.",
        409,
      );
    }

    await tx.eventType.delete({ where: { id: eventTypeId } });
  });
}
