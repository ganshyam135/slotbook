import { Prisma } from "@prisma/client";
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
    include: { _count: { select: { bookings: true } } },
  });
}

export async function createHostEventType(hostId: string, input: EventTypeInput) {
  try {
    return await db.eventType.create({
      data: { ...input, hostId },
      include: { _count: { select: { bookings: true } } },
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
        include: { _count: { select: { bookings: true } } },
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
