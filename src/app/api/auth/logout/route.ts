import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
  });
  return response;
}
