# Frontend security remediation — Issue #1

Date: 2026-10-07 (Asia/Shanghai)

Scope: the existing frontend/local preview, shared localized forms, and Synara
preview. No production backend or real account/payment endpoint was tested.

## Findings and repairs

| Issue finding | Repair | Regression evidence |
| --- | --- | --- |
| Plaintext environment values and data surviving logout | Environment values exist only in tab memory, outside the persistence schema. Logout deletes the active IndexedDB record, resets the UI and invalidates old sessions. A new preview resets the previous one. Legacy localStorage is purged, not migrated. | Secret absence in IndexedDB/localStorage/sessionStorage; reload; logout with two tabs; account switch; direct/back navigation; legacy cleanup. |
| Password in native GET | Remove the unused password and fake authentication flow. The entry explicitly starts a local preview with an email display label. Forms default to POST and start disabled until handlers are installed. | No password control in six locales; disabled no-script controls; storage failure does not enter the preview. |
| CDK/email in native GET after initialization failure | Register the submit guard before initialization, enable controls only after handler registration, feature-detect optional observers, use POST defaults. CDK has no HTML name and is read only by the protected submission handler. | Missing IntersectionObserver; forced initialization failure; actual native submit bypass; mocked CDK POST success/failure; waitlist and checkout modes. |
| Stored IDs injected into HTML attributes | Reconstruct every persisted object using a bounded allowlist schema; reject malformed/reserved IDs, invalid types, dangling references, duplicate IDs and folder cycles. Escape all ID attribute interpolations as a second defense. | Malformed-state unit tests and browser injection marker; valid state round trip; literal HTML in chat stays text. |
| Synara shares query strings | Build Ask/copy prompts using only origin + pathname; external links use noreferrer. | Real generated links and copied prompt exclude synthetic token, email and fragment. |
| Stale tab restores deleted records | Compare session + revision in the same IndexedDB readwrite transaction as the write. Reject conflicts and reload the committed snapshot. BroadcastChannel and focus/visibility refresh keep views current but are not the write protection. | Concurrent writers; deletion followed by stale theme update with synchronization disabled; revoked sessions cannot write. |
| Save errors hidden, deletion only in memory | Await transaction completion before success or navigation. Roll back uncommitted state, retain failed form input, and show errors. Bound message and aggregate sizes. Secret deletion uses memory only; logout deletes a record instead of rewriting a large snapshot. | Injected quota errors and transaction aborts; draft retained; successful retry; secret deletion and logout under failed puts; size limits. |
| Invitation design note | Remove generation of pretend join/role/referral tokens. Local preview says invitations are unavailable. Internal IDs use randomUUID. | The current app has no invite-token issuance or acceptance path. Future server-side issuance/authorization remains outside this prototype. |
| Conditional framing concern | Ship response-header template; refuse to activate app/entry in frames even when headers are omitted; confirm destructive item deletions. | Header-template serving and frame tests with those headers deliberately removed. This does not claim verification of production HTTP headers. |

## Intentional behavior changes

- Old local preview data is reset on upgrade rather than migrating plaintext secrets
  and potentially injected state. This is visible in README and preview-entry copy.
- Starting a new preview or signing out clears previous preview data. Merely
  reloading the active app retains validated non-secret data.
- Environment values are demo-only, tab-local and disappear on navigation/reload.
- Preview entry does not collect passwords or automatically send email to a
  waitlist. The separate landing-page waitlist still works.
- A conflict asks the user to retry against current data; it never silently
  overwrites another tab's committed changes.

## Validation

Run with Node 24+ and pinned pnpm:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:all
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an existing Chrome executable. The
browser suite serves the production `dist/` on a random loopback port, isolates
browser contexts, uses synthetic data, mocks local form endpoints and blocks
external requests. It does not use the developer's active profile.

Validated locally: type check (zero errors/warnings), static build (99 routes),
18 unit/theme/transaction tests and 24 browser tests, all passing. Browser coverage
uses desktop Chrome and a mobile viewport in Chrome, not a physical iOS/Android
device or a Safari/Firefox certification. The browser checks include 18 console
routes in each of six locales, workspace creation/rename/switch/delete/export,
chat creation/append/delete/model selection, file upload/folder traversal/recursive
delete, schedule create/pause/delete, profile/preferences/notifications/theme,
demo API-key creation/revocation, checkout and waitlist behavior.

The application remains a clearly labeled frontend preview. Real authentication,
authorization, billing, invitations and cloud execution still require their actual
services. This remediation closes the existing frontend issue, not a claim that
those future services or an unreviewed production deployment have been secured.
