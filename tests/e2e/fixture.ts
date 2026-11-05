import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface E2EFixture {
  hostId: string;
  hostName: string;
  hostSlug: string;
  email: string;
  password: string;
  guestEventId: string;
  guestEventSlug: string;
}

export function readE2EFixture(): E2EFixture {
  const fixturePath = join(process.cwd(), ".playwright", "fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as E2EFixture;
}
