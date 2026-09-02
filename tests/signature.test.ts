import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyHubSpotSignature } from "../src/integrations/hubspot/signature";

const CLIENT_SECRET = "test-client-secret";

function sign(method: string, uri: string, rawBody: string, timestamp: string) {
  return crypto
    .createHmac("sha256", CLIENT_SECRET)
    .update(`${method}${uri}${rawBody}${timestamp}`)
    .digest("base64");
}

describe("verifyHubSpotSignature", () => {
  it("accepts a correctly signed, fresh request", () => {
    const method = "POST";
    const uri = "https://example.com/webhooks/hubspot";
    const rawBody = JSON.stringify([{ eventId: 1 }]);
    const timestamp = String(Date.now());
    const signature = sign(method, uri, rawBody, timestamp);

    const result = verifyHubSpotSignature({ method, uri, rawBody, timestamp, signature, clientSecret: CLIENT_SECRET });

    expect(result.valid).toBe(true);
  });

  it("rejects a request whose body was tampered with after signing", () => {
    const method = "POST";
    const uri = "https://example.com/webhooks/hubspot";
    const timestamp = String(Date.now());
    const signature = sign(method, uri, JSON.stringify([{ eventId: 1 }]), timestamp);

    // Attacker/proxy modifies the body but reuses the original signature.
    const tamperedBody = JSON.stringify([{ eventId: 1, injected: true }]);

    const result = verifyHubSpotSignature({
      method,
      uri,
      rawBody: tamperedBody,
      timestamp,
      signature,
      clientSecret: CLIENT_SECRET,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it("rejects a request signed with the wrong client secret", () => {
    const method = "POST";
    const uri = "https://example.com/webhooks/hubspot";
    const rawBody = JSON.stringify([{ eventId: 1 }]);
    const timestamp = String(Date.now());
    const signature = crypto
      .createHmac("sha256", "someone-elses-secret")
      .update(`${method}${uri}${rawBody}${timestamp}`)
      .digest("base64");

    const result = verifyHubSpotSignature({ method, uri, rawBody, timestamp, signature, clientSecret: CLIENT_SECRET });

    expect(result.valid).toBe(false);
  });

  it("rejects a stale request outside the replay window, even with a valid signature", () => {
    const method = "POST";
    const uri = "https://example.com/webhooks/hubspot";
    const rawBody = JSON.stringify([{ eventId: 1 }]);
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000); // 10 minutes old
    const signature = sign(method, uri, rawBody, staleTimestamp);

    const result = verifyHubSpotSignature({
      method,
      uri,
      rawBody,
      timestamp: staleTimestamp,
      signature,
      clientSecret: CLIENT_SECRET,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/timestamp/i);
  });
});
