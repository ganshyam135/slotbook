import { NextResponse } from "next/server";
import { z } from "zod";
import { BookingError, rescheduleBooking } from "@/lib/booking-service";

const rescheduleSchema = z.object({
  newStart: z.iso.datetime(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = rescheduleSchema.safeParse(await request.json().catch(() => null));
  if (!body.success || !/^[a-f0-9]{64}$/i.test(token)) {
    return NextResponse.json({ message: "Invalid reschedule request." }, { status: 400 });
  }

  try {
    return NextResponse.json(await rescheduleBooking(token, new Date(body.data.newStart)));
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
