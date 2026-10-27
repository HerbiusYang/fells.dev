# Independent maintenance entrance

This Worker serves the public maintenance/status document without the Fells
gateway, PostgreSQL, Redis, Caddy, customer login or online support. A SQLite-backed
Durable Object named `global` stores the authoritative notice and revision.
No production route is enabled in the checked-in configuration.

## Files and runtime

`worker.mjs` contains entrance routing and the independent probe;
`state.mjs` contains strict public schema validation, the Durable Object, and
compare-and-swap updates. `templates/page.mjs` produces self-contained HTML in
English, simplified/traditional Chinese, Japanese, Korean and Spanish. No script,
font, image, API call or login is required to read it. CSS is authorized by its
exact SHA-256 CSP hash. HTML, status JSON and rejected API calls use `no-store`.

The template is bundled with the Worker, so an origin outage or missing cached
asset cannot break it. Normal traffic is streamed through unchanged, without
reading the request/response body, retrying requests, or replacing origin HTTP
errors. A failed origin fetch gets a temporary announcement. Browser HTML
navigations also get that announcement for Cloudflare origin-connect errors
521–526; API responses always keep their original HTTP status and body. An API connection
failure is marked `request_result_unknown`; only pre-dispatch maintenance
rejections carry `transaction_rejected: true`.

## Deploying

Build/test only in the isolated 85 environment, then deploy the reviewed exact
revision through the independent edge delivery workflow. Use a pinned Wrangler
release approved by the repository dependency policy. Configure an explicit
Cloudflare account ID outside source control. Do not copy backend credentials.

1. Copy `wrangler.jsonc` into an operator-managed staging configuration. Change
   all example hosts; keep staging and production in separate Worker/DO bindings.
2. Set `PUBLIC_HOSTS`, `OPERATOR_HOSTS`, `CALLBACK_HOSTS`, `STATUS_HOST`, `CONTROL_HOST`, and
   `STATUS_URL`. Host variables are lowercase hostnames, without a scheme or port.
   The host allowlist rejects any unexpected incoming host.
   `CALLBACK_HOSTS` must explicitly list each already-allowed gateway hostname
   used by node reports and durable receipts (usually the API host). It defaults
   to empty; omitting a required host will prevent draining receipts. Only exact
   POST `/hooks/sidecar-report`, `/hooks/sidecar-direct-receipt`, and
   `/hooks/sidecar-direct-receipt-v2` bypass the maintenance/storage gate. The
   original gateway authentication/signature checks remain in effect; no other
   business or control path is exempt. Include these callbacks in staging
   acceptance both during maintenance and during status-store failure.
3. Add **Worker routes** on the existing proxied public/API/operator DNS hosts,
   for example `{ "pattern": "www.example.com/*", "zone_name": "example.com" }`.
   `fetch(request)` on a route reaches the pre-existing origin and preserves Host,
   Origin, cookies, Access assertions, streaming and the trusted proxy chain.
   Do not turn these hosts into Worker custom domains: that would make normal
   proxying recurse. Disable page caching/HTML rewriting on maintenance paths.
4. Add `STATUS_HOST` as a Worker custom domain, for example
   `{ "pattern": "status.example.com", "custom_domain": true }`.
   An optional separate `CONTROL_HOST` can also use a custom domain.
5. Provision a random secret of at least 32 characters named
   `MAINTENANCE_CONTROL_TOKEN` using the Cloudflare secret store. Use a dedicated
   environment-scoped credential in the maintenance control workflow; never put
   it in page JavaScript, a URL, an Actions input or logs. Existing Cloudflare
   Access stays ahead of operator routes. Put a separate control host behind
   Access with a service policy if desired; the Bearer check is always required.
6. Verify the status host and every public hostname in staging while the source
   origin is wholly unreachable, then bind production routes using the audited
   topology. Do not stop the real production VPS for a test.

The code-deployment token needs Worker script deployment rights in the intended
account and, only when creating routes, route-edit rights in the intended zone.
The notice-update workflow uses only the maintenance Bearer token (and an Access
service credential if configured). Updating a notice does not require SSH or
production database access. Never grant a broad global API key.

## Public contract

