import axios, { AxiosError } from "axios";
import { getValidAccessToken } from "../../modules/auth/auth.service";
import { withRetry } from "../../lib/retry";
import { UpstreamApiError } from "../../lib/errors";
import { logger } from "../../lib/logger";

const BASE_URL = "https://api.hubapi.com";

const http = axios.create({ baseURL: BASE_URL, timeout: 15_000 });

/**
 * Thin wrapper around the raw axios instance that:
 *  1. Attaches a fresh Bearer token on every call (refreshing first if needed).
 *  2. Retries transient failures (429/5xx) with backoff via withRetry().
 *  3. On a 401 (token was revoked/invalidated mid-flight), refreshes once
 *     and retries the request exactly once more before giving up.
 *  4. Normalizes any remaining failure into an UpstreamApiError so callers
 *     never have to deal with raw axios error shapes.
 */
async function request<T>(label: string, run: (accessToken: string) => Promise<T>): Promise<T> {
  let accessToken = await getValidAccessToken();

  try {
    return await withRetry(() => run(accessToken), { label });
  } catch (err) {
    const axiosErr = err as AxiosError<any>;
    const status = axiosErr?.response?.status;

    if (status === 401) {
      logger.warn({ label }, "HubSpot returned 401, forcing a token refresh and retrying once");
      accessToken = await getValidAccessToken();
      try {
        return await run(accessToken);
      } catch (retryErr) {
        throw toUpstreamError(label, retryErr as AxiosError);
      }
    }

    throw toUpstreamError(label, axiosErr);
  }
}

function toUpstreamError(label: string, err: AxiosError<any>): UpstreamApiError {
  const status = err.response?.status;
  const upstreamMessage = err.response?.data?.message ?? err.message;
  logger.error({ label, status, upstreamMessage, data: err.response?.data }, `HubSpot request failed: ${label}`);
  return new UpstreamApiError({
    message: `HubSpot API error during ${label}: ${upstreamMessage}`,
    upstreamStatus: status,
    details: err.response?.data,
  });
}

export const hubspotClient = {
  get: <T>(label: string, url: string, params?: Record<string, unknown>) =>
    request<T>(label, (token) =>
      http.get<T>(url, { params, headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data),
    ),

  post: <T>(label: string, url: string, body?: unknown) =>
    request<T>(label, (token) =>
      http.post<T>(url, body, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data),
    ),
};
