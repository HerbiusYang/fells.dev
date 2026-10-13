# fells.dev

Fells marketing site and customer console. The existing UI now connects to the
`fells-api` backend through same-origin HTTP APIs for accounts, API keys, usage,
billing, workspace/chat storage and online support.

Cloud computers, environment controls, workspace files, Canvas, plugins, user
sites and scheduled tasks have been removed from the product UI and public routes.
The remaining workspace feature stores conversations and manages members; it does
not execute agents. The static marketing catalog is reference data, not an
inventory of products on sale.

## Development

Use Node 24+ and the pnpm version pinned in `package.json`.

```bash
pnpm install
pnpm dev       # http://127.0.0.1:4321
pnpm test      # adapter, state/schema, local-storage and theme unit tests
pnpm build     # astro check + static build to dist/
```

Open the Fells frontend at `http://127.0.0.1:4321/zh/app/start` for the customer
login, or `/app/start` for English. The other locale prefixes are `/zh-hant/`,
`/ja/`, `/ko/` and `/es/`. The backend process listens on
`http://127.0.0.1:18080`; it supplies APIs and does not require opening a separate
user portal. The former `/portal/` customer pages return 404.

`astro.config.mjs` proxies `/api/app`, `/api/support` and `/v1` to the local backend
while preserving the browser Host and Origin. Keep frontend requests same-origin
so server cookies and origin checks work. The backend must use an independent
local PostgreSQL database with configured test accounts; the frontend does not
seed users or connect directly to a database.

The static build needs an equivalent same-origin API reverse proxy in production;
`astro preview` or a static file server alone does not supply authentication or
business services. Configure the backend's email, payment information, model
upstreams and offered subscriptions separately. An unconfigured service displays
its actual unavailable state.

## Where things live

| What | File |
| --- | --- |
| Landing copy, 6 languages | `src/i18n/{en,zh,zh-hant,ja,ko,es}.ts` (same shape, type-checked) |
| Inner-page copy, 6 languages | `src/i18n/pages/*.ts` (`PagesDict`) |
| Inner pages | `src/components/pages/*Page.astro`, routes in `src/pages/` and `src/pages/[lang]/` |
| Static marketing channels, product examples and price calculations | `src/data/catalog.ts` |
| Public contact email | `src/site.ts` |
| Real login, signup and password reset | `src/components/pages/AuthPage.astro` |
| Real CNY wallet, USD allowance and subscription Checkout | `src/components/pages/CheckoutPage.astro` |
| Same-origin HTTP transport and account/billing DTOs | `src/lib/app-http.ts`, `src/lib/account-api.ts` |
| Console persistence, workspace roles and session binding | `src/lib/app-service.ts` |
| Console rendering, copy and design examples | `src/scripts/app.ts`, `src/i18n/app/*.ts`, `src/data/app.ts` |
| Online support DTOs and HTTP adapter | `src/lib/support-api.ts`, `src/lib/support-http.ts`, `src/lib/support-service.ts` |
| Local-only storage used by unit tests | `src/lib/preview-store.ts`, `src/lib/support-store.ts` |
| Development API proxy | `astro.config.mjs` |
| Section order | `src/components/Landing.astro` |
| Design tokens (colors, radius, fonts) | `src/styles/global.css` |
| AI, vendor and plugin icons | `src/data/icons.ts`, SVGs in `src/data/brand-icons.ts` |

## Accounts and console

`/app/start` is a real account entry with password login, email-code registration
and password reset. Registration collects a separate login username (3–32
lowercase letters, digits, underscores or hyphens) and a verified email address.
It uses the current server agreement and any
configured verification challenge. If email delivery is not configured, the UI
reports that failure; it does not create a preview identity. Already authenticated
users continue to their requested console or Checkout page.

Terms open in a modal dialog using the current UI language (Chinese or English
server text), and consent stays an explicit checkbox. Server markup is displayed
as safe text. On desktop,
the left artwork stays fixed while a long account form scrolls within the right
panel. The public authentication configuration reports `email_enabled` without
exposing mail credentials; unavailable email disables registration/reset code
sending while existing accounts can still sign in with a password.

`/app` preserves the existing onboarding, sidebar, hash routes, settings, dialogs,
mobile drawer and theme choices. The server is the source of user identity,
permissions, API keys and money. Current capabilities are:

