# Auth form responsiveness and Turnstile recovery

The account form previously disabled every input until session/configuration/
agreement reads and the Turnstile script download completed. Inputs and mode
selection now become available when the page script initializes. Submission
still waits for the server configuration, and password login requires a
Turnstile token when configured. Email-code issuance retains its token or
scoped server-proof requirement.

Turnstile starts asynchronously once configuration is available, overlapping
verification with typing. Script download retains the 20-second deadline;
a challenge that does not complete gets a 30-second watchdog. The watchdog
pauses during interactive solving, where Turnstile's own timeout applies.
Failures appear inline with a separate retry action. Retrying preserves the
current fields, performs no automatic POST, and does not re-fetch the session
or reset the selected mode. Retired widget callbacks cannot authorize a request
or erase a newer token. Maintenance still blocks business actions and refreshes
configuration when service resumes.

## Reproducible validation

Base source: `e2407ad` on branch `codex/turnstile-input-20261106`, plus the changes
in `src/components/pages/AuthPage.astro` and
`tests/browser/auth-turnstile.test.mjs`. The unrelated modified catalogue files
in the shared main checkout are not part of this change.

All builds, type/lint checks and browser tests run on `36.33.98.85` in the
isolated persistent container `fells-turnstile-input-20261106-web`, with source
at `/data/fells-validation/turnstile-input-20261106/web` mounted as `/work`.
Logs are retained under `/data/fells-validation/turnstile-input-20261106/logs`.
The existing Node 24.19.0 / pnpm 11.19.0 / Playwright 1.62.1 image and browsers
under `/ms-playwright` are reused. The frozen offline install reused all 292
packages and existing public registry metadata. No browser installation or
production data is involved. The workspace, container and caches are retained.

Commands:

```sh
pnpm build
pnpm test
pnpm exec tsc --noEmit --noUnusedLocals --noUnusedParameters
pnpm check:unused
node --test tests/browser/auth-turnstile.test.mjs
FELLS_AUTH_MOBILE_WEBKIT=1 node --test tests/browser/auth-turnstile.test.mjs
pnpm test:browser
```

The mobile WebKit mode uses a 390 × 844 viewport and touch/mobile emulation.
All auth responses, tokens, failures and hanging downloads are synthetic.
These tests verify application behavior, not mainland iPhone download speed.

Final source SHA256:

- AuthPage: `d3d169480dd2da4670091cdc913975d053ec6a133932b1db450cc7a218110bfa`
- Auth browser tests: `cdd76834961e69a8e8217c26c7e9f49fd2fd528fee9d90af73cb0a2698682b47`

| Final source check | Result |
| --- | --- |
| Build | Passed; 84 pages, 0 errors, 0 warnings |
| Unit tests | 617 passed, 0 failed or skipped |
| Chromium authentication | 43 passed, 0 failed or skipped |
| Mobile WebKit authentication | 43 passed, 0 failed or skipped |
| TypeScript unused checks | Passed |
| Knip and production strict | Passed |

The broader browser run on the immediately preceding implementation (before
the final configuration-refresh race fix) had 713 tests: 672 passed, 1 failed,
40 skipped. Its sole failure was an older version of the maintenance test
which did not dismiss the expected maintenance error dialog; the corrected
test passes in both final authentication runs. The 40 integration cases require
isolated Go/API/PostgreSQL/Access fixtures or explicit live-test switches that
were not enabled. This broad run is supplementary evidence, not an all-green
test of the final revision. Final logs have `-race-final`, `-final-race` or
`-final` in their filenames; the broad run remains in `browser-full.log`.

## Remaining network acceptance

This source change does not alter Cloudflare WAF rules or accelerate challenge
iframe responses. A read-only check of Cloudflare Security Events confirmed
that the attachment's Ray ID `a568bb12493c1817` matched the active custom rule
`Fells 用户登录入口` with action `Managed Challenge`. The event is a mainland
iPhone Chrome GET of `fells.dev/app/start/`. The rule's displayed conditions are
hostname `fells.dev`, method `GET`, and path containing `/app/start`.

The separately approved WAF change retains those conditions and adds an
exclusion for only the twelve canonical public login paths below (with and
without trailing slash). Other paths remain within the original match.
The user confirmed the change at action time and explicitly confirmed that
login submission must retain its protections. Cloudflare validated the rule,
saved it, and displayed the new condition with the rule still Active and its
action still Managed Challenge. No blanket Skip rule or API/POST exclusion
was added.

```text
and not http.request.uri.path in {
  "/app/start" "/app/start/"
  "/zh/app/start" "/zh/app/start/"
  "/zh-hant/app/start" "/zh-hant/app/start/"
  "/ja/app/start" "/ja/app/start/"
  "/ko/app/start" "/ko/app/start/"
  "/es/app/start" "/es/app/start/"
}
```

After saving, read-only HTTP checks from 85 with an iPhone Chrome User-Agent
returned normal form HTML with HTTP 200 for `/app/start/` and `/zh/app/start/`,
without a `cf-mitigated` challenge header. Independent maintenance status was
`normal`, and public authentication configuration still had a Turnstile site
key. Requests using Python's default User-Agent received 403, so the change
does not establish that all automated clients or all other protections permit
access. These HTTP checks are not a real iPhone performance measurement; no
production login POST or customer credentials were used.

After deployment, measure separately on the affected mainland iPhone:

1. Navigation to editable account/password fields.
2. Verification start to a valid token and permitted submission.
3. Failure/retry behavior with the entered values preserved.

Cloudflare states that Turnstile is not supported in Mainland China. If real
network testing still fails, a verified alternative provider would require a
separate client and server integration, while retaining server validation and
rate limits. No alternative provider or frontend production release is included
here. Only the separately approved WAF adjustment is live.

References:

- [Widget configuration and callbacks](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Server-side token validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Turnstile availability in Mainland China](https://developers.cloudflare.com/china-network/faq/#is-turnstile-available-in-mainland-china)
