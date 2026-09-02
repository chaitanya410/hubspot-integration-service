import pRetry, { AbortError } from "p-retry";
import type { AxiosError } from "axios";
import { logger } from "./logger";

export interface RetryOptions {
  /** Total attempts including the first one. Default 5. */
  retries?: number;
  /** Base delay in ms for exponential backoff. Default 500ms. */
  minTimeout?: number;
  /** Upper bound for a single backoff delay. Default 15s. */
  maxTimeout?: number;
  /** Label used in log lines, e.g. "hubspot.contacts.list". */
  label?: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * Runs `fn` with exponential backoff + jitter, retrying only on
 * transient failures: HTTP 429 (rate limited) and 5xx (upstream
 * having a bad time), or network-level errors with no response at all
 * (timeouts, DNS blips, connection resets).
 *
 * Anything else (4xx auth/validation errors) is NOT retried - it's
 * aborted immediately via p-retry's AbortError so we fail fast instead
 * of hammering an endpoint that will never succeed.
 *
 * When the upstream sends a `Retry-After` header (seconds, HubSpot does
 * this on 429s), we honor it instead of our own backoff schedule.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 5, minTimeout = 500, maxTimeout = 15_000, label = "request" } = opts;

  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr?.response?.status;
        const hasResponse = axiosErr?.response !== undefined;

        const isRetryable = (status !== undefined && RETRYABLE_STATUS.has(status)) || (!hasResponse && !!axiosErr?.request);

        if (!isRetryable) {
          // Non-transient (4xx, validation, etc.) - stop retrying immediately.
          throw new AbortError(err as Error);
        }

        const retryAfterHeader = axiosErr?.response?.headers?.["retry-after"];
        if (retryAfterHeader) {
          const seconds = Number(retryAfterHeader);
          if (!Number.isNaN(seconds) && seconds > 0) {
            await sleep(seconds * 1000);
          }
        }

        throw err;
      }
    },
    {
      retries,
      minTimeout,
      maxTimeout,
      randomize: true,
      onFailedAttempt: (error) => {
        logger.warn(
          {
            label,
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            message: error.message,
          },
          `[retry] ${label} failed, ${error.retriesLeft} retries left`,
        );
      },
    },
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
