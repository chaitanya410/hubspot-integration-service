import { createApp } from "./expressApp";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { startScheduledSync } from "./jobs/scheduledSync";
import { prisma } from "./db/prisma";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 hubspot-integration-service listening on ${env.BASE_URL} (port ${env.PORT}, env=${env.NODE_ENV})`);
  startScheduledSync();
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});
