# Frontend validation location

- When the current agent is running in Amp, skip connection status checks for `36.33.98.85` (including ping, SSH/TCP probes, and HTTP health checks). Do not require connectivity verification before proceeding with work. This exception does not change the validation location requirements below.
- Run every assistant-initiated frontend test, build, type check, lint check, and browser check on the dedicated test VPS `36.33.98.85`, in an isolated workspace or container. Do not run these checks on a local Mac or on the production VPS.
- Verify the exact source revision and include uncommitted changes under review when preparing the test workspace. Do not copy production credentials or other secrets to the test VPS.
- Clean temporary test workspaces, containers, and other resources after recording the results. Report failures and skipped tests separately.
- Automatic GitHub CI is supplementary evidence; leave its workflow intact. A green CI run does not replace the required test VPS validation.
