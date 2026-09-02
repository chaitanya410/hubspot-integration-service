import { Router } from "express";
import { prisma } from "../../db/prisma";
import { parseListQuery } from "../../lib/pagination";
import { NotFoundError } from "../../lib/errors";

export const contactsRouter = Router();

const SORTABLE_FIELDS = ["createdAt", "updatedAt", "email", "lastName", "hubspotUpdatedAt"];

/**
 * GET /contacts?email=&company=&lifecycleStage=&sort=updatedAt:desc&page=1&pageSize=25
 * Serves data purely from the local DB (populated by /sync or webhooks) -
 * this never calls out to HubSpot directly, so it stays fast and available
 * even if HubSpot itself is down or rate-limiting us.
 */
contactsRouter.get("/", async (req, res) => {
  const { skip, take, page, pageSize, orderBy } = parseListQuery(req.query as Record<string, unknown>, SORTABLE_FIELDS);

  const where: Record<string, unknown> = {};
  if (typeof req.query.email === "string") where.email = { contains: req.query.email };
  if (typeof req.query.company === "string") where.company = { contains: req.query.company };
  if (typeof req.query.lifecycleStage === "string") where.lifecycleStage = req.query.lifecycleStage;

  const [items, total] = await Promise.all([
    prisma.contact.findMany({ where, skip, take, orderBy: orderBy ?? { updatedAt: "desc" } }),
    prisma.contact.count({ where }),
  ]);

  res.json({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

contactsRouter.get("/:id", async (req, res) => {
  const contact = await prisma.contact.findUnique({ where: { id: req.params.id } });
  if (!contact) throw new NotFoundError(`Contact ${req.params.id} not found`);
  res.json(contact);
});
