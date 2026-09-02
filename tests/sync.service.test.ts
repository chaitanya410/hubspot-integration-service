import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HubSpotCrmObject } from "../src/integrations/hubspot/types";

// Mock the Prisma singleton so this test never touches a real database -
// we only assert *how* the sync service talks to Prisma.
const upsertMock = vi.fn().mockResolvedValue({});
const syncRunCreateMock = vi.fn().mockResolvedValue({ id: "run-1" });
const syncRunUpdateMock = vi.fn().mockResolvedValue({});

vi.mock("../src/db/prisma", () => ({
  prisma: {
    contact: { upsert: (...args: unknown[]) => upsertMock(...args) },
    deal: { upsert: vi.fn().mockResolvedValue({}) },
    syncRun: {
      create: (...args: unknown[]) => syncRunCreateMock(...args),
      update: (...args: unknown[]) => syncRunUpdateMock(...args),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

const sampleContact: HubSpotCrmObject = {
  id: "42",
  properties: { email: "a@b.com", firstname: "A", lastname: "B" },
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-02T00:00:00.000Z",
};

// Mock the HubSpot endpoint so no real HTTP call happens - it just hands
// one page containing our sample contact straight to the sync service.
vi.mock("../src/integrations/hubspot/endpoints", () => ({
  fetchAllContacts: async (onPage: (page: HubSpotCrmObject[]) => Promise<void>) => {
    await onPage([sampleContact]);
    return { pagesFetched: 1, recordsFetched: 1 };
  },
  fetchAllDeals: async () => ({ pagesFetched: 0, recordsFetched: 0 }),
}));

describe("runSync (contacts)", () => {
  beforeEach(() => {
    upsertMock.mockClear();
    syncRunCreateMock.mockClear();
    syncRunUpdateMock.mockClear();
  });

  it("upserts each fetched record keyed by hubspotId, not create-only", async () => {
    const { runSync } = await import("../src/modules/sync/sync.service");

    await runSync("contacts");

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.where).toEqual({ hubspotId: "42" });
    expect(call.create.email).toBe("a@b.com");
    expect(call.update.email).toBe("a@b.com");
  });

  it("stays idempotent: syncing the same page twice still upserts on the same unique key both times (no duplicate rows)", async () => {
    const { runSync } = await import("../src/modules/sync/sync.service");

    await runSync("contacts");
    await runSync("contacts");

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const [firstWhere] = upsertMock.mock.calls[0];
    const [secondWhere] = upsertMock.mock.calls[1];
    expect(firstWhere.where).toEqual(secondWhere.where); // same identity both times
  });

  it("records a SyncRun as running, then success, with the record count", async () => {
    const { runSync } = await import("../src/modules/sync/sync.service");

    await runSync("contacts");

    expect(syncRunCreateMock).toHaveBeenCalledWith({ data: { entityType: "contacts", status: "running" } });
    const updateCall = syncRunUpdateMock.mock.calls[0][0];
    expect(updateCall.data.status).toBe("success");
    expect(updateCall.data.recordsSynced).toBe(1);
  });

  it("marks the SyncRun as failed and rethrows when the upsert throws", async () => {
    upsertMock.mockRejectedValueOnce(new Error("DB is down"));
    const { runSync } = await import("../src/modules/sync/sync.service");

    await expect(runSync("contacts")).rejects.toThrow("DB is down");

    const updateCall = syncRunUpdateMock.mock.calls[0][0];
    expect(updateCall.data.status).toBe("failed");
    expect(updateCall.data.error).toContain("DB is down");
  });
});
