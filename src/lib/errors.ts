/**
 * Base class for all errors we deliberately throw. `expose` controls
 * whether the message is safe to send back in an HTTP response body
 * (vs. just being logged server-side).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;
  readonly details?: unknown;

  constructor(opts: { message: string; statusCode: number; code: string; expose?: boolean; details?: unknown }) {
    super(opts.message);
    this.name = new.target.name;
    this.statusCode = opts.statusCode;
    this.code = opts.code;
    this.expose = opts.expose ?? true;
    this.details = opts.details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ message, statusCode: 400, code: "VALIDATION_ERROR", details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super({ message, statusCode: 404, code: "NOT_FOUND" });
  }
}

export class AuthError extends AppError {
  constructor(message = "Not authenticated with HubSpot") {
    super({ message, statusCode: 401, code: "AUTH_ERROR" });
  }
}

export class WebhookSignatureError extends AppError {
  constructor(message = "Invalid webhook signature") {
    super({ message, statusCode: 401, code: "INVALID_SIGNATURE" });
  }
}

/**
 * Wraps a failure returned by the upstream (HubSpot) API so our own
 * responses can map it to a clear, consistent shape instead of leaking
 * raw axios error internals.
 */
export class UpstreamApiError extends AppError {
  readonly upstreamStatus?: number;

  constructor(opts: { message: string; upstreamStatus?: number; details?: unknown }) {
    super({
      message: opts.message,
      statusCode: opts.upstreamStatus && opts.upstreamStatus < 500 ? 502 : 502,
      code: "UPSTREAM_API_ERROR",
      details: opts.details,
    });
    this.upstreamStatus = opts.upstreamStatus;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
