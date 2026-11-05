import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export const SESSION_COOKIE_NAME = "slotbook_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function authSecret() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }
  return secret;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createSessionToken(hostId: string, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = `${hostId}.${expiresAt}`;
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()) {
  if (!token) return null;
  const [hostId, expiryValue, signature, extra] = token.split(".");
  if (!hostId || !expiryValue || !signature || extra !== undefined) return null;

  const expiresAt = Number(expiryValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;

  const payload = `${hostId}.${expiryValue}`;
  const expected = createHmac("sha256", authSecret()).update(payload).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected) ? hostId : null;
}

export function managementTokenForBooking(id: string) {
  return createHmac("sha256", authSecret()).update(`slotbook-management:${id}`).digest("hex");
}

export function hashManagementToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildManagementUrl(token: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/bookings/${token}`;
}
