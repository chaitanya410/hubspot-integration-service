import "dotenv/config";
import { z } from "zod";

/**
 * All environment variables are validated once at boot. If something
 * required is missing/malformed, we fail fast with a readable error
 * instead of crashing later mid-request.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  HUBSPOT_CLIENT_ID: z.string().min(1, "HUBSPOT_CLIENT_ID is required"),
  HUBSPOT_CLIENT_SECRET: z.string().min(1, "HUBSPOT_CLIENT_SECRET is required"),
  HUBSPOT_REDIRECT_URI: z.string().url(),
  HUBSPOT_SCOPES: z.string().default("crm.objects.contacts.read crm.objects.deals.read"),

  HUBSPOT_DEVELOPER_API_KEY: z.string().optional(),
  HUBSPOT_APP_ID: z.string().optional(),
  WEBHOOK_TARGET_URL: z.string().url().optional(),

  ENABLE_SCHEDULED_SYNC: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),

  LOG_LEVEL: z.string().default("info"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;
