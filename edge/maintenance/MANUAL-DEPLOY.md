# Manual Cloudflare deployment

GitHub is not required for this deployment or for updating an announcement.
The Worker and its persistent state live in Cloudflare, outside the production
VPS. Deploy the reviewed/tested code with a manually invoked Cloudflare CLI;
hostnames, secrets, routes and cron can also be inspected in the dashboard.

Use an isolated staging Worker and domain first. Keep the production frontend,
API and operator DNS records pointing to their existing origins. Adding a Worker
**route** intercepts requests before reaching those origins. A new status
hostname is a Worker **custom domain**. These are different routing modes.

1. Copy `wrangler.jsonc` to an operator-managed configuration next to the source
   so relative `main` paths stay correct; keep that local configuration outside
   commits. Set the account ID and replace every example hostname. Choose a
   different Worker name and DO binding/namespace for staging and production.
2. Configure the following variables. The actual production website hosts found
   in this project's Caddy configuration are `fells.dev`, `api.fells.dev` and
   `console.fells.dev`; verify Cloudflare routes and any aliases before binding.

   | Variable | Purpose |
   | --- | --- |
   | `PUBLIC_HOSTS` | Comma-separated public website/API hostnames |
   | `OPERATOR_HOSTS` | Access-protected management hostname |
   | `CALLBACK_HOSTS` | Actual hostnames used for node heartbeat and receipt POSTs |
   | `STATUS_HOST` | Independently served status hostname |
   | `CONTROL_HOST` | Independently served control hostname; may equal status host |
   | `STATUS_URL` | Public HTTPS status-page link |
   | `CONTACT_TEXT` | A contact channel that remains usable while online support is stopped |
   | `ORIGIN_PROBE_URL` | Dedicated HTTPS origin hostname, exact path `/__maintenance/probe` |

3. Add routes for the audited website/API/operator hosts, and a custom domain
   for the status host. For example, replace the route list with:

   ```json
   [
     {"pattern":"fells.dev/*","zone_name":"fells.dev"},
     {"pattern":"api.fells.dev/*","zone_name":"fells.dev"},
     {"pattern":"console.fells.dev/*","zone_name":"fells.dev"},
     {"pattern":"status.fells.dev","custom_domain":true}
   ]
   ```

   Keep the dedicated probe hostname out of these routes. Retain Cloudflare
   Access on the operator host. Disable HTML rewriting and cache overrides on
   the maintenance/status/control paths. The checked-in configuration has no
   production routes and intentionally cannot take over a domain by itself.
4. Authenticate manually with `npx wrangler@4.152.0 login`, or use a dedicated
   local `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. No GitHub secret or
   GitHub connection is needed. Grant only the intended account/zone's Workers
   and required route management permissions.
5. From the `edge/maintenance` directory, manually run
   `npx wrangler@4.152.0 deploy --config <operator-configuration>`. Wrangler
   bundles the modules, creates the declared SQLite Durable Object and binding,
   deploys the code and configures the declared routes/cron. Existing durable
   state survives code deployments and rollbacks; never delete its namespace to
   clear a notice. The configuration migration is part of the deployment, so
   copying JavaScript into a generic playground alone is insufficient.
6. In Cloudflare Workers → the Worker → Settings → Variables and Secrets, set
   `MAINTENANCE_CONTROL_TOKEN` and `ORIGIN_PROBE_TOKEN` as **secrets**, using two
   different random values of at least 32 characters. They can also be entered
   interactively with `wrangler secret put`. Do not put them in public variables,
   source code, chat messages, URLs or shell command arguments.
7. Confirm the binding `MAINTENANCE` refers to `MaintenanceState`, the cron is
   `* * * * *`, and the host variables match the routes. Check the independent
   status endpoint while the **staging** origin is completely unreachable.
8. Follow the backend `docs/maintenance-runbook.md` to initialize persistent
   gateway/node admission files and use the manual control script. Updating a
   notice needs only the independent control token, even with the VPS stopped.

Code validation still follows this project's existing two-repository 85 and PR
CI gates. Run assistant-operated builds/tests only in the isolated 85 environment.
The manual deployment method does not remove those delivery requirements.

Cloudflare references: [manual deployment](https://developers.cloudflare.com/workers/get-started/guide/),
[Durable Object setup](https://developers.cloudflare.com/durable-objects/get-started/),
[routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).
