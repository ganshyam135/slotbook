import { NextResponse } from "next/server";
import { BookingError, confirmHold } from "@/lib/booking-service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return NextResponse.json(await confirmHold(id));
  } catch (error) {
    if (error instanceof BookingError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
