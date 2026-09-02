import { z } from "zod";

/** Response shape from HubSpot's OAuth token endpoint (both the initial
 * authorization_code exchange and subsequent refresh_token grants). */
export const HubSpotTokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(), // seconds
  token_type: z.string().optional(),
});
export type HubSpotTokenResponse = z.infer<typeof HubSpotTokenResponseSchema>;

/** Response from GET /oauth/v1/access-tokens/{token} - used to discover
 * which HubSpot portal (hub) we just got authorized for. */
export const HubSpotTokenInfoSchema = z.object({
  hub_id: z.number(),
  user: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});
export type HubSpotTokenInfo = z.infer<typeof HubSpotTokenInfoSchema>;

/** A single CRM object (contact/deal) as returned by the v3 Objects API. */
export interface HubSpotCrmObject {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

/** Paginated list response shared by all v3 CRM object list endpoints. */
export interface HubSpotListResponse<T> {
  results: T[];
  paging?: {
    next?: {
      after: string;
      link?: string;
    };
  };
}

/** One event in a HubSpot webhook delivery (HubSpot POSTs an array of these). */
export const HubSpotWebhookEventSchema = z.object({
  eventId: z.number(),
  subscriptionId: z.number().optional(),
  portalId: z.number().optional(),
  appId: z.number().optional(),
  occurredAt: z.number().optional(), // epoch ms
  subscriptionType: z.string(),
  attemptNumber: z.number().optional(),
  objectId: z.number(),
  changeSource: z.string().optional(),
  changeFlag: z.string().optional(),
  propertyName: z.string().optional(),
  propertyValue: z.string().nullable().optional(),
});
export type HubSpotWebhookEvent = z.infer<typeof HubSpotWebhookEventSchema>;

export const HubSpotWebhookPayloadSchema = z.array(HubSpotWebhookEventSchema);
