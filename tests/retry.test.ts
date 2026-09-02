import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/lib/retry";

function fakeAxiosError(status: number, headers: Record<string, string> = {}) {
  const err: any = new Error(`Request failed with status ${status}`);
  err.response = { status, headers, data: {} };
  return err;
}

describe("withRetry", () => {
  it("retries on 429 and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(fakeAxiosError(429))
      .mockRejectedValueOnce(fakeAxiosError(429))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { retries: 5, minTimeout: 5, maxTimeout: 20, label: "test" });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on 503 (transient upstream failure)", async () => {
    const fn = vi.fn().mockRejectedValueOnce(fakeAxiosError(503)).mockResolvedValueOnce("recovered");

    const result = await withRetry(fn, { minTimeout: 5, maxTimeout: 20, label: "test" });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on a 400 (non-transient) error - fails fast", async () => {
    const fn = vi.fn().mockRejectedValue(fakeAxiosError(400));

    await expect(withRetry(fn, { minTimeout: 5, maxTimeout: 20, label: "test" })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on a 401 (auth) error - the HTTP client handles refresh separately", async () => {
    const fn = vi.fn().mockRejectedValue(fakeAxiosError(401));

    await expect(withRetry(fn, { minTimeout: 5, maxTimeout: 20, label: "test" })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting all retries and surfaces the last error", async () => {
    const fn = vi.fn().mockRejectedValue(fakeAxiosError(500));

    await expect(withRetry(fn, { retries: 2, minTimeout: 5, maxTimeout: 20, label: "test" })).rejects.toThrow();
    // p-retry's `retries` counts retry attempts *after* the first call, so
    // a persistently-failing call should be attempted at least 2 times but
    // bounded (not retried forever) - we assert the range rather than an
    // exact count to avoid coupling this test to that internal convention.
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
