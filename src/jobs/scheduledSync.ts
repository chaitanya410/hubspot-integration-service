import { env } from "../config/env";
import { logger } from "../lib/logger";
import { runSync } from "../modules/sync/sync.service";
import { getConnectionStatus } from "../modules/auth/auth.service";

/**
 * Optional background sync job (bonus: "Background job or queue for
 * syncing"). Gated behind ENABLE_SCHEDULED_SYNC so the default local/dev
 * experience stays purely on-demand (POST /sync). When enabled, it runs
 * every SYNC_INTERVAL_MINUTES on a plain interval timer and simply skips
 * itself if no HubSpot account is connected yet, instead of failing
 * noisily.
 *
 * A fixed interval is all this needs (no cron-style scheduling
 * requirements), so we use `setInterval` directly rather than pulling in
 * a cron library and its dependency footprint.
 */
export function startScheduledSync() {
  if (!env.ENABLE_SCHEDULED_SYNC) {
    logger.info("Scheduled sync disabled (ENABLE_SCHEDULED_SYNC=false)");
    return;
  }

  const intervalMs = env.SYNC_INTERVAL_MINUTES * 60_000;
  logger.info({ intervalMinutes: env.SYNC_INTERVAL_MINUTES }, "Scheduled sync enabled");

  const timer = setInterval(runScheduledSyncOnce, intervalMs);
  timer.unref(); // never keep the process alive on its own (e.g. during graceful shutdown)
  return timer;
}

async function runScheduledSyncOnce() {
  const status = await getConnectionStatus();
  if (!status.connected) {
    logger.debug("Scheduled sync skipped: no HubSpot account connected yet");
    return;
  }

  logger.info("Scheduled sync starting");
  try {
    await runSync("contacts");
    await runSync("deals");
    logger.info("Scheduled sync finished");
  } catch (err) {
    logger.error({ err }, "Scheduled sync run failed");
  }
}