| Area | Current behavior |
| --- | --- |
| Profile, avatar, preferences and notification switches | Real authenticated server reads and writes |
| API keys and per-key limits | Real server keys and limit settings, subject to the account's self-service permission |
| Usage, request logs and model catalog | Real account-scoped API data; no example traffic is inserted |
| Wallet and API allowance | Separate CNY cash/grant and USD API balances from the backend |
| Workspace and chat history | Real creation, settings, saved user messages, explicit history import, editing and deletion |
| Workspace members | Owner-managed existing accounts with owner/editor/viewer permissions; no email invitation delivery |
| Customer support | Real server conversations, attachments, read status and events |
| Example workspace and marketing/model-picker examples | Read-only design data, not an executing workspace or a server product offer |
| Cloud computer, environment controls, files, Canvas, plugins, user sites and scheduled tasks | Removed from the product UI and public routes |

Saving a chat instruction is not an Agent execution result. The app does not
fabricate Agent responses, task completion, uploads, installation or payments.

The connected pages do not use IndexedDB as account, billing or support storage.
The old preview stores remain for explicit local-storage unit tests. Per-tab
workspace selection and an uncertain Checkout operation's idempotency key may be
kept in sessionStorage; neither is an authentication credential.

### Session boundaries

Authentication uses backend-issued HttpOnly cookies. Private requests bind to the
user ID and `session_id` returned by `/api/app/bootstrap`, so an old page cannot
write under a new account or a replaced session. Same-page events and
`BroadcastChannel('fells.session.changed')` notify other tabs; server validation
also applies when browser notifications are unavailable. Logout revokes the real
server session. Pending requests are cancelled or their late results discarded
when the account changes.

