# Frontend validation location

- Use “85” for the local test server (`36.33.98.85`) and “production VPS” for the single VPS serving fells.dev. The Mac is the editing workstation.
- When the current agent is running in Amp, skip connection status checks for `36.33.98.85` (including ping, SSH/TCP probes, and HTTP health checks). Do not require connectivity verification before proceeding with work. This exception does not change the validation location requirements below.
- Run every assistant-initiated frontend test, build, type check, lint check, and browser check on 85 in an isolated workspace or container.
- Verify the exact source revision and include uncommitted changes under review when preparing the test workspace. Do not copy production credentials or other secrets to 85.
- Clean temporary test workspaces, containers, and other resources after recording the results. Report failures and skipped tests separately.
- Keep the existing automatic GitHub CI workflow. Its results supplement the required checks on 85.
- On 85, use the available CPU and memory for parallel test files. The test scripts size their worker pools automatically. Set `FELLS_TEST_WORKERS` to tune a run for current load. Browser tests using a shared live backend run serially. Reuse each build across files and preserve both required build configurations and their coverage checks.

# Release operation requirements

- Claude Code follows the current official release. Do not pin the customer installation or require dedicated Claude CLI CI; historical compatibility fixtures do not impose a runtime version. Ordinary application checks remain required.
- Website availability is part of release acceptance. Keep builds and tests isolated from production traffic, check public HTTP access, the independent maintenance state and origin readiness before and after deployment, and verify the accepted frontend/backend identities. Restore an interrupted current service before unrelated work. Do not finish while the public entrance remains in `recovering`: reconcile billing and use the existing guarded verification/exit procedure, without bypassing recovery checks or inventing acceptance evidence.

# Web prompts

- Use site-styled dialogs and inline field errors for web interactions. Do not use browser-native `alert`, `confirm`, `prompt`, blocking `beforeunload` warnings or native validation bubbles. Preserve validation, safe cancellation, keyboard access and session boundaries; never persist a one-time secret to compensate for closing or refreshing a page.
