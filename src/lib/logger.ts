import pino from "pino";
import { env } from "../config/env";

/**
 * Structured JSON logger (pino). In development it's piped through
 * pino-pretty for readability; in production it stays newline-delimited
 * JSON so it's easy to ship to any log aggregator.
 *
 * Sensitive fields (tokens, secrets, auth headers) are redacted so they
 * never end up in logs even if a caller accidentally logs a whole object.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "*.accessToken",
      "*.refreshToken",
      "*.access_token",
      "*.refresh_token",
      "*.client_secret",
      "*.HUBSPOT_CLIENT_SECRET",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});
