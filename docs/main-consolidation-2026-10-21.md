# Frontend main consolidation

The deployment source is `HerbiusYang/fells.dev/main`. Its previous tip was
`023152de0ff9813b4b2411d2e0d6dd7291432cf4`. The upstream default branch
`raydocs/fells.dev/hydra` at `0a86b0dec9e44559406f4c2ebd8747fde1b3e8e2`
was merged with the current account and audited-money contracts preserved.

Retained upstream changes include sitemap/robots, localized metadata, matching
visible/structured FAQ content, system body fonts, self-hosted JetBrains Mono,
idle/interaction widget loading, conditional GitHub sign-in, neutral member
name localization and Retry-After details. The machine-readable catalog uses
the actual main list-price debit and customer-confirmed purchase terms.

Main retains its complete consent-based invitation flow, CSP/Turnstile,
fixed Cloudflare Access support console, CNY collection, customer-confirmed USD
exchange and plan checkout, and the audited order/case lifecycle. The upstream
alternative invitation UI and older support-login route do not replace them.

## Previous branch audit

The full tree at each retained branch tip is identical to the corresponding
squash/merge commit below, already contained in the previous main history.
The old heads can be recorded as ancestry without replaying their features.

| Branch after `codex/` | Already integrated commit |
| --- | --- |
| business-integrity-20261016 | 634301533f00f63ac04eaf7a86b92000e6583525 |
| case-fixes-20261015 | 8e1c981 |
| cny-wallet-fx-20261017 | 023152de0ff9813b4b2411d2e0d6dd7291432cf4 |
| deep-business-fixes-20261016 | 7f756de |
| market-console-ui-20261017 | f54be6e737e5972be3574c8e8b4b910afddc7c4d |
| support-console-entry-20261016 | c2248c7 |
| support-event-reconnect-20261017 | 79f6468 |
| support-lifecycle-20261015 | 4b3ab91 |

The fork's `hydra` is already an ancestor of main. Once the consolidated main
passes CI, these nine fork branches have no unintegrated implementation.

## Validation and release

For this consolidation the user explicitly selected GitHub Actions as the
validation environment. No assistant tests or builds ran on the Mac or the
production VPS. The existing audit, complete regression suite and coverage
thresholds remain intact. New regressions cover stable order editor identity
across unchanged focus refreshes, conditional GitHub sign-in and public SEO.
The former idle refresh rebuilt the order form even when its record was
unchanged; preserving that editor avoids replacing focused controls between
an interaction and its submit.

After the gate, Node 24.19.0 and the pinned pnpm version build the production
site with the retired portal parameter unset. The `frontend-release-<sha>`
artifact contains a regular-file-only archive, per-file SHA256 manifest and
proof binding those hashes to the exact source commit and tree. Release
packaging requires all twelve localized support pages and their noindex meta.
