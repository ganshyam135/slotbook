import { NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { createSessionToken, SESSION_COOKIE_NAME, verifyPassword } from "@/lib/auth";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const body = loginSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 400 });
  }

  const host = await db.host.findUnique({
    where: { email: body.data.email.toLowerCase() },
  });

  if (!host) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  }

  const valid = await verifyPassword(body.data.password, host.passwordHash);
  if (!valid) {
    return NextResponse.json({ message: "Invalid email or password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, host: { id: host.id, name: host.name } });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(host.id),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
