import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingError, cancelBooking } from "@/lib/booking-service";

const cancelSchema = z.object({
  reason: z.string().trim().min(2).max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!body.success || !/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.json({ message: "Invalid cancellation request." }, { status: 400 });
  }

  try {
    return NextResponse.json(await cancelBooking(token, body.data.reason ?? "Cancelled by guest."));
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
