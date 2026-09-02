import { Router } from "express";
import { buildAuthorizeUrl, exchangeCodeForTokens, getConnectionStatus } from "./auth.service";
import { ValidationError } from "../../lib/errors";

export const authRouter = Router();

/** Kicks off the OAuth2 install flow by redirecting to HubSpot's consent screen. */
authRouter.get("/hubspot/install", (req, res) => {
  const url = buildAuthorizeUrl();
  res.redirect(url);
});

/** OAuth2 redirect target: exchanges the `code` for tokens and stores them. */
authRouter.get("/hubspot/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    throw new ValidationError(`HubSpot OAuth error: ${error} - ${error_description ?? ""}`);
  }
  if (!code || typeof code !== "string") {
    throw new ValidationError("Missing `code` query parameter from HubSpot redirect");
  }

  const account = await exchangeCodeForTokens(code);
  res.json({
    message: "HubSpot account connected successfully.",
    hubId: account.hubId,
    scopes: account.scopes.split(" "),
    nextSteps: ["POST /sync/contacts", "POST /sync/deals", "GET /contacts", "GET /deals"],
  });
});

/** Simple status check: is an account connected, and when does its token expire. */
authRouter.get("/hubspot/status", async (req, res) => {
  res.json(await getConnectionStatus());
});
