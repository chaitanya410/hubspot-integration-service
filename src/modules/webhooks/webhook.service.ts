import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import type { HubSpotWebhookEvent } from "../../integrations/hubspot/types";
import { fetchContactById, fetchDealById } from "../../integrations/hubspot/endpoints";
import { upsertContact, upsertDeal } from "../sync/sync.service";
import { NotFoundError } from "../../lib/errors";

/**
 * Persists every incoming event first (for auditability + idempotency via
 * the unique `eventId`), then processes each one: creations/updates
 * re-fetch the current object state from HubSpot (the webhook payload
 * itself only carries the changed property, not the full record) and
 * upsert it locally; deletions are marked archived.
 *
 * Storing before processing means we never lose an event even if
 * processing throws - it's retried on demand.
 */
export async function handleWebhookEvents(events: HubSpotWebhookEvent[]) {
  const results: Array<{ eventId: number; status: "processed" | "skipped_duplicate" | "failed" }> = [];

  for (const event of events) {
    const eventIdStr = String(event.eventId);

    const existing = await prisma.webhookEvent.findUnique({ where: { eventId: eventIdStr } });
    if (existing?.processed) {
      results.push({ eventId: event.eventId, status: "skipped_duplicate" });
      continue;
    }

    const record =
      existing ??
      (await prisma.webhookEvent.create({
        data: {
          eventId: eventIdStr,
          subscriptionType: event.subscriptionType,
          objectId: String(event.objectId),
          occurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
          changeSource: event.changeSource,
          payload: JSON.stringify(event),
        },
      }));

    try {
      await processEvent(event);
      await prisma.webhookEvent.update({ where: { id: record.id }, data: { processed: true, processingError: null } });
      results.push({ eventId: event.eventId, status: "processed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.webhookEvent.update({ where: { id: record.id }, data: { processingError: message } });
      logger.error({ eventId: event.eventId, err: message }, "Failed to process webhook event");
      results.push({ eventId: event.eventId, status: "failed" });
    }
  }

  return results;
}

async function processEvent(event: HubSpotWebhookEvent) {
  const objectId = String(event.objectId);
  const type = event.subscriptionType;

  if (type.startsWith("contact.")) {
    if (type === "contact.deletion" || type === "contact.privacyDeletion") {
      await prisma.contact.updateMany({ where: { hubspotId: objectId }, data: { archived: true } });
      return;
    }
    const obj = await fetchContactById(objectId);
    await upsertContact(obj);
    return;
  }

  if (type.startsWith("deal.")) {
    if (type === "deal.deletion") {
      await prisma.deal.updateMany({ where: { hubspotId: objectId }, data: { archived: true } });
      return;
    }
    const obj = await fetchDealById(objectId);
    await upsertDeal(obj);
    return;
  }

  logger.warn({ subscriptionType: type }, "Received webhook for an unhandled subscription type, storing only");
}

export async function listWebhookEvents(limit = 50) {
  return prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: limit });
}

/**
 * Re-runs processing for one previously-stored event (e.g. one that
 * failed because no HubSpot account was connected yet, or HubSpot was
 * briefly unreachable). Useful both operationally and for demoing that
 * a failed webhook isn't lost - it's retriable on demand via
 * POST /webhooks/events/:id/retry.
 */
export async function retryWebhookEvent(id: string) {
  const record = await prisma.webhookEvent.findUnique({ where: { id } });
  if (!record) throw new NotFoundError(`Webhook event ${id} not found`);

  const event = JSON.parse(record.payload) as HubSpotWebhookEvent;

  try {
    await processEvent(event);
    await prisma.webhookEvent.update({ where: { id }, data: { processed: true, processingError: null } });
    return { status: "processed" as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.webhookEvent.update({ where: { id }, data: { processingError: message } });
    throw err;
  }
}
