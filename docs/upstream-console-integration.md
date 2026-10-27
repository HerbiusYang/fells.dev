# Upstream console integration

Reviewed upstream: [raydocs/fells.dev#13](https://github.com/raydocs/fells.dev/pull/13),
commit `11de4d8fc1017b03f33c29cf911cc9ad10cbfedf`. Production base:
`32e0070d5d1fc5f37e77f8727914d4d9e42d9bcc`. This is a selective port of the
observability idea, with attribution to Ruirui Wan and the upstream contributors.
The divergent application was not replaced wholesale.

## Ported

The existing request-log dialog now offers recorded input, output and cache
partitions per request and a histogram of recorded total request durations.
OpenAI/Gemini cache reads are included in input; Anthropic reads are separate.
One-hour cache writes are a subset of total cache writes. Counts are never
estimated from prompt length or fixed percentages. Missing/inconsistent counters
are unavailable; genuine zero remains zero. Duration percentiles and five bins
cover loaded matching rows, including errors, rather than claiming full-history
or time-to-first-token statistics. Logs stay in the dialog and load only when
requested. The API overview retains its compact workspace.

## Already present or improved on the production base

Claude Code onboarding has OS-specific installation, safely prompted temporary
credentials, saved settings, model access from the selected key's live catalog,
and executable copied commands. Native installers replaced fragile downloaded
shell installers after an actual user failure. Key creation selects and refreshes
its catalog immediately, usage refresh preserves active controls, and large token
totals have exact accessible values. The wallet uses confirmed ECB quotes and
actual rate history. Browser conversations use the sending account without an
API-key selector. Those behaviors are retained.

## Deferred pending real data and enforced backend contracts

- Context system/tools/history/thinking subdivisions, TTFT, route waterfalls,
  seat/IP/LCP scores and cache savings: upstream synthesizes them from fixed
  percentages, example traces, old prices, multipliers and FX `7.2072`. Existing
  logs do not establish those values. The backend telemetry endpoint also has
  placeholder fields and is not a source of measured statistics.
- Cooldown/reset grants: upstream builds example accounts and changes an
  in-memory flag on click. Real spend-grant APIs exist but require a currently
  owned eligible seat and confirmed upstream acceptance. They must be wired and
  tested before exposing an action; API-only customers cannot reset an arbitrary
  provider account.
- Connection testing: upstream fetches bootstrap and reports success even if
  fetch fails. Bootstrap proves neither provider connectivity nor a paid route.
- Five-field key governance: APIs exist, but upstream edits the ordinary limits
  endpoint rather than the governance endpoint, retains optimistic local values,
  and uses `used_micros` where the server returns `used_quota_micros`. Live
  enforcement/accounting of every new governance rule needs end-to-end proof.
  Existing enforced daily/monthly limits remain available.
- Dry-run: upstream runs a local simulator with example routes/FX/discounts;
  backend preview/classification is also separate from real dispatch. It must
  never be represented as a guaranteed authorization, quote or provider health
  test. More CLI clients need current official configuration and catalog/client
  capability checks; Claude subscription routes do not imply standard API
  compatibility for Cursor, Cline or OpenCode.

The upstream CI changes are not needed: the existing full browser/coverage and
exact-source release gates remain required. No simulated grant, wallet fallback,
route selection, billing rate or provider health result is enabled by this port.