`GET /__maintenance/status` returns the bare schema object with HTTP 200, even
when its mode is `maintenance`, `incident`, or `recovering`. A status-storage
failure returns an embedded generic `incident` document, never a healthy claim.
`HEAD` has identical headers and an empty body. Other methods return 405.

```json
{
  "version": 1,
  "revision": 0,
  "mode": "normal",
  "incident_id": "",
  "title": "",
  "message": "",
  "starts_at": null,
  "expected_end_at": null,
  "next_update_at": null,
  "updated_at": "2026-10-26T00:00:00Z",
  "retry_after_seconds": 60,
  "status_url": "https://status.example.com/"
}
```

The complete JSON transport limit is 64 KiB. Text limits are 128 UTF-16 code
units for `incident_id`, 200 for `title`, 4000 for `message`, and 2048 for
`status_url`. Blocking states require a nonblank incident ID. Status URLs must
use credential-free HTTPS and cannot contain a fragment.
Text rejects C0 controls except tab/LF/CR, and rejects DEL and C1 controls.

Times use UTC ISO timestamps ending in `Z`, with zero to three fractional
second digits. `normal` and `scheduled` forward
traffic. `scheduled` is an advance notice; reaching `starts_at` does not initiate
an unsafe uncoordinated shutdown. The operator enters maintenance explicitly.
`maintenance`, `incident`, and `recovering` reject new traffic. The status host
serves HTTP 200; customer HTML navigation serves HTTP 503 with the same notice.
API/non-GET requests get JSON HTTP 503, `X-Fells-Maintenance: 1`, and `Retry-After`.
All six locale prefixes and deep website links are supported. Fixed operator
support routes return 404 on public hosts even during maintenance.

## Control contract

Only `CONTROL_HOST` accepts `POST /__maintenance/control`. Supply
`Authorization: Bearer <secret>`, `Content-Type: application/json`, and:

```json
{ "expected_revision": 0, "state": { "version": 1, "revision": 0, "mode": "maintenance", "incident_id": "patch-20261026", "title": "Maintenance", "message": "The service is being updated.", "starts_at": "2026-10-26T00:00:00Z", "expected_end_at": null, "next_update_at": null, "updated_at": "2026-10-26T00:00:00Z", "retry_after_seconds": 60, "status_url": "https://status.example.com/" } }
```

The server increments `revision` and replaces `updated_at`. A concurrent/stale
revision gets HTTP 409 and `{ "error": "Revision conflict", "state": ... }`;
read and reconcile instead of automatically overwriting it. Invalid/oversized
input gets 400; missing/weak/incorrect secrets get 401. Only the fixed public
schema fields are persisted and returned. Every manual update survives Worker
restart and code rollback. Manual non-normal states take priority over probes.

## Independent outage detection

Set `ORIGIN_PROBE_URL` to an independently routed HTTPS hostname serving the exact
`/__maintenance/probe` path, outside this Worker's public/operator/status/control
hosts. Set `ORIGIN_PROBE_TOKEN` to the matching dedicated backend probe secret
(at least 32 characters). The backend validates it before invoking real readiness.
The probe must reach the real gateway and dependencies, not this Worker or a
cached maintenance page. Keep its hostname out of all Worker route patterns.

Cron runs once a minute. It sends GET with only the dedicated Bearer token, a
four-second abort budget, no cookies, no redirects and no caching. Only HTTP 200,
body exactly `ready` (bounded to 64 bytes), and no maintenance marker is healthy.
Three consecutive failed samples move a normal state to `incident`; two healthy
samples move a monitor-owned incident to `recovering`. Recovery stays blocked
until the operator verifies business/accounting and explicitly clears it.
This is a detection target of roughly 2–3 minutes plus scheduling/network delay,
not an availability guarantee. Probes never restart a host or replay a business
request. A manual update made while a probe is in flight wins by revision check.

Origin readiness is distinct from complete release/business acceptance: isolated
integration checks must additionally cover the configured Redis failure behavior,
real request admission, node journals and billing reconciliation. The gate and
runbook in `fells-api` own that complete recovery decision.

References: [Worker routes](https://developers.cloudflare.com/workers/configuration/routing/routes/),
[Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
