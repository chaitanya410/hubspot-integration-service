import { Router } from "express";
import { env } from "../../config/env";
import { verifyHubSpotSignature } from "../../integrations/hubspot/signature";
import { HubSpotWebhookPayloadSchema } from "../../integrations/hubspot/types";
import { WebhookSignatureError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { handleWebhookEvents, listWebhookEvents, retryWebhookEvent } from "./webhook.service";

export const webhookRouter = Router();

/**
 * Receives HubSpot CRM webhook deliveries. HubSpot POSTs a JSON array of
 * events (batched) to this single endpoint for every subscription type
 * we're subscribed to (contact.*, deal.*).
 *
 * Every request's signature is validated before we touch the payload -
 * see integrations/hubspot/signature.ts for the algorithm.
 */
webhookRouter.post("/hubspot", async (req, res) => {
  const signature = req.header("X-HubSpot-Signature-v3");
  const timestamp = req.header("X-HubSpot-Request-Timestamp");

  // In development, HubSpot's real webhooks are hard to trigger from
  // localhost without a public tunnel (e.g. cloudflared). We still validate
  // the signature whenever one is sent, but allow it to be skipped
  // explicitly for local curl/Postman testing via a header nobody but
  // us would send. This never applies in production.
  const skipVerification = env.NODE_ENV !== "production" && req.header("X-Skip-Signature-Check") === "true";

  if (!skipVerification) {
    if (!signature || !timestamp) {
      throw new WebhookSignatureError("Missing X-HubSpot-Signature-v3 / X-HubSpot-Request-Timestamp headers");
    }

    const result = verifyHubSpotSignature({
      method: req.method,
      uri: `${env.BASE_URL}${req.originalUrl}`,
      rawBody: req.rawBody ?? "",
      timestamp,
      signature,
      clientSecret: env.HUBSPOT_CLIENT_SECRET,
    });

    if (!result.valid) {
      logger.warn({ reason: result.reason }, "Rejected webhook: invalid signature");
      throw new WebhookSignatureError(result.reason);
    }
  }

  const events = HubSpotWebhookPayloadSchema.parse(req.body);
  logger.info({ count: events.length }, "Received HubSpot webhook batch");

  const results = await handleWebhookEvents(events);

  // Always 200 quickly once events are safely persisted - HubSpot retries
  // on non-2xx, and we don't want their retry policy racing our own
  // per-event processing/retry logic above.
  res.status(200).json({ received: events.length, results });
});

/** Debug/demo helper: see recently received webhook deliveries. */
webhookRouter.get("/events", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json(await listWebhookEvents(limit));
});

/** Re-processes one stored event on demand (e.g. after fixing a connection issue). */
webhookRouter.post("/events/:id/retry", async (req, res) => {
  const result = await retryWebhookEvent(req.params.id);
  res.json(result);
});