`public/_headers` supplies framing, referrer and content-type protections on hosts
that support that file. Other hosts need equivalent response headers:
`Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
`X-Content-Type-Options: nosniff`. Account and console pages also refuse to activate
inside frames. Local checks do not establish a production host's configuration.

## Billing and Checkout

Every public purchase button and `/checkout` opens online support. This page does
not submit a payment, top-up, allowance exchange or subscription purchase. Legacy
`mode`, `plan`, `seat`, `sku`, `pool` and `tier` query parameters do not authorize
a financial action. Support confirms the actual available offer, price, payment
arrangement and service period before purchase.

- **CNY wallet:** cash and promotional grant are displayed separately. Customer
  statements that payment was made are evidence to verify, not payment approval.
- **USD API allowance:** a configured one-time CNY cash exchange creates a separate
  USD allowance valid for 12 months after purchase. A further purchase extends the
  expiry of the entire remaining allowance; the account displays the server's
  actual expiry date. CNY and USD balances are displayed separately.
- **Monthly subscriptions:** available pools, tiers, prices, capacity and held
  subscriptions come from the server and are purchased with CNY wallet funds.
  Monthly mode never automatically uses API allowance when a usage limit is
  reached. Customers select monthly or allowance mode in Plans & credits.
- **Unavailable products:** static Token Plan, channel and group-seat examples
  do not establish availability. Monthly credit subscriptions and product CDK
  delivery remain unavailable. The Fells website manages accounts and saved
  conversations; model execution takes place in compatible external API clients.

Financial API adapters remain available for authorized integrations, with stable
`Idempotency-Key` values. An uncertain result needs reconciliation using the
original operation identity; the customer purchase page does not execute or retry
these transactions. Shared customer terms are in `src/i18n/business-rules.ts` and
are displayed consistently across all six languages, checkout and account billing.

## Online support

The bottom-right customer window uses same-origin `/api/support` for real text
and image messages, persisted conversations, read positions and status. Customer
sessions cannot access the operator desk. Operators use a separately configured
private entry and a separate backend-authenticated HttpOnly cookie; operator
login/logout does not replace the customer session.

Configure the build-only `SUPPORT_PORTAL_PATH` in gitignored `.env.local` or the
build environment. It accepts 2–5 lowercase English words joined with hyphens,
2–16 letters per word, without a conflict with public routes. Do not use a
`PUBLIC_` prefix or commit the real value. Without it, operator pages are omitted.
The customer widget does not expose the entry. Private pages omit public URL
metadata and third-party fonts, and use `noindex,nofollow,noarchive`. Changing the
entry requires replacing the full build output, including old private pages.

The URL itself grants no permissions: the backend authorizes each request and
binds it to the selected customer/operator session. Real SSE carries updates;
messages use UUID retries and uploaded attachment IDs. Current online/typing
leases are held in a single backend instance's memory, so multi-instance operation
needs shared leases and event transport.

See [the support integration contract and test configuration](docs/online-support.md).

## Archived design sources

The old `/themes/` preview routes are no longer published. Their source HTML and
assets remain under `templates/` for reference; those files describe concepts,
not available Fells features.

The marketing section order is promo bar → nav → hero → client marquee → Token
Plan → group buy → model/provider introduction → pay-as-you-go examples and
marketplace → Developer API → clients → security → FAQ → referral → blog →
account CTA → footer.
Static prices, quotas and discounts are computed from `src/data/catalog.ts` and
translated with `deal()`; these are presentation examples, not billing authority.

Public inner pages include `/market`, `/developer-api`, `/security`, `/faq` and
`/blog`, in all six languages. Use `link(t, "market")` for locale-aware links.

The app keeps light/dark/system themes, ⌘K navigation and mobile controls. Its
client/model selector records conversation metadata; messages are saved without
running an agent. The read-only workspace example is design data. Account spending
protection, a default PAYG channel and monthly credits products have no matching
current service and remain unavailable. Every effect uses CSS transforms or
gradients, with no canvas/WebGL requirement; motion respects
`prefers-reduced-motion`.

## Tests

```bash
pnpm exec playwright install chromium  # once, if no existing Chrome is available
pnpm test                             # unit/adapter/local-store tests
pnpm test:browser                     # built dist/ + browser regressions
pnpm test:all                         # build + unit tests + browser regressions
```

Browser tests use ephemeral browser contexts and loopback servers. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing browser. Build first for tests
that serve `dist/`. Auth/Checkout and support HTTP-contract tests use test-only API
fixtures; production pages still use real HTTP. Operator-page contract cases
require `SUPPORT_PORTAL_PATH` at build time.

**The security browser suite uses a real local API and writes test data.** Before
`pnpm test:browser` or `pnpm test:all`, prepare a separate local PostgreSQL test
environment (`testenv`), start its backend, and seed two disposable customer
accounts with API-key self-service enabled. Set `FELLS_BACKEND_ORIGIN` (default
loopback port 18080), `FELLS_BROWSER_USER`, `FELLS_BROWSER_USER2` and
`FELLS_BROWSER_PASSWORD` in that local test environment. Do not use a production
database or a person's active account. The suite exercises real persistence,
permissions, cross-tab session replacement and logout, and cleans up its own
workspaces/keys and restores tested preferences. A missing backend or test account
is a failure, not a successful mocked security check.

`tests/browser/support-live.test.mjs` is an additional opt-in live customer/desk
regression. Supply `FELLS_LIVE_TEST=1`, `FELLS_LIVE_TEST_PASSWORD` and isolated
customer/operator accounts; optional `FELLS_BROWSER_BASE`, `FELLS_TEST_USER`,
`FELLS_TEST_OPERATOR` and `FELLS_TEST_SUPPORT_PORTAL` select that environment. It
accepts loopback addresses only. Keep these settings and the operator entry out
of committed files. Backend transaction and permission regressions run separately
against its isolated PostgreSQL test database.

[Issue #1 remediation](docs/security-issue-1.md) records the earlier local-preview
security work; it is historical coverage, not a description of the current
connected authentication flow.

## Before launch

- [x] Deploy the static frontend and same-origin API proxy to 36.33.98.85; verify
      the app routes, retired routes, API proxy response, and production headers.
- [ ] Enable HTTPS with a trusted IP certificate and verify production
      cookie/origin behavior before using login or payment flows. On 2026-10-12,
      Let's Encrypt HTTP-01 and TLS-ALPN-01 validation both timed out from the
      issuer network; see `reports/frontend-backend-audit-2026-10-12.md`.
- [ ] Configure and verify real email delivery, verification challenges, server
      agreements, payments, API upstreams and subscription offers. Keep missing
      services visibly unavailable.
- [ ] Replace static marketing prices, quotas, channel metrics, referral amounts
      and product claims with the actual offers before presenting them as on sale.
      Configure real shop delivery/CDK services before enabling those flows.
- [ ] Add payment reconciliation/fulfillment and recovery for uncertain pending
      operations before promising automatic payment-to-service delivery.
- [ ] For multiple backend instances, share support leases and event transport.
- [ ] Verify public contact details and publish the blog posts or keep their
      unavailable labels.
- [ ] Run adapter, real local security/browser and backend database regressions
      against the release build with an isolated test environment.
- [ ] Preserve third-party icon licenses: LobeHub Icons (`@lobehub/icons-static-svg`,
      MIT) and Simple Icons (CC0); logos remain their owners' trademarks.
