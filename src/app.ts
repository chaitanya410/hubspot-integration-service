import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";

import { logger } from "./lib/logger";
import { jsonBodyParser } from "./middleware/rawBody";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import { authRouter } from "./modules/auth/auth.routes";
import { syncRouter } from "./modules/sync/sync.routes";
import { contactsRouter } from "./modules/contacts/contacts.routes";
import { dealsRouter } from "./modules/deals/deals.routes";
import { webhookRouter } from "./modules/webhooks/webhook.routes";
import { prisma } from "./db/prisma";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );
  app.use(jsonBodyParser);

  app.get("/", (_req, res) => {
    res.json({
      service: "hubspot-integration-service",
      status: "ok",
      docs: "See README.md for full endpoint documentation.",
      endpoints: {
        auth: ["GET /auth/hubspot/install", "GET /auth/hubspot/callback", "GET /auth/hubspot/status"],
        sync: ["POST /sync", "POST /sync/contacts", "POST /sync/deals", "GET /sync/runs"],
        contacts: ["GET /contacts", "GET /contacts/:id"],
        deals: ["GET /deals", "GET /deals/:id"],
        webhooks: ["POST /webhooks/hubspot", "GET /webhooks/events", "POST /webhooks/events/:id/retry"],
        health: ["GET /health"],
      },
    });
  });

  app.get("/health", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ok", db: "connected", uptimeSeconds: process.uptime() });
    } catch (_err) {
      res.status(503).json({ status: "error", db: "unreachable" });
    }
  });

  app.use("/auth", authRouter);
  app.use("/sync", syncRouter);
  app.use("/contacts", contactsRouter);
  app.use("/deals", dealsRouter);
  app.use("/webhooks", webhookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
