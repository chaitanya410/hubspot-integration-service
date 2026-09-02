import type { HubSpotCrmObject } from "./types";

/**
 * Pure mapping functions: raw HubSpot CRM object -> our local Prisma
 * upsert shape. Kept dependency-free (no DB, no network) so they're
 * trivial to unit test and reuse from both the /sync flow and the
 * webhook flow.
 */

export interface ContactUpsertData {
  hubspotId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  company: string | null;
  lifecycleStage: string | null;
  hubspotCreatedAt: Date;
  hubspotUpdatedAt: Date;
  archived: boolean;
  raw: string;
}

export function mapHubSpotContact(obj: HubSpotCrmObject): ContactUpsertData {
  const p = obj.properties ?? {};
  return {
    hubspotId: obj.id,
    email: p.email ?? null,
    firstName: p.firstname ?? null,
    lastName: p.lastname ?? null,
    phone: p.phone ?? null,
    company: p.company ?? null,
    lifecycleStage: p.lifecyclestage ?? null,
    hubspotCreatedAt: new Date(obj.createdAt),
    hubspotUpdatedAt: new Date(obj.updatedAt),
    archived: obj.archived ?? false,
    raw: JSON.stringify(p),
  };
}

export interface DealUpsertData {
  hubspotId: string;
  dealName: string | null;
  amount: number | null;
  dealStage: string | null;
  pipeline: string | null;
  closeDate: Date | null;
  hubspotCreatedAt: Date;
  hubspotUpdatedAt: Date;
  archived: boolean;
  raw: string;
}

export function mapHubSpotDeal(obj: HubSpotCrmObject): DealUpsertData {
  const p = obj.properties ?? {};
  const amount = p.amount ? Number(p.amount) : null;
  return {
    hubspotId: obj.id,
    dealName: p.dealname ?? null,
    amount: amount !== null && !Number.isNaN(amount) ? amount : null,
    dealStage: p.dealstage ?? null,
    pipeline: p.pipeline ?? null,
    closeDate: p.closedate ? new Date(p.closedate) : null,
    hubspotCreatedAt: new Date(obj.createdAt),
    hubspotUpdatedAt: new Date(obj.updatedAt),
    archived: obj.archived ?? false,
    raw: JSON.stringify(p),
  };
}
