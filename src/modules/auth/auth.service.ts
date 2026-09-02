import axios from "axios";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { AuthError } from "../../lib/errors";
import { HubSpotTokenInfoSchema, HubSpotTokenResponseSchema, type HubSpotTokenResponse } from "../../integrations/hubspot/types";

const TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";
const TOKEN_INFO_URL = "https://api.hubapi.com/oauth/v1/access-tokens";
const AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";

/** Refresh proactively when the token has less than this much life left. */
const EXPIRY_BUFFER_MS = 60_000;

export function buildAuthorizeUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: env.HUBSPOT_CLIENT_ID,
    redirect_uri: env.HUBSPOT_REDIRECT_URI,
    scope: env.HUBSPOT_SCOPES,
  });
  if (state) params.set("state", state);
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/** Exchanges an OAuth `code` (from the callback redirect) for tokens, then
 * persists (or updates) the Account row for that HubSpot portal. */
export async function exchangeCodeForTokens(code: string) {
  const tokenRes = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.HUBSPOT_CLIENT_ID,
      client_secret: env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: env.HUBSPOT_REDIRECT_URI,
      code,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  const tokens = HubSpotTokenResponseSchema.parse(tokenRes.data);
  return persistTokens(tokens);
}

async function refreshTokens(refreshToken: string) {
  const tokenRes = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.HUBSPOT_CLIENT_ID,
      client_secret: env.HUBSPOT_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

  const tokens = HubSpotTokenResponseSchema.parse(tokenRes.data);
  return persistTokens(tokens);
}

async function persistTokens(tokens: HubSpotTokenResponse) {
  // Look up which portal (hub) these tokens belong to so we can upsert
  // the right Account row instead of always creating a new one.
  const infoRes = await axios.get(`${TOKEN_INFO_URL}/${tokens.access_token}`);
  const info = HubSpotTokenInfoSchema.parse(infoRes.data);

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  const account = await prisma.account.upsert({
    where: { hubId: info.hub_id },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scopes: (info.scopes ?? []).join(" "),
    },
    create: {
      hubId: info.hub_id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scopes: (info.scopes ?? []).join(" "),
    },
  });

  logger.info({ hubId: info.hub_id }, "HubSpot account connected/refreshed");
  return account;
}

/**
 * Returns a currently-valid access token for the (single) connected
 * account, refreshing it first if it's expired or about to expire.
 * Throws AuthError if no account has ever been connected.
 */
export async function getValidAccessToken(): Promise<string> {
  const account = await prisma.account.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!account) {
    throw new AuthError("No HubSpot account connected yet. Visit GET /auth/hubspot/install first.");
  }

  const willExpireSoon = account.expiresAt.getTime() - Date.now() < EXPIRY_BUFFER_MS;
  if (!willExpireSoon) {
    return account.accessToken;
  }

  logger.info({ hubId: account.hubId }, "Access token expiring soon, refreshing");
  const refreshed = await refreshTokens(account.refreshToken);
  return refreshed.accessToken;
}

export async function getConnectionStatus() {
  const account = await prisma.account.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!account) return { connected: false as const };
  return {
    connected: true as const,
    hubId: account.hubId,
    scopes: account.scopes.split(" ").filter(Boolean),
    expiresAt: account.expiresAt,
    connectedAt: account.createdAt,
  };
}
