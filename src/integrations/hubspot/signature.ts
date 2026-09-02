import crypto from "crypto";

/** Reject any webhook request whose timestamp is older than this - guards
 * against replay attacks with a captured, still-validly-signed payload. */
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

/**
 * Validates HubSpot's v3 webhook signature.
 *
 * HubSpot signs `method + uri + requestBody + timestamp` with HMAC-SHA256
 * using the app's client secret, base64-encodes it, and sends it as the
 * `X-HubSpot-Signature-v3` header alongside `X-HubSpot-Request-Timestamp`.
 * Pure function (no I/O) so it's directly unit-testable.
 *
 * @param rawBody the exact, unparsed request body bytes as a string
 */
export function verifyHubSpotSignature(opts: {
  method: string;
  uri: string;
  rawBody: string;
  timestamp: string;
  signature: string;
  clientSecret: string;
}): { valid: boolean; reason?: string } {
  const { method, uri, rawBody, timestamp, signature, clientSecret } = opts;

  const age = Date.now() - Number(timestamp);
  if (!timestamp || Number.isNaN(age) || age > MAX_TIMESTAMP_AGE_MS || age < -MAX_TIMESTAMP_AGE_MS) {
    return { valid: false, reason: "Timestamp missing or outside the allowed window (possible replay)" };
  }

  const sourceString = `${method}${uri}${rawBody}${timestamp}`;
  const expected = crypto.createHmac("sha256", clientSecret).update(sourceString).digest("base64");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature ?? "");
  const valid = expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

  return valid ? { valid: true } : { valid: false, reason: "Signature mismatch" };
}
