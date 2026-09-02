import { describe, it, expect } from "vitest";
import { mapHubSpotContact, mapHubSpotDeal } from "../src/integrations/hubspot/mappers";
import type { HubSpotCrmObject } from "../src/integrations/hubspot/types";

describe("mapHubSpotContact", () => {
  it("maps a full HubSpot contact object to our local shape", () => {
    const raw: HubSpotCrmObject = {
      id: "12345",
      properties: {
        email: "jane@example.com",
        firstname: "Jane",
        lastname: "Doe",
        phone: "+1-555-0100",
        company: "Acme Inc",
        lifecyclestage: "lead",
      },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
      archived: false,
    };

    const mapped = mapHubSpotContact(raw);

    expect(mapped.hubspotId).toBe("12345");
    expect(mapped.email).toBe("jane@example.com");
    expect(mapped.firstName).toBe("Jane");
    expect(mapped.lastName).toBe("Doe");
    expect(mapped.company).toBe("Acme Inc");
    expect(mapped.lifecycleStage).toBe("lead");
    expect(mapped.archived).toBe(false);
    expect(mapped.hubspotCreatedAt).toEqual(new Date("2024-01-01T00:00:00.000Z"));
    expect(JSON.parse(mapped.raw)).toEqual(raw.properties);
  });

  it("fills missing/null properties with null instead of throwing", () => {
    const raw: HubSpotCrmObject = {
      id: "999",
      properties: { email: null },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    const mapped = mapHubSpotContact(raw);

    expect(mapped.email).toBeNull();
    expect(mapped.firstName).toBeNull();
    expect(mapped.company).toBeNull();
  });
});

describe("mapHubSpotDeal", () => {
  it("maps a full HubSpot deal object and parses amount to a number", () => {
    const raw: HubSpotCrmObject = {
      id: "555",
      properties: {
        dealname: "Big Deal",
        amount: "15000.50",
        dealstage: "closedwon",
        pipeline: "default",
        closedate: "2024-03-15T00:00:00.000Z",
      },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-02-01T00:00:00.000Z",
    };

    const mapped = mapHubSpotDeal(raw);

    expect(mapped.dealName).toBe("Big Deal");
    expect(mapped.amount).toBe(15000.5);
    expect(mapped.dealStage).toBe("closedwon");
    expect(mapped.closeDate).toEqual(new Date("2024-03-15T00:00:00.000Z"));
  });

  it("maps a missing or non-numeric amount to null rather than NaN", () => {
    const withMissingAmount: HubSpotCrmObject = {
      id: "556",
      properties: { dealname: "No Amount Deal" },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const withBadAmount: HubSpotCrmObject = {
      id: "557",
      properties: { dealname: "Bad Amount Deal", amount: "not-a-number" },
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    expect(mapHubSpotDeal(withMissingAmount).amount).toBeNull();
    expect(mapHubSpotDeal(withBadAmount).amount).toBeNull();
  });
});
