import { NextResponse } from "next/server";
import { z } from "zod";
import {
  availabilityOverrideInputSchema,
  deleteAvailabilityOverride,
  HostManagementError,
  updateAvailabilityOverride,
} from "@/lib/host-management";
import { getHostSessionId } from "@/lib/host-session";

type RouteContext = { params: Promise<{ id: string; overrideId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  const parsed = availabilityOverrideInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid date override.", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const { id, overrideId } = await params;
    const override = await updateAvailabilityOverride(hostId, id, overrideId, parsed.data);
    return NextResponse.json({ override });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  try {
    const { id, overrideId } = await params;
    await deleteAvailabilityOverride(hostId, id, overrideId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
