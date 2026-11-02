# Codex client setup

The account API page includes a Codex tab. It uses the selected active personal
Key's own catalog and offers only rows that are explicitly offered, routable and
advertise `openai-responses` in `client_formats.api`. Native Claude Code access,
website-only access and Chat Completions alone cannot create a Codex example.
Changing the Key clears the model choice and waits for that Key's new catalog.

The copied TOML uses the exact selected model ID, the API origin's `/v1` base,
`model_provider = "fells"`, `env_key = "FELLS_API_KEY"`, `wire_api = "responses"`
and HTTP streaming (`supports_websockets = false`). The Fells customer supplies
their own complete Key through their local environment or secret manager and
starts Codex from that environment. This page neither requests the Key body nor
writes credentials to browser storage or a configuration file. It does not ask
the customer to delete `auth.json`.

These fields follow the current official [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [custom provider configuration](https://learn.chatgpt.com/docs/config-file/config-advanced),
checked on 2026-11-02. The latter identifies the provider's base URL and
environment variable authentication; the reference defines Responses and the
WebSocket capability flag. Client settings are separate from the account's
permissions, model prices and actual upstream availability.

Regression coverage checks six localized mobile account pages, actual selected
model and Key changes, native/web-only permission exclusion, the displayed and
copied configuration, and hostile model strings parsed by Python's real TOML
parser. All assistant-initiated validation runs on the isolated 85 VPS.
