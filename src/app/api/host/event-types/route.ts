import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createHostEventType,
  eventTypeInputSchema,
  HostManagementError,
  listHostEventTypes,
} from "@/lib/host-management";
import { getHostSessionId } from "@/lib/host-session";

const createSchema = eventTypeInputSchema;

export async function GET() {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  return NextResponse.json({ eventTypes: await listHostEventTypes(hostId) });
}

export async function POST(request: Request) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid event type.", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const eventType = await createHostEventType(hostId, parsed.data);
    return NextResponse.json({ eventType }, { status: 201 });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
