# Upstream console integration

Reviewed upstream: [raydocs/fells.dev#13](https://github.com/raydocs/fells.dev/pull/13),
commit `11de4d8fc1017b03f33c29cf911cc9ad10cbfedf`, and draft
[subscription overview #14](https://github.com/raydocs/fells.dev/pull/14)
at `281eda05ec5a6e6520270c56fd76d5acd5bd92af`. Integration base:
`adf8b59e76ec0c2fee2bcab008cba55c6b1f3c85`. This is a selective port of the
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

The subscription overview uses the selected customer's actual subscription
and recorded account status. It does not create example accounts or infer
absolute remaining tokens from percentages. Five self-managed key controls
use their dedicated backend contract and independently verify the save receipt
against a fresh read. CIDR representation changes show the entered and recorded
rules for review; this view never automatically resends the write or claims
semantic equivalence from differing strings.

Cumulative usage is the backend's actual net API allowance USD debits, with
original-charge refunds reversed and subscription coverage counted as zero.
Measurement starts at the new backend cutover, not an invented historical total.
Inherited budget occupancy is shown separately from the current ownership's net
debits. A reached threshold stops new requests; an already admitted last request
can exceed it. Missing or inconsistent metering details remain unavailable.

Shared reset actions require an explicitly selected active owned subscription,
an acknowledgement of the shared effect, and complete server permission. The
backend must durably fence the official organization and qualification before
dispatch, across users, aliases, processes and restarts. `sending`, unknown,
accepted and refused outcomes never become retryable through a local count,
clock or page reload. Incomplete identity is read-only. A failure only refreshes
status; it never automatically submits another consuming request. Provider
acceptance is not evidence of a new remaining qualification.

## Already present or improved on the production base

Claude Code onboarding has OS-specific installation, safely prompted temporary
credentials, saved settings, model access from the selected key's live catalog,
and executable copied commands. Native installers replaced fragile downloaded
shell installers after an actual user failure. Key creation selects and refreshes
its catalog immediately, usage refresh preserves active controls, and large token
totals have exact accessible values. The wallet uses confirmed ECB quotes and
actual rate history. Browser conversations use the sending account without an
API-key selector. Those behaviors are retained.

## Deferred pending real data

- Context system/tools/history/thinking subdivisions, TTFT, route waterfalls,
  seat/IP/LCP scores and cache savings: upstream synthesizes them from fixed
  percentages, example traces, old prices, multipliers and FX `7.2072`. Existing
  logs do not establish those values. The backend telemetry endpoint also has
  placeholder fields and is not a source of measured statistics.
- Connection testing: upstream fetches bootstrap and reports success even if
  fetch fails. Bootstrap proves neither provider connectivity nor a paid route.
- Dry-run: upstream runs a local simulator with example routes/FX/discounts;
  backend preview/classification is also separate from real dispatch. It must
  never be represented as a guaranteed authorization, quote or provider health
  test. More CLI clients need current official configuration and catalog/client
  capability checks; Claude subscription routes do not imply standard API
  compatibility for Cursor, Cline or OpenCode.

The upstream CI changes are not needed: the existing full browser/coverage and
exact-source release gates remain required. No simulated grant, wallet fallback,
route selection, billing rate or provider health result is enabled by this port.
Draft dependency PR #15 was also reviewed. Its proposed versions are already
covered by the integration base's newer resolved versions; its older lockfile
is not applied as a downgrade. The diagnostic interfaces above remain disabled.
Synthetic tests establish their stated fixtures and code contracts, not real
provider connectivity, account eligibility or production traffic correctness.
