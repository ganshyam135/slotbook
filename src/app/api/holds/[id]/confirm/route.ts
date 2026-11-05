import { NextResponse } from "next/server";
import { BookingError, confirmHold } from "@/lib/booking-service";
import { confirmHoldRequestSchema } from "@/lib/booking-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = confirmHoldRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "A valid guest name and email are required.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const guestDetails = parsed.data.guestName && parsed.data.guestEmail
      ? { guestName: parsed.data.guestName, guestEmail: parsed.data.guestEmail }
      : undefined;
    return NextResponse.json(await confirmHold(id, guestDetails));
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
