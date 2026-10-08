# Support security follow-up — 2026-10-08

Scope: all support store/service/UI/image/presence/availability modules, customer widget, operator console, portal generation, and related unit/browser tests. Only isolated local data and a synthetic portal were used. No production endpoint or real customer record was accessed.

## P2: a late customer refresh could display data after logout or account replacement

The widget checked its customer session before `ensureUserConversation`, but did not check again after that asynchronous operation returned. A committed IndexedDB result could be delivered after a different tab had ended the session. When cross-tab broadcasts were unavailable, the old result still rendered private messages in the expired widget.

Reproduction uses real IndexedDB transactions, holds only delivery of a completed support transaction, ends the customer session in another page, then releases the result. The previous implementation failed the `the expired widget stops before displaying a late response` assertion. The fixture pauses unrelated availability queries and asserts the widget remains pending before release, so another logout-detection mechanism cannot produce a false pass.

Fix: recheck `readPreview()` after conversation refresh and read-receipt completion, before mutating or rendering customer state. An absent or replaced session invokes the existing cleanup. Widget cleanup is now idempotent. Existing operator and send-response session guards are retained.

Regression: `tests/browser/support-lifecycle.test.mjs`, covering both logout and account replacement.

## P2: native keyboard scrolling could override send-to-latest positioning

The remote CI failure in `tests/browser/support.test.mjs` was a product race. Chromium continued the native Home-key scroll animation after the send handler assigned `scrollTop` to the bottom. Subsequent animation frames moved history away from the new message. An isolated trace reproduced this at normal speed; CPU throttling also made the original immediate assertion fail. `scrollTo({behavior: "instant"})` alone did not cancel the already running native keyboard animation.

Fix: `installSupportHistoryKeyboard` applies explicit immediate history navigation for Home, End, PageUp, PageDown, ArrowUp and ArrowDown. It operates only when the history container has keyboard focus and no modifier is pressed. Child image-button activation remains unchanged. Both chats install the shared handler and remove it on cleanup.

Regression: `tests/browser/support-regression.test.mjs` sends immediately after keyboard history navigation and asserts the newest message remains visible for four rendered frames in both chats. The original CI assertion remains strict and unchanged.

## Verification and remaining limits

- Support store/image/portal/presence unit tests: 51 passed, 0 failed.
- New lifecycle and existing/new support regressions: 5 passed, 0 failed; the two lifecycle cases also passed after adding the false-pass guard.
- Existing image dialog, receipt, typing, availability, covered-history, customer/operator history, and quota/logout browser checks with V8 coverage: 8 passed, 0 failed.
- Six local scrolling traces after the fix, including three with 4× CPU throttling, stayed at the bottom through the final observed frame.
- Independent synthetic build and `git diff --check` passed.

No additional reproducible XSS, forged-session mutation, image-format bypass, quota corruption, or public portal-path disclosure was found in this review. Reconstructed allowlists, raster header checks plus upload decoding, atomic storage-session checks, transaction rollback, and configured/unconfigured portal behavior were inspected and exercised by existing tests.

The current support adapter is explicitly a local preview, and browser storage can be modified by its owner. Its demo operator login is not production authentication. The reserved backend contract was preserved; real-server authorization, media access controls, CSRF, network rate limiting, and upload processing require server implementation and API-level validation.
