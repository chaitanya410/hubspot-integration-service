/**
 * Dev helper: sends a correctly HMAC-signed sample webhook event to a
 * locally running instance of this service, so you can see the full
 * signature-verification + processing path work end-to-end without
 * waiting for a real HubSpot event.
 *
 * Usage:
 *   npm run test:webhook                     # sends a contact.propertyChange sample
 *   npm run test:webhook -- --type=deal.creation --objectId=123
 *
 * Requires the server to be running locally (npm run dev) and BASE_URL /
 * HUBSPOT_CLIENT_SECRET in .env to match what the server is using.
 */
import "dotenv/config";
import crypto from "crypto";
import axios from "axios";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? "true"];
  }),
);

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET;
const path = "/webhooks/hubspot";

async function main() {
  if (!CLIENT_SECRET) {
    console.error("❌ HUBSPOT_CLIENT_SECRET is not set in .env");
    process.exit(1);
  }

  const subscriptionType = args.type ?? "contact.propertyChange";
  const objectId = Number(args.objectId ?? 12345);

  const body = JSON.stringify([
    {
      eventId: Date.now(),
      subscriptionType,
      objectId,
      occurredAt: Date.now(),
      changeSource: "CRM",
      ...(subscriptionType.endsWith("propertyChange")
        ? { propertyName: subscriptionType.startsWith("deal") ? "dealstage" : "lifecyclestage", propertyValue: "updated-by-test-script" }
        : {}),
    },
  ]);

  const timestamp = String(Date.now());
  const uri = `${BASE_URL}${path}`;
  const signature = crypto
    .createHmac("sha256", CLIENT_SECRET)
    .update(`POST${uri}${body}${timestamp}`)
    .digest("base64");

  console.log(`→ POST ${uri}`);
  console.log(`  payload: ${body}`);

  const res = await axios.post(uri, JSON.parse(body), {
    headers: {
      "Content-Type": "application/json",
      "X-HubSpot-Signature-v3": signature,
      "X-HubSpot-Request-Timestamp": timestamp,
    },
    validateStatus: () => true,
  });

  console.log(`← ${res.status}`, JSON.stringify(res.data, null, 2));
}

main().catch((err) => {
  console.error("Failed to send test webhook:", err.message);
  process.exit(1);
});
