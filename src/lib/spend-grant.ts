import type { SpendGrantWords } from "../i18n/spend-grant";
type ResetState = "read_only" | "ready" | "sending" | "unknown" | "accepted" | "refused";
type ResetReason = "" | "identity_incomplete" | "qualification_unknown" | "not_eligible" | "transport_unavailable" | "storage_unavailable" | "sending" | "unknown" | "accepted" | "refused";
export interface SpendGrantSnapshot {
  poolID: number; known: boolean; eligible: boolean; observedAt: number | null;
  remaining: number | null; expiresAt: number | null; expiryInvalid: boolean;
  lastResetAt: number | null; cooldownCleared: boolean; upstreamStatus: number;
  resetAvailable: boolean; resetContractKnown: boolean; resetState: ResetState | null; resetBlockReason: ResetReason | null;
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const time = (value: unknown): number | null => integer(value) && value > 0 && value <= 253_402_300_799 ? value * 1000 : null;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

// Explicit owned pool selection; no account_name/default-first-account adapter.
export function parseSpendGrant(value: unknown, poolID: number, now: number): SpendGrantSnapshot {
  const response = record(value), grant = record(response?.spend_grant);
  if (!integer(poolID) || poolID <= 0 || response?.ok !== true || response.pool_id !== poolID || !grant) throw new Error("unavailable");
  const observedAt = time(grant.observed_at);
  const remaining = grant.resets_remaining_known === true && integer(grant.resets_remaining) ? grant.resets_remaining : null;
  const expirySet = grant.expires_at !== undefined && grant.expires_at !== "";
  const expiryText = typeof grant.expires_at === "string" ? grant.expires_at : "";
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(expiryText);
  const day = iso ? Date.parse(expiryText.slice(0, 10) + "T00:00:00Z") : NaN;
  const validDay = Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === expiryText.slice(0, 10);
  const parsedExpiry = iso && validDay ? Date.parse(expiryText) : NaN;
  const expiryInvalid = expirySet && !Number.isFinite(parsedExpiry);
  const known = grant.known === true && observedAt !== null && observedAt <= now && typeof grant.eligible === "boolean" && !expiryInvalid && (grant.resets_remaining_known !== true || remaining !== null);
  const state = typeof grant.reset_state === "string" && ["read_only", "ready", "sending", "unknown", "accepted", "refused"].includes(grant.reset_state) ? grant.reset_state as ResetState : null;
  const reason = typeof grant.reset_block_reason === "string" && ["", "identity_incomplete", "qualification_unknown", "not_eligible", "transport_unavailable", "storage_unavailable", "sending", "unknown", "accepted", "refused"].includes(grant.reset_block_reason) ? grant.reset_block_reason as ResetReason : null;
  const readOnlyReason = reason !== null && ["identity_incomplete", "qualification_unknown", "not_eligible", "transport_unavailable", "storage_unavailable"].includes(reason);
  const resetContractKnown = state !== null && reason !== null && typeof grant.reset_available === "boolean" && (state === "ready" ? grant.reset_available === true && reason === "" : grant.reset_available === false && (state === "read_only" ? readOnlyReason : reason === state));
  return { poolID, known, eligible: known && grant.eligible === true, observedAt: known ? observedAt : null, remaining, expiresAt: expirySet && !expiryInvalid ? parsedExpiry : null, expiryInvalid, lastResetAt: time(grant.last_reset_at), cooldownCleared: grant.cooldown_cleared === true, upstreamStatus: integer(grant.upstream_status) ? grant.upstream_status : 0, resetAvailable: resetContractKnown && state === "ready" && grant.reset_available === true, resetContractKnown, resetState: state, resetBlockReason: reason };
}
export function spendGrantCanRequest(value: SpendGrantSnapshot, now: number): boolean {
  return value.resetAvailable && value.resetContractKnown && value.resetState === "ready" && value.resetBlockReason === "" && value.known && value.eligible && !value.expiryInvalid && (value.remaining === null || value.remaining > 0) && (value.expiresAt === null || value.expiresAt > now);
}
export function spendGrantAccepted(value: SpendGrantSnapshot): boolean {
  return value.resetContractKnown && value.resetState === "accepted" && value.resetBlockReason === "accepted" && !value.resetAvailable && value.upstreamStatus >= 200 && value.upstreamStatus < 300 && value.cooldownCleared && value.lastResetAt !== null;
}
export function renderSpendGrant(value: SpendGrantSnapshot, words: SpendGrantWords, options: { now: number; formatTime: (time: number) => string; attempted: boolean; accepted: boolean; error: string }): string {
  const states: Record<ResetState, string> = { read_only: words.stateReadOnly, ready: words.stateReady, sending: words.stateSending, unknown: words.stateUnknown, accepted: words.stateAccepted, refused: words.stateRefused };
  const reasons: Record<Exclude<ResetReason, "">, string> = { identity_incomplete: words.identityIncomplete, qualification_unknown: words.qualificationUnknown, not_eligible: words.notEligible, transport_unavailable: words.transportUnavailable, storage_unavailable: words.storageUnavailable, sending: words.sendingBlocked, unknown: words.unknownBlocked, accepted: words.acceptedBlocked, refused: words.refusedBlocked };
  const fields = [
    `${words.recorded}: ${value.known ? value.eligible ? words.eligible : words.ineligible : words.unknown}`,
    ...(value.observedAt !== null ? [`${words.observed}: ${options.formatTime(value.observedAt)}`] : []),
    `${words.remaining}: ${value.known && value.remaining !== null ? value.remaining : words.unknownCount}`,
    ...(value.expiresAt !== null ? [`${words.expires}: ${options.formatTime(value.expiresAt)}`] : []),
    ...(value.lastResetAt !== null ? [`${words.lastReset}: ${options.formatTime(value.lastResetAt)}`] : []),
  ];
  return `<div class="stack" data-spend-grant-status>${fields.map(field => `<p>${escape(field)}</p>`).join("")}<p data-spend-reset-state>${escape(words.resetState)}: ${escape(value.resetState === null ? words.unknownState : states[value.resetState])}</p><p data-spend-reset-reason>${escape(words.resetBlockReason)}: ${escape(value.resetBlockReason === null ? words.unknownState : value.resetBlockReason === "" ? words.noBlockRecorded : reasons[value.resetBlockReason])}</p>${!value.resetContractKnown ? `<p class="note">${escape(words.readOnlyContract)}</p>` : ""}<p class="note">${escape(words.note)}</p>${value.expiresAt !== null && value.expiresAt <= options.now ? `<p class="hint">${escape(words.expired)}</p>` : ""}${options.accepted ? `<p class="note" role="status">${escape(words.accepted)}</p>` : ""}${options.error ? `<p class="err" role="alert">${escape(options.error)}</p>` : ""}<div class="row wrap"><button type="button" class="btn" data-act="close">${escape(words.cancel)}</button><button type="button" class="btn" data-act="spend-grant" data-id="${value.poolID}">${escape(words.refresh)}</button><button type="button" class="btn pri" data-act="spend-grant-reset" ${options.attempted || !spendGrantCanRequest(value, options.now) ? "disabled" : ""}>${escape(words.request)}</button></div></div>`;
}
