import crypto from "node:crypto";
import { IANAZone } from "luxon";
import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingError, createHold } from "@/lib/booking-service";

const holdSchema = z.object({
  eventTypeId: z.string().min(1),
  start: z.iso.datetime(),
  timezone: z.string().refine(IANAZone.isValidZone, "Invalid IANA timezone."),
  guestName: z.string().trim().min(2).max(120),
  guestEmail: z.email().max(254),
});

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsed = holdSchema.safeParse(rawBody);

  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid hold request.", issues: parsed.error.issues }, { status: 400 });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 255)) {
    return NextResponse.json({ message: "Idempotency-Key must contain 8 to 255 characters." }, { status: 400 });
  }

  const payload = parsed.data;
  const requestHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  try {
    const result = await createHold({
      eventTypeId: payload.eventTypeId,
      start: new Date(payload.start),
      guestName: payload.guestName,
      guestEmail: payload.guestEmail,
      idempotencyKey,
      requestHash,
    });
    const { replay, ...response } = result;
    return NextResponse.json(response, { status: replay ? 200 : 201 });
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
