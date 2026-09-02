import { Router } from "express";
import { prisma } from "../../db/prisma";
import { parseListQuery } from "../../lib/pagination";
import { NotFoundError, ValidationError } from "../../lib/errors";

export const dealsRouter = Router();

const SORTABLE_FIELDS = ["createdAt", "updatedAt", "amount", "closeDate", "hubspotUpdatedAt"];

/**
 * GET /deals?stage=&pipeline=&minAmount=&maxAmount=&sort=amount:desc&page=1&pageSize=25
 * Served entirely from the local DB, same pattern as /contacts.
 */
dealsRouter.get("/", async (req, res) => {
  const { skip, take, page, pageSize, orderBy } = parseListQuery(req.query as Record<string, unknown>, SORTABLE_FIELDS);

  const where: Record<string, unknown> = {};
  if (typeof req.query.stage === "string") where.dealStage = req.query.stage;
  if (typeof req.query.pipeline === "string") where.pipeline = req.query.pipeline;

  const minAmount = req.query.minAmount ? Number(req.query.minAmount) : undefined;
  const maxAmount = req.query.maxAmount ? Number(req.query.maxAmount) : undefined;
  if (minAmount !== undefined || maxAmount !== undefined) {
    if (minAmount !== undefined && Number.isNaN(minAmount)) throw new ValidationError("`minAmount` must be a number");
    if (maxAmount !== undefined && Number.isNaN(maxAmount)) throw new ValidationError("`maxAmount` must be a number");
    where.amount = { ...(minAmount !== undefined ? { gte: minAmount } : {}), ...(maxAmount !== undefined ? { lte: maxAmount } : {}) };
  }

  const [items, total] = await Promise.all([
    prisma.deal.findMany({ where, skip, take, orderBy: orderBy ?? { updatedAt: "desc" } }),
    prisma.deal.count({ where }),
  ]);

  res.json({ items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

dealsRouter.get("/:id", async (req, res) => {
  const deal = await prisma.deal.findUnique({ where: { id: req.params.id } });
  if (!deal) throw new NotFoundError(`Deal ${req.params.id} not found`);
  res.json(deal);
});
