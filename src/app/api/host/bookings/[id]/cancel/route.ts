import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth";
import { BookingError, cancelBookingForHost } from "@/lib/booking-service";

const cancelSchema = z.object({
  reason: z.string().trim().min(2).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionId = verifySessionToken((await cookies()).get(SESSION_COOKIE_NAME)?.value);
  if (!sessionId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  const { id } = await params;
  const body = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ message: "A cancellation reason of 2 to 500 characters is required." }, { status: 400 });
  }

  try {
    return NextResponse.json(await cancelBookingForHost(id, sessionId, body.data.reason));
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
