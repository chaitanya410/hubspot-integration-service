import { hubspotClient } from "./client";
import type { HubSpotCrmObject, HubSpotListResponse } from "./types";

const CONTACT_PROPERTIES = ["email", "firstname", "lastname", "phone", "company", "lifecyclestage"];
const DEAL_PROPERTIES = ["dealname", "amount", "dealstage", "pipeline", "closedate"];

const PAGE_SIZE = 100;
/** Hard safety cap so a runaway/misbehaving pagination cursor can never
 * turn into an infinite loop against a live API. */
const MAX_PAGES = 500;

/**
 * Fetches every page of a HubSpot CRM v3 object list endpoint, following
 * the `paging.next.after` cursor until it's exhausted, and streams pages
 * out via `onPage` so the caller (sync service) can upsert incrementally
 * instead of holding the whole dataset in memory.
 */
async function fetchAllPages(
  label: string,
  path: string,
  properties: string[],
  onPage: (page: HubSpotCrmObject[]) => Promise<void>,
): Promise<{ pagesFetched: number; recordsFetched: number }> {
  let after: string | undefined;
  let pagesFetched = 0;
  let recordsFetched = 0;

  do {
    const data = await hubspotClient.get<HubSpotListResponse<HubSpotCrmObject>>(label, path, {
      limit: PAGE_SIZE,
      properties: properties.join(","),
      archived: false,
      ...(after ? { after } : {}),
    });

    await onPage(data.results);
    pagesFetched += 1;
    recordsFetched += data.results.length;
    after = data.paging?.next?.after;
  } while (after && pagesFetched < MAX_PAGES);

  return { pagesFetched, recordsFetched };
}

export function fetchAllContacts(onPage: (page: HubSpotCrmObject[]) => Promise<void>) {
  return fetchAllPages("hubspot.contacts.list", "/crm/v3/objects/contacts", CONTACT_PROPERTIES, onPage);
}

export function fetchAllDeals(onPage: (page: HubSpotCrmObject[]) => Promise<void>) {
  return fetchAllPages("hubspot.deals.list", "/crm/v3/objects/deals", DEAL_PROPERTIES, onPage);
}

export function fetchContactById(id: string) {
  return hubspotClient.get<HubSpotCrmObject>("hubspot.contacts.get", `/crm/v3/objects/contacts/${id}`, {
    properties: CONTACT_PROPERTIES.join(","),
  });
}

export function fetchDealById(id: string) {
  return hubspotClient.get<HubSpotCrmObject>("hubspot.deals.get", `/crm/v3/objects/deals/${id}`, {
    properties: DEAL_PROPERTIES.join(","),
  });
}
