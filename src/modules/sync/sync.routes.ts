import { Router } from "express";
import { runSync, listSyncRuns } from "./sync.service";
import { ValidationError } from "../../lib/errors";

export const syncRouter = Router();

/** Full sync of contacts: paginates HubSpot, upserts locally, idempotent. */
syncRouter.post("/contacts", async (req, res) => {
  const result = await runSync("contacts");
  res.json(result);
});

/** Full sync of deals: paginates HubSpot, upserts locally, idempotent. */
syncRouter.post("/deals", async (req, res) => {
  const result = await runSync("deals");
  res.json(result);
});

/** Convenience endpoint: syncs both entity types sequentially. */
syncRouter.post("/", async (req, res) => {
  const contacts = await runSync("contacts");
  const deals = await runSync("deals");
  res.json({ contacts, deals });
});

/** Observability: recent sync run history (status, counts, errors). */
syncRouter.get("/runs", async (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  if (Number.isNaN(limit) || limit <= 0) {
    throw new ValidationError("`limit` must be a positive number");
  }
  res.json(await listSyncRuns(limit));
});
