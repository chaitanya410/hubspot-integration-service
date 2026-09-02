/**
 * Registers this service's webhook endpoint with HubSpot programmatically,
 * via the Webhooks Management API v3, satisfying "Register a webhook
 * subscription with the provider" in code rather than only via the UI.
 *
 * This uses your app's *developer API key* (Developer Account > Apps >
 * your app > Auth > "Manage your developer API key"), NOT the OAuth
 * access token of an installed account - webhook subscriptions are
 * configured once per app, not per installation.
 *
 * Usage:
 *   npm run register-webhook
 *
 * Requires in .env: HUBSPOT_APP_ID, HUBSPOT_DEVELOPER_API_KEY, WEBHOOK_TARGET_URL
 *
 * Equivalent manual path (no code): HubSpot developer account > your app >
 * "Webhooks" tab > set target URL + subscribe to the same event types below.
 */
import "dotenv/config";
import axios from "axios";

const APP_ID = process.env.HUBSPOT_APP_ID;
const DEV_API_KEY = process.env.HUBSPOT_DEVELOPER_API_KEY;
const TARGET_URL = process.env.WEBHOOK_TARGET_URL;

const CONTACT_PROPERTIES = ["email", "firstname", "lastname", "phone", "company", "lifecyclestage"];
const DEAL_PROPERTIES = ["dealname", "amount", "dealstage", "pipeline", "closedate"];

async function main() {
  if (!APP_ID || !DEV_API_KEY || !TARGET_URL) {
    console.error("❌ Missing HUBSPOT_APP_ID, HUBSPOT_DEVELOPER_API_KEY, or WEBHOOK_TARGET_URL in .env");
    process.exit(1);
  }

  const base = `https://api.hubapi.com/webhooks/v3/${APP_ID}`;
  const auth = { params: { hapikey: DEV_API_KEY } };

  console.log(`→ Setting webhook target URL to ${TARGET_URL}`);
  await axios.put(`${base}/settings`, { targetUrl: TARGET_URL, maxConcurrentRequests: 5 }, auth);

  const subscriptions = [
    { eventType: "contact.creation" },
    { eventType: "contact.deletion" },
    ...CONTACT_PROPERTIES.map((propertyName) => ({ eventType: "contact.propertyChange", propertyName })),
    { eventType: "deal.creation" },
    { eventType: "deal.deletion" },
    ...DEAL_PROPERTIES.map((propertyName) => ({ eventType: "deal.propertyChange", propertyName })),
  ];

  for (const sub of subscriptions) {
    try {
      const res = await axios.post(`${base}/subscriptions`, { ...sub, active: true }, auth);
      console.log(`✔ Subscribed: ${sub.eventType}${"propertyName" in sub ? ` (${sub.propertyName})` : ""} -> id ${res.data.id}`);
    } catch (err: any) {
      console.error(`✘ Failed to subscribe to ${sub.eventType}:`, err.response?.data ?? err.message);
    }
  }

  console.log("\nDone. Verify in your HubSpot developer account under your app's Webhooks tab.");
}

main().catch((err) => {
  console.error("Fatal error registering webhooks:", err.response?.data ?? err);
  process.exit(1);
});
