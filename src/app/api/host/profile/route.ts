import { NextResponse } from "next/server";
import { z } from "zod";
import {
  HostManagementError,
  hostProfileInputSchema,
  updateHostProfile,
} from "@/lib/host-management";
import { getHostSessionId } from "@/lib/host-session";

export async function PATCH(request: Request) {
  const hostId = await getHostSessionId();
  if (!hostId) return NextResponse.json({ message: "Authentication required." }, { status: 401 });

  const parsed = hostProfileInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid host profile.", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ host: await updateHostProfile(hostId, parsed.data) });
  } catch (error) {
    if (error instanceof HostManagementError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
