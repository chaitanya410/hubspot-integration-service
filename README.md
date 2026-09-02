# HubSpot Integration Service

A standalone backend microservice that authenticates with **HubSpot CRM** via OAuth2,
syncs **Contacts** and **Deals** into a local database, receives and validates
**HubSpot webhooks** for near-real-time updates, and exposes a clean, filterable
local REST API — built for the Central AI Backend / Integration Engineer take-home.

Built with **Node.js + TypeScript**, Express, Prisma, and Zod.

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

## Architecture

```mermaid
flowchart LR
    subgraph Client["Your app / Postman / curl"]
    end

    subgraph Service["hubspot-integration-service"]
        Routes["Routes\nauth · sync · contacts · deals · webhooks"]
        Services["Service layer\nauth.service · sync.service · webhook.service"]
        HubClient["HubSpot client\nauth header + retry/backoff"]
        DB[(SQLite via Prisma)]
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

1. Log into your HubSpot **developer account** → **Apps** → **Create app**.
2. Under **Auth**, note your **Client ID** and **Client secret**.
3. Add a **Redirect URL**: `http://localhost:3000/auth/hubspot/callback`
   (update this to your deployed URL later if you deploy).
4. Under **Scopes**, enable:
   `crm.objects.contacts.read`, `crm.objects.contacts.write`,
   `crm.objects.deals.read`, `crm.objects.deals.write`.
5. Under **Test accounts**, connect/create a free CRM test account — this is
   what you'll actually authenticate against.

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
| `DATABASE_URL` | SQLite file path, default `file:./dev.db` (created under `prisma/`) |
| `HUBSPOT_DEVELOPER_API_KEY`, `HUBSPOT_APP_ID`, `WEBHOOK_TARGET_URL` | Only needed for `npm run register-webhook` — see [Webhooks](#webhooks) |
| `ENABLE_SCHEDULED_SYNC`, `SYNC_INTERVAL_MINUTES` | Optional background sync — see [Background sync](#background-sync-bonus) |

### 3. Set up the database and run

```bash
npm run prisma:migrate      # creates prisma/dev.db and applies the schema
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

**Option A — script (programmatic, satisfies "register a webhook subscription
in code"):**

```bash
# .env needs: HUBSPOT_APP_ID, HUBSPOT_DEVELOPER_API_KEY (from
# https://app.hubspot.com/l/developer-api-key — different from your OAuth
# client secret), WEBHOOK_TARGET_URL (a publicly reachable URL, e.g. your
# ngrok tunnel or deployed URL)
npm run register-webhook
```

This calls HubSpot's Webhooks Management API v3 to set the target URL and
subscribe to `contact.creation`, `contact.deletion`, `contact.propertyChange`
(per tracked property), and the equivalent `deal.*` events. See
[`scripts/register-webhook.ts`](scripts/register-webhook.ts).

**Option B — HubSpot UI:** developer account → your app → **Webhooks** tab →
set the target URL and subscribe to the same event types manually.

> Webhooks require a **publicly reachable HTTPS URL** — `localhost` won't
> work. For local testing, use a tunnel (e.g. `ngrok http 3000`) and point
> `WEBHOOK_TARGET_URL` / the app's webhook settings at the tunnel URL.

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

SQLite via Prisma (see [`prisma/schema.prisma`](prisma/schema.prisma)):

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
docker build -t hubspot-integration-service .
docker run --env-file .env -p 3000:3000 -v hubspot-data:/app/data hubspot-integration-service
```

Or with Compose (reads `.env`, persists the SQLite file in a named volume,
runs `prisma migrate deploy` automatically on container start):

```bash
docker compose up --build
```

## Deployment

Any Node-friendly free-tier host works (Render, Railway, Vercel). Example for
**Render** (Web Service):

1. Connect your GitHub repo. Build command: `npm install && npm run build`.
   Start command: `npm start` (or let the Dockerfile drive it if using Render's
   Docker deploy option).
2. Set all the `.env` variables from `.env.example` in Render's dashboard,
   with `BASE_URL` set to your Render URL and `HUBSPOT_REDIRECT_URI` updated
   to `https://<your-app>.onrender.com/auth/hubspot/callback` — remember to
   also update the Redirect URL in your HubSpot app's Auth settings to match.
3. **Persistence caveat**: free-tier Render web services have an *ephemeral*
   filesystem — a plain SQLite file will not survive a redeploy or restart.
   For a real production deployment, swap `provider = "sqlite"` for
   `provider = "postgresql"` in `prisma/schema.prisma`, point `DATABASE_URL`
   at a free Render/Railway Postgres instance, and re-run
   `npx prisma migrate dev`. This is a one-line schema change since all the
   sync/webhook/API logic goes through Prisma, not raw SQL — see
   [trade-offs](#design-decisions--trade-offs) for why SQLite is the default here.
4. Update your webhook's target URL (`npm run register-webhook` again, or the
   HubSpot UI) to point at the deployed URL.

## Design decisions & trade-offs

- **SQLite by default, not Postgres.** This keeps `npm install && npm run dev`
  a true zero-setup experience (no local Postgres/Docker required to try the
  project). The trade-off is the ephemeral-disk issue on some free hosts,
  called out explicitly above with the one-line fix (Prisma makes the DB
  swap trivial because nothing outside `prisma/schema.prisma` and
  `DATABASE_URL` is Postgres/SQLite-specific).
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
