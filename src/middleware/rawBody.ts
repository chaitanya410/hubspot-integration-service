import express from "express";
import type { Request } from "express";

// Augment Express's Request type with the raw body buffer we capture below.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

/**
 * JSON body parser that also stashes the exact raw request body (as a
 * string) on `req.rawBody`. We need the *unmodified* bytes to validate
 * HubSpot's webhook HMAC signature - re-serializing the parsed JSON object
 * is not guaranteed to produce byte-identical output (key order, spacing),
 * which would make signature verification fail unpredictably.
 */
export const jsonBodyParser = express.json({
  limit: "1mb",
  verify: (req: Request, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  },
});
