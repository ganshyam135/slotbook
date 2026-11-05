import { NextResponse } from "next/server";
import { z } from "zod";
import {
  availabilityOverrideInputSchema,
  createAvailabilityOverride,
  HostManagementError,
  listAvailabilityOverrides,
} from "@/lib/host-management";
import { getHostSessionId } from "@/lib/host-session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  try {
    const { id } = await params;
    return NextResponse.json({ overrides: await listAvailabilityOverrides(hostId, id) });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(request: Request, { params }: RouteContext) {
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
    const { id } = await params;
    const override = await createAvailabilityOverride(hostId, id, parsed.data);
    return NextResponse.json({ override }, { status: 201 });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
