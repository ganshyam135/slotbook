import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteHostEventType,
  eventTypeInputSchema,
  HostManagementError,
  updateHostEventType,
} from "@/lib/host-management";
import { getHostSessionId } from "@/lib/host-session";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  const parsed = eventTypeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid event type.", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const { id } = await params;
    const eventType = await updateHostEventType(hostId, id, parsed.data);
    return NextResponse.json({ eventType });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  try {
    const { id } = await params;
    await deleteHostEventType(hostId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
