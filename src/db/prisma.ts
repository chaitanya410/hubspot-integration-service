import { PrismaClient } from "@prisma/client";

/**
 * Single shared PrismaClient instance. Reused across the app (and across
 * hot-reloads in dev) to avoid exhausting DB connections.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

export const prisma = global.__prisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma__ = prisma;
}
