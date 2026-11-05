import { PrismaClient } from "@prisma/client";
import { getE2EDatabaseUrl } from "./database-url";

const globalForE2E = globalThis as typeof globalThis & {
  slotbookE2EDb?: PrismaClient;
};

export const e2eDb =
  globalForE2E.slotbookE2EDb ??
  new PrismaClient({ datasources: { db: { url: getE2EDatabaseUrl() } } });

if (process.env.NODE_ENV !== "production") {
  globalForE2E.slotbookE2EDb = e2eDb;
}
