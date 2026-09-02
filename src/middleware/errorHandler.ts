import type { NextFunction, Request, Response } from "express";
import { isAppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { ZodError } from "zod";

/**
 * Single place where every error in the app ends up (thanks to
 * express-async-errors forwarding rejected promises to next()).
 * Produces a consistent JSON error shape and makes sure unexpected
 * errors are logged with full detail server-side without leaking
 * internals to the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: err.issues },
    });
  }

  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, err.message);
    } else {
      logger.warn({ code: err.code, path: req.path }, err.message);
    }
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.expose ? err.message : "An error occurred",
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  logger.error({ err, path: req.path }, `Unhandled error: ${message}`);
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
}
