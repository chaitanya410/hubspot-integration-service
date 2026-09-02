import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { fetchAllContacts, fetchAllDeals } from "../../integrations/hubspot/endpoints";
import { mapHubSpotContact, mapHubSpotDeal } from "../../integrations/hubspot/mappers";
import type { HubSpotCrmObject } from "../../integrations/hubspot/types";

export type EntityType = "contacts" | "deals";

/**
 * Runs a full sync for one entity type: paginates through every HubSpot
 * record and upserts it into the local DB keyed by `hubspotId`, so
 * re-running the sync is idempotent - it never creates duplicates, it
 * just refreshes existing rows.
 *
 * Progress is recorded in a SyncRun row (visible via GET /sync/runs) so
 * failures mid-sync are visible and debuggable rather than silent.
 */
export async function runSync(entityType: EntityType) {
  const syncRun = await prisma.syncRun.create({
    data: { entityType, status: "running" },
  });

  let recordsSynced = 0;
  let pagesFetched = 0;

  try {
    const upsertPage = async (page: HubSpotCrmObject[]) => {
      if (entityType === "contacts") {
        await Promise.all(page.map((obj) => upsertContact(obj)));
      } else {
        await Promise.all(page.map((obj) => upsertDeal(obj)));
      }
      recordsSynced += page.length;
      logger.info({ entityType, pageSize: page.length, recordsSynced }, "Synced a page of records");
    };

    const result = entityType === "contacts" ? await fetchAllContacts(upsertPage) : await fetchAllDeals(upsertPage);
    pagesFetched = result.pagesFetched;

    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: "success", recordsSynced, pagesFetched, finishedAt: new Date() },
    });

    logger.info({ entityType, recordsSynced, pagesFetched }, "Sync completed successfully");
    return { entityType, recordsSynced, pagesFetched, status: "success" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: "failed", recordsSynced, pagesFetched, error: message, finishedAt: new Date() },
    });
    logger.error({ entityType, err: message }, "Sync failed");
    throw err;
  }
}

export async function upsertContact(obj: HubSpotCrmObject) {
  const data = mapHubSpotContact(obj);
  return prisma.contact.upsert({
    where: { hubspotId: data.hubspotId },
    update: { ...data, syncedAt: new Date() },
    create: data,
  });
}

export async function upsertDeal(obj: HubSpotCrmObject) {
  const data = mapHubSpotDeal(obj);
  return prisma.deal.upsert({
    where: { hubspotId: data.hubspotId },
    update: { ...data, syncedAt: new Date() },
    create: data,
  });
}

export async function listSyncRuns(limit = 20) {
  return prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
}
