# HubSpot Integration Service

A standalone backend microservice that authenticates with **HubSpot CRM** via OAuth2,
syncs **Contacts** and **Deals** into a local database, receives and validates
**HubSpot webhooks** for near-real-time updates, and exposes a clean, filterable
local REST API — built for the Central AI Backend / Integration Engineer take-home.

Built with **Node.js + TypeScript**, Express, Prisma, and Zod.

> 🚀 **Live**: [https://hubspot-integration-service.vercel.app](https://hubspot-integration-service.vercel.app)
> (try `GET /health`, `GET /contacts`, `GET /deals` — no auth needed to read;
> it's actively connected to a real HubSpot account and synced with real
> data). Deployed on Vercel with a Postgres database — see
> [Deployment](#deployment) for how.

> 📄 This README covers setup, architecture, API reference, reliability design,
> and trade-offs. If you're reviewing this for the Central AI assignment, the
> [Design decisions & trade-offs](#design-decisions--trade-offs) section is a
> good place to see the reasoning behind the choices below.

---

## Table of contents

- [Why HubSpot](#why-hubspot)
- [What this service does](#what-this-service-does)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Setup](#setup)
- [Connecting a HubSpot account (OAuth2)](#connecting-a-hubspot-account-oauth2)
- [Running a sync](#running-a-sync)
- [Local REST API reference](#local-rest-api-reference)
- [Webhooks](#webhooks)
- [Reliability & error handling](#reliability--error-handling)
- [Database schema](#database-schema)
- [Background sync (bonus)](#background-sync-bonus)
- [Testing](#testing)
- [Docker](#docker)
- [Deployment](#deployment)
- [Design decisions & trade-offs](#design-decisions--trade-offs)
- [Known limitations & possible next steps](#known-limitations--possible-next-steps)

---

## Why HubSpot

Central AI's brief lists Pipedrive, Salesforce, Calendly, HubSpot, and Slack as
example integrations. HubSpot was chosen because it lets the *integration* be
the focus rather than account provisioning friction:

- A **free developer account + CRM test account** with no trial expiry.
- A real, standard **OAuth2 authorization-code flow** with refresh tokens.
- A genuine **webhook subscription system** (HubSpot's Webhooks API v3) with
  HMAC request signing — no domain-ownership verification required to receive
  events (unlike e.g. Google Calendar push notifications).
- Two directly relevant CRM objects — **Contacts** and **Deals** — with
  cursor-based pagination and documented rate limits, so the assignment's
  pagination/rate-limit/idempotency requirements are all exercised for real.

## What this service does

- ✅ **Authenticates** with HubSpot via OAuth2 (`GET /auth/hubspot/install` → HubSpot
  consent screen → `GET /auth/hubspot/callback`), storing tokens in the local DB.
- ✅ **Refreshes access tokens automatically** before they expire (with a 60s buffer),
  plus a reactive one-time refresh-and-retry if HubSpot ever returns `401` mid-flight.
- ✅ **Syncs Contacts and Deals** (`POST /sync/contacts`, `POST /sync/deals`, `POST /sync`)
  with full cursor pagination, upserted idempotently by HubSpot object id.
- ✅ **Receives and validates HubSpot webhooks** (`POST /webhooks/hubspot`) using the
  real `X-HubSpot-Signature-v3` HMAC algorithm, with replay protection, event
  persistence, and per-event retry.
- ✅ **Exposes a local REST API** (`GET /contacts`, `GET /deals`) with filtering,
  sorting, and pagination — served entirely from the local DB, so it stays fast
  and available even if HubSpot itself is down.
- ✅ **Handles errors and rate limits gracefully**: exponential backoff + jitter on
  `429`/`5xx`, `Retry-After` support, structured JSON logs, consistent error responses.
- ✅ Bonus: OAuth2 refresh flow, webhook signature validation, an optional background
  sync job, Docker/Docker Compose, a unit test suite, and deploy-ready structure.

> **Verified live, not just unit-tested:** every piece above was exercised
> against a real HubSpot developer account — the OAuth2 install flow, a
> paginated sync of HubSpot's seeded sample contacts, and a real webhook
> delivery triggered by editing a contact in HubSpot's UI, HMAC-verified and
> reflected in the database within seconds. All of it is now running
> permanently on the live deployment linked above — not a one-off local
> test. See [Webhooks](#webhooks) and [Deployment](#deployment) for details.

## Architecture

```mermaid
flowchart LR
    subgraph Client["Your app / Postman / curl"]
    end

    subgraph Service["hubspot-integration-service"]
        Routes["Routes\nauth · sync · contacts · deals · webhooks"]
        Services["Service layer\nauth.service · sync.service · webhook.service"]
        HubClient["HubSpot client\nauth header + retry/backoff"]
        DB[(PostgreSQL via Prisma)]
    end

    HubSpot["HubSpot CRM API\n(OAuth2, CRM Objects v3, Webhooks v3)"]

    Client -- "REST calls" --> Routes
    Routes --> Services
    Services --> HubClient
    Services --> DB
    HubClient <-- "REST + OAuth2" --> HubSpot
    HubSpot -- "webhook events" --> Routes
```

**Layering**, enforced by directory structure (see below):

- **`routes`** — thin Express handlers: parse/validate input, call a service, shape the response. No business logic, no direct Prisma or axios calls.
- **`modules/*/*.service.ts`** — business logic: orchestrates HubSpot calls + DB writes, owns transactions and idempotency rules.
- **`integrations/hubspot`** — everything HubSpot-specific: the authenticated/retrying HTTP client, endpoint wrappers, pure request→local-shape mappers, and webhook signature verification. This is the only part of the codebase that would change if HubSpot's API changed shape.
- **`db/prisma.ts`** — a single shared Prisma client instance.
- **`lib`** — cross-cutting, dependency-free utilities (retry/backoff, error classes, logger, pagination parsing) that are unit-tested in isolation.

## Project structure

```
hubspot-integration-service/
├── src/
│   ├── config/env.ts               # zod-validated environment config
│   ├── db/prisma.ts                # shared PrismaClient singleton
│   ├── lib/                        # logger, retry/backoff, error classes, pagination
│   ├── middleware/                 # error handler, raw-body capture for webhook signing
│   ├── integrations/hubspot/       # client, endpoints, mappers, types, signature verification
│   ├── modules/
│   │   ├── auth/                   # OAuth2 install/callback/status + token refresh
│   │   ├── sync/                   # POST /sync* + sync run history
│   │   ├── contacts/               # GET /contacts (local DB)
│   │   ├── deals/                  # GET /deals (local DB)
│   │   └── webhooks/               # POST /webhooks/hubspot + event log + retry
│   ├── jobs/scheduledSync.ts       # optional background sync (bonus)
│   ├── app.ts                      # Express app assembly
│   └── server.ts                   # entrypoint, graceful shutdown
├── prisma/schema.prisma            # Account, Contact, Deal, WebhookEvent, SyncRun
├── scripts/
│   ├── register-webhook.ts         # registers the webhook subscription via HubSpot's API
│   └── send-test-webhook.ts        # sends a correctly-signed sample webhook locally
├── tests/                          # vitest unit tests (retry, mappers, signature, sync idempotency, pagination)
├── requests.http                   # ready-to-run example requests
├── Dockerfile / docker-compose.yml
└── README.md
```

## Setup

### Prerequisites

- Node.js 18+ and npm
- A free [HubSpot developer account](https://developers.hubspot.com/) (this
  also gives you a free CRM **test account** pre-loaded with sample contacts
  and deals — perfect for this project, no separate signup needed)

### 1. Create a HubSpot app

Create a free [HubSpot developer account](https://developers.hubspot.com/) if
you don't have one — during signup it will also ask for a "company website";
any real root domain you control works (e.g. `https://github.com`), it's
just onboarding personalization and has no bearing on the app itself.

> **Heads up:** as of the current HubSpot developer console, creating a new
> OAuth ("public") app through the classic UI is disabled — HubSpot now
> requires new OAuth apps to be created via their CLI. The
> [`hubspot-app/`](hubspot-app/) folder in this repo is a ready-to-deploy
> project with the exact OAuth + webhook config this service expects, so you
> don't have to figure out the schema from scratch:
>
> ```bash
> npm install -g @hubspot/cli
>
> # In HubSpot: Development > Keys > Personal Access Key > Generate,
> # then use it to authenticate the CLI (no browser flow needed):
> hs account auth --pak <your-personal-access-key> --account <your-hub-id> --name my-hub --default
>
> cd hubspot-app
> hs project upload   # builds + deploys, creating the app in your account
> ```
>
> Then in HubSpot: **Development → Projects → central-ai-integration →
> central_ai_integration_app → Auth tab** — copy the **Client ID** and
> **Client secret** shown there. The redirect URL
> (`http://localhost:3000/auth/hubspot/callback`) and scopes
> (`crm.objects.contacts.read/write`, `crm.objects.deals.read/write`) are
> already configured in [`hubspot-app/src/app/app-hsmeta.json`](hubspot-app/src/app/app-hsmeta.json).
> See [`hubspot-app/README.md`](hubspot-app/README.md) for details, including
> activating live webhook delivery.
>
> If your account instead shows a working classic **Apps → Create app** UI,
> that works too — set the same redirect URL and scopes there and skip the
> CLI.

### 2. Install and configure

```bash
git clone <your-fork-url>
cd hubspot-integration-service
npm install                # also runs `prisma generate` via postinstall
cp .env.example .env
```

Fill in `.env`:

| Variable | Description |
|---|---|
| `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` | From your app's Auth tab |
| `HUBSPOT_REDIRECT_URI` | Must exactly match the app's configured Redirect URL |
| `HUBSPOT_SCOPES` | Space-separated scopes requested at install |
| `BASE_URL` | Where this service is reachable (`http://localhost:3000` locally) |
| `DATABASE_URL` | A PostgreSQL connection string — see step 3 for the fastest way to get one locally |
| `HUBSPOT_DEVELOPER_API_KEY`, `HUBSPOT_APP_ID`, `WEBHOOK_TARGET_URL` | Only needed for `npm run register-webhook` — see [Webhooks](#webhooks) |
| `ENABLE_SCHEDULED_SYNC`, `SYNC_INTERVAL_MINUTES` | Optional background sync — see [Background sync](#background-sync-bonus) |

### 3. Set up the database and run

Needs a PostgreSQL database. Easiest local option — spin one up with Docker
Compose (no local Postgres install needed):

```bash
docker compose up -d db
# then in .env: DATABASE_URL="postgresql://hubspot:hubspot@localhost:5432/hubspot_integration?schema=public"
```

Any other Postgres works too (a free [Neon](https://neon.tech) database, a
local install, etc.) — just put its connection string in `DATABASE_URL`.

```bash
npm run prisma:migrate      # applies the schema
npm run dev                 # starts on http://localhost:3000 with auto-reload
```

Verify it's up:

```bash
curl http://localhost:3000/health
# {"status":"ok","db":"connected","uptimeSeconds":...}
```

## Connecting a HubSpot account (OAuth2)

1. Open **`http://localhost:3000/auth/hubspot/install`** in a browser.
2. You're redirected to HubSpot's consent screen — choose your test account and approve.
3. HubSpot redirects back to `/auth/hubspot/callback`, which exchanges the
   `code` for an access + refresh token, looks up the portal (hub) id, and
   upserts an `Account` row.
4. You'll see a JSON confirmation. Check status anytime with:

```bash
curl http://localhost:3000/auth/hubspot/status
# {"connected":true,"hubId":12345678,"scopes":[...],"expiresAt":"...","connectedAt":"..."}
```

Access tokens expire after ~30 minutes; every HubSpot API call proactively
refreshes the token first if it's within 60 seconds of expiring (see
[`auth.service.ts`](src/modules/auth/auth.service.ts)), and a `401` mid-request
triggers one forced refresh-and-retry as a fallback (see
[`integrations/hubspot/client.ts`](src/integrations/hubspot/client.ts)).

## Running a sync

```bash
curl -X POST http://localhost:3000/sync/contacts
curl -X POST http://localhost:3000/sync/deals
# or both:
curl -X POST http://localhost:3000/sync
```

Each call paginates through **all** matching HubSpot records (100 per page,
following the `paging.next.after` cursor) and **upserts** them locally keyed
by `hubspotId` — running it again never creates duplicates, it just refreshes
existing rows. Progress and outcomes are recorded as a `SyncRun`:

```bash
curl http://localhost:3000/sync/runs
```

```json
[{
  "id": "…", "entityType": "contacts", "status": "success",
  "recordsSynced": 214, "pagesFetched": 3,
  "startedAt": "...", "finishedAt": "...", "error": null
}]
```

## Local REST API reference

All of these read **only** from the local database (populated by `/sync` or
webhooks) — they never call HubSpot directly, so they stay fast and available
even if HubSpot is rate-limiting or down.

### `GET /contacts`

| Query param | Description |
|---|---|
| `email` | Substring match on email |
| `company` | Substring match on company |
| `lifecycleStage` | Exact match |
| `sort` | `field:asc\|desc`, e.g. `updatedAt:desc` (allowed: `createdAt`, `updatedAt`, `email`, `lastName`, `hubspotUpdatedAt`) |
| `page`, `pageSize` | Pagination (`pageSize` max 100) |

```bash
curl "http://localhost:3000/contacts?lifecycleStage=lead&sort=updatedAt:desc&page=1&pageSize=25"
```

```json
{ "items": [ /* ... */ ], "page": 1, "pageSize": 25, "total": 42, "totalPages": 2 }
```

`GET /contacts/:id` returns one contact by local id (404 if not found).

### `GET /deals`

| Query param | Description |
|---|---|
| `stage` | Exact match on deal stage |
| `pipeline` | Exact match on pipeline |
| `minAmount`, `maxAmount` | Numeric range filter on amount |
| `sort` | `field:asc\|desc` (allowed: `createdAt`, `updatedAt`, `amount`, `closeDate`, `hubspotUpdatedAt`) |
| `page`, `pageSize` | Pagination |

```bash
curl "http://localhost:3000/deals?stage=closedwon&minAmount=1000&sort=amount:desc"
```

`GET /deals/:id` returns one deal by local id (404 if not found).

More ready-to-run examples (including auth and webhooks) are in
[`requests.http`](requests.http).

## Webhooks

HubSpot POSTs a **batch (array) of events** to a single URL for every
subscription type you're subscribed to. This service listens on:

```
POST /webhooks/hubspot
```

### How events are processed

1. **Signature verification first, always.** HubSpot signs
   `method + uri + rawBody + timestamp` with HMAC-SHA256 using your app's
   client secret, sent as `X-HubSpot-Signature-v3` /
   `X-HubSpot-Request-Timestamp`. We recompute it against the *exact raw
   request bytes* (captured via a `verify` hook on the JSON body parser —
   re-serializing parsed JSON isn't guaranteed byte-identical, which would
   make signature checks flaky) and reject anything with a missing/mismatched
   signature or a timestamp older than 5 minutes (replay protection). See
   [`integrations/hubspot/signature.ts`](src/integrations/hubspot/signature.ts).
2. **Persist before processing.** Every event is stored in `WebhookEvent`
   (unique on `eventId`, so a HubSpot retry of the same delivery is a no-op)
   *before* we try to act on it — an event is never silently lost even if
   processing throws.
3. **Process.** The webhook payload only carries the *changed property*, not
   the full object, so `contact.*` / `deal.*` events re-fetch the current
   object from HubSpot and upsert it locally (same idempotent upsert path as
   `/sync`); `*.deletion` events mark the local row `archived`.
4. **Always `200` once persisted.** So HubSpot's own retry policy doesn't
   race our per-event error handling. A per-event failure (e.g. HubSpot
   temporarily unreachable) is recorded on that event's `processingError`
   and can be replayed with:

```bash
curl -X POST http://localhost:3000/webhooks/events/<id>/retry
```

Recent deliveries: `GET /webhooks/events`.

### Registering the subscription with HubSpot

**Option A (recommended, what this repo actually uses) — declarative, via the
HubSpot CLI project in [`hubspot-app/`](hubspot-app/):** the subscriptions
(`contact.creation/deletion/propertyChange`, `deal.creation/deletion/propertyChange`)
and the target URL are defined in
[`hubspot-app/src/app/webhooks/webhooks-hsmeta.json`](hubspot-app/src/app/webhooks/webhooks-hsmeta.json).
Update `targetUrl` to a public HTTPS URL (a `cloudflared` tunnel locally, or your
deployed URL) and run:

```bash
cd hubspot-app
hs project upload
```

This is what registers the subscription with HubSpot — no separate script
needed once the app is deployed this way.

**Option B — script against the legacy Webhooks Management API** (kept for
reference / for an app created through the classic UI, which uses a
different, older webhooks API keyed by a developer API key rather than the
project's declarative config):

```bash
# .env needs: HUBSPOT_APP_ID, HUBSPOT_DEVELOPER_API_KEY (from
# https://app.hubspot.com/l/developer-api-key — different from your OAuth
# client secret), WEBHOOK_TARGET_URL (a publicly reachable URL, e.g. your
# cloudflared tunnel or deployed URL)
npm run register-webhook
```

This calls HubSpot's Webhooks Management API v3 to set the target URL and
subscribe to `contact.creation`, `contact.deletion`, `contact.propertyChange`
(per tracked property), and the equivalent `deal.*` events. See
[`scripts/register-webhook.ts`](scripts/register-webhook.ts).

**Option C — HubSpot UI**, only available if your account still shows a
working classic app: developer account → your app → **Webhooks** tab → set
the target URL and subscribe to the same event types manually.

> Webhooks require a **publicly reachable HTTPS URL** — `localhost` won't
> work. For local testing, use a tunnel and point `WEBHOOK_TARGET_URL` /
> the app's webhook settings at the tunnel URL. **Recommended:**
> [`cloudflared`](https://github.com/cloudflare/cloudflared) quick tunnels —
> no account needed, fast, and reliable:
> ```bash
> cloudflared tunnel --url http://localhost:3000
> ```
> This prints a `https://<random>.trycloudflare.com` URL. Set that as both
> `BASE_URL` in `.env` (critical — it's part of the signed string HubSpot's
> HMAC covers, so it must exactly match the URL HubSpot actually delivered
> to) and `targetUrl` in `hubspot-app/src/app/webhooks/webhooks-hsmeta.json`,
> then `hs project upload` to activate it.
>
> We evaluated `ngrok` and `localtunnel` too: `ngrok`'s binary got flagged
> and deleted by Windows Defender as a false positive on this machine before
> it could even run; `localtunnel`'s free relay was reachable but slow
> enough (confirmed via HubSpot's own delivery logs, which showed repeated
> `408`/timeout results) that HubSpot's webhook delivery timeout gave up
> before the request completed. `cloudflared`'s quick tunnels had neither
> problem and delivered real HubSpot events (verified by editing a live
> sample contact and watching the signed webhook arrive, get verified, and
> update the local DB within seconds).

### Testing webhook handling without waiting for HubSpot

```bash
npm run dev                                  # in one terminal
npm run test:webhook -- --type=contact.propertyChange --objectId=12345
```

[`scripts/send-test-webhook.ts`](scripts/send-test-webhook.ts) builds a
sample payload and signs it with your real `HUBSPOT_CLIENT_SECRET`, so it
exercises the **exact same signature verification path** a real HubSpot
delivery would — this isn't a bypass. (A `X-Skip-Signature-Check` header is
also honored, but only outside `NODE_ENV=production`, purely for quick
curl/Postman experiments — see `requests.http`.)

## Reliability & error handling

- **Exponential backoff with jitter** on `429` and `5xx` responses (and
  network-level failures with no response at all), via
  [`lib/retry.ts`](src/lib/retry.ts) wrapping every HubSpot call. Non-transient
  errors (4xx other than 429) are aborted immediately instead of retried.
- **`Retry-After` is honored** when HubSpot sends it on a `429`, instead of
  guessing our own delay.
- **Idempotency**: every sync/webhook write is a Prisma `upsert` keyed on
  `hubspotId` (or `eventId` for webhook dedup) — re-running a sync or
  replaying a webhook delivery never creates duplicate rows.
- **Structured JSON logs** (pino) with request correlation ids, redacting
  tokens/secrets automatically so they can never leak into logs even by
  accident.
- **Consistent error shape** across the whole API:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
  ```
  Upstream HubSpot failures are mapped to `UPSTREAM_API_ERROR` (502) rather
  than leaking raw axios/HubSpot internals to callers.
- **`SyncRun`** and **`WebhookEvent`** tables give an audit trail for both
  sync and webhook activity, so failures are debuggable rather than silent.

## Database schema

PostgreSQL via Prisma (see [`prisma/schema.prisma`](prisma/schema.prisma)):

| Model | Purpose |
|---|---|
| `Account` | One connected HubSpot portal: tokens, expiry, scopes. `hubId` unique. |
| `Contact` | Local mirror of a HubSpot contact. Indexed on `email`, `lifecycleStage`. Full raw properties kept as JSON for flexibility beyond the typed columns. |
| `Deal` | Local mirror of a HubSpot deal. Indexed on `dealStage`, `pipeline`. |
| `WebhookEvent` | Every webhook delivery received, `eventId` unique (dedup), with `processed`/`processingError` for observability and retry. |
| `SyncRun` | History of sync executions: status, record/page counts, error. |

## Background sync (bonus)

An optional interval timer (no external queue/Redis needed) re-runs
`contacts` + `deals` sync periodically:

```bash
ENABLE_SCHEDULED_SYNC=true
SYNC_INTERVAL_MINUTES=30
```

It no-ops quietly if no HubSpot account is connected yet, and logs each run.
See [`jobs/scheduledSync.ts`](src/jobs/scheduledSync.ts).

## Testing

```bash
npm test
```

24 unit tests covering the parts of the system that most need to be
provably correct, without depending on a live HubSpot account or database:

- **`retry.test.ts`** — backoff retries on `429`/`5xx`, aborts immediately on
  non-transient `4xx`/`401`, gives up after exhausting retries.
- **`mappers.test.ts`** — HubSpot → local field mapping, including null/malformed
  input handling (e.g. a non-numeric `amount`).
- **`signature.test.ts`** — webhook HMAC verification accepts a valid signature
  and rejects a tampered body, a wrong secret, and a stale (replayed) timestamp.
- **`sync.service.test.ts`** — the sync service upserts (never blind-creates)
  keyed by `hubspotId`, stays idempotent across repeated runs, and records
  `SyncRun` success/failure correctly — with HubSpot and Prisma mocked, so
  this test suite runs in under a second with zero external dependencies.
- **`pagination.test.ts`** — local API query-param parsing (page/sort validation).

## Docker

```bash
docker compose up --build
```

Runs the app plus a local PostgreSQL container together (see
[`docker-compose.yml`](docker-compose.yml)); reads HubSpot credentials from
`.env`, runs `prisma migrate deploy` automatically on container start. To run
just the image against an external Postgres instead:

```bash
docker build -t hubspot-integration-service .
docker run --env-file .env -e DATABASE_URL="postgresql://..." -p 3000:3000 hubspot-integration-service
```

## Deployment

**This service is actually deployed** at
[hubspot-integration-service.vercel.app](https://hubspot-integration-service.vercel.app)
— connected to a real HubSpot account, synced, and receiving live webhooks.
Here's exactly how, in case you're reproducing it:

### Vercel (what's live)

1. **Database**: Vercel Functions have no persistent filesystem, so this
   needed a real Postgres, not a local file. Installed the **Prisma
   Postgres** marketplace integration directly from the Vercel CLI —
   `vercel install prisma/prisma-postgres` — which provisions the database
   and wires `DATABASE_URL` into the project's env vars automatically.
2. **Serverless entrypoint**: [`api/index.ts`](api/index.ts) constructs and
   exports the same Express app used locally (`createApp()` from
   [`src/expressApp.ts`](src/expressApp.ts)) — Vercel's Node runtime accepts
   an Express app instance directly as a request handler. [`vercel.json`](vercel.json)
   rewrites every path to that one function so `/contacts`, `/webhooks/hubspot`,
   etc. all resolve correctly, not just `/api` itself.
3. **Migrations on every deploy**: `package.json`'s `vercel-build` script
   (`prisma generate && prisma migrate deploy`) runs during Vercel's build
   step, which has network access and the env vars — so the schema is
   always in sync with what's deployed, no manual step needed.
4. **Env vars**: all of `.env.example`'s HubSpot variables, set via
   `vercel env add <NAME> production --value "..."`, plus `BASE_URL` and
   `HUBSPOT_REDIRECT_URI` pointing at the real
   `https://hubspot-integration-service.vercel.app` URL.
5. **HubSpot side**: both `redirectUrls` (in
   [`hubspot-app/src/app/app-hsmeta.json`](hubspot-app/src/app/app-hsmeta.json))
   and the webhook `targetUrl` (in
   [`hubspot-app/src/app/webhooks/webhooks-hsmeta.json`](hubspot-app/src/app/webhooks/webhooks-hsmeta.json))
   were updated to the production URL and pushed with `hs project upload` —
   so webhooks now deliver to a stable, permanent endpoint instead of a
   throwaway local tunnel.

To do this yourself: `vercel link`, `vercel install prisma/prisma-postgres`,
set the env vars above, `vercel deploy --prod`.

**A snag worth knowing about**: Vercel's zero-config "Express" framework
detection scans the whole `src/` tree for an entrypoint, and it originally
collided with our explicit `api/index.ts` (it kept trying to treat
`src/app.ts` itself as a second, invalid entrypoint). Fixed by renaming that
file to `src/expressApp.ts` so the heuristic no longer matches it — cheaper
and more reliable than fighting the framework detection with more config.

### Render / Railway (alternative)

Both work fine too and are simpler if you'd rather avoid the serverless
adaptation above — deploy the Dockerfile directly, or use `npm run build` +
`npm start` as the build/start commands. Either way: set the same env vars
(with `BASE_URL`/`HUBSPOT_REDIRECT_URI` pointing at your Render/Railway URL,
updated to match in the HubSpot app config too), and point `DATABASE_URL` at
a Postgres instance from the same host (both offer a free-tier Postgres).

## Design decisions & trade-offs

- **Postgres, not SQLite.** Started with SQLite for a zero-setup local
  experience, but switched once this was actually deployed: Vercel's
  serverless Functions have no persistent/shared filesystem, so a local
  SQLite file silently loses data between invocations there — it would have
  looked fine locally and quietly broken in the one environment that
  matters for the "deployed to a public URL" bonus point. Prisma made the
  swap a schema-file + reset-migrations change, not a rewrite, since
  nothing in the sync/webhook/API logic touches SQL directly. `docker
  compose up` keeps local dev just as easy (spins up Postgres alongside the
  app) as SQLite was.
- **Single-tenant `Account` model, but built for multi-tenant.** The
  assignment describes one connected app instance. `Account.hubId` is unique
  and `getValidAccessToken()` picks the most-recently-updated account, so
  extending this to multiple connected portals later is a routing change,
  not a schema rewrite.
- **Re-fetch-on-webhook instead of trusting the payload.** A HubSpot webhook
  event only tells you *which* property changed, not the object's full
  current state, and multiple rapid changes can be batched/deduped by
  HubSpot before delivery. Re-fetching the object by id and running it
  through the same mapper/upsert path as `/sync` keeps exactly one source of
  truth for "what does a Contact/Deal record look like locally," instead of
  maintaining a second, partial-update code path that could drift from it.
- **`node-cron` was deliberately left out.** The background sync only needs
  "every N minutes," not cron expressions, so a plain `setInterval` avoids an
  extra dependency (and, as found in `npm audit` while building this, a
  vulnerable transitive dependency in `node-cron`'s current release).
- **Full CRM properties kept as a JSON `raw` column** on `Contact`/`Deal`
  alongside the typed columns used for filtering/sorting. This means adding a
  new filterable field later doesn't require a fresh HubSpot fetch — but the
  trade-off is that a totally new property does need a migration to become a
  first-class, indexable column.
- **`express-async-errors`** (a one-line patch of Express's router) instead of
  wrapping every async route handler in a manual try/catch or upgrading to
  Express 5 — keeps route handlers readable while errors still reliably reach
  the centralized error handler.
- **Known, accepted `npm audit` findings**: after removing `node-cron`, the
  remaining flagged issues are moderate-severity ReDoS/DoS concerns in `qs`
  (a transitive dependency of `express@4`'s `body-parser`), only fixable by
  moving to Express 5. Given this service doesn't accept complex nested query
  strings from untrusted clients, this was accepted as a documented trade-off
  rather than taking on an Express major-version migration under the
  assignment's time constraints.

- **HubSpot moved OAuth app creation to a CLI-based "Projects" model** partway
  through building this (their classic "Create app" UI now refuses to create
  new public/OAuth apps). Rather than fall back to a private-app static token
  — simpler, but a weaker demonstration of OAuth2 for this assignment — this
  repo includes a working [`hubspot-app/`](hubspot-app/) CLI project that
  deploys the exact app this service needs, so the real OAuth2
  authorization-code + refresh-token flow this project implements stays
  fully exercisable end-to-end, not just unit-tested in isolation.

## Known limitations & possible next steps

- No pull-then-push (bidirectional) sync yet — this service currently only
  pulls from HubSpot. Adding `POST /contacts` / `POST /deals` that write back
  via `hubspotClient` would reuse the same retry/error-mapping infrastructure.
- Webhook subscriptions are per-app, not per-installation — fine for a single
  connected account, but a true multi-tenant version would need to route
  incoming events to the right `Account` by `portalId` in the payload (which
  is already captured and available to use).
- No dead-letter queue for repeatedly-failing webhook events beyond manual
  `/retry` — acceptable at this scale, would reach for a real queue (BullMQ +
  Redis) if webhook volume grew significantly.

---

Built for the Central AI Backend / Integration Engineer take-home assignment.
