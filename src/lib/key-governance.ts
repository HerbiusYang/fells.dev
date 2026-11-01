import type { KeyGovernanceInput } from "./account-api";
import type { KeyGovernanceWords } from "../i18n/key-governance";

// Real-interface adaptation of raydocs/fells.dev#13; no simulated policy state.
export type GovernanceSnapshot = Required<KeyGovernanceInput> & { id: number; used_quota_micros: number; net_used_quota_micros: number | null; inherited_used_quota_micros: number | null; metering_started_at: number | null };
type GovernanceDraft = { quota: string; expiry: string; models: string; cidrs: string };
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const list = (value: unknown): string[] => {
  if (value === undefined) return []; // omitempty server lists mean no key-specific restriction.
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("unavailable");
  return [...value];
};
const amount = (value: number) => { const magnitude = BigInt(value), whole = magnitude / 1_000_000n, fraction = (magnitude % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, ""); return `${whole}${fraction ? "." + fraction : ""}`; };
export function readKeyGovernance(value: unknown, now = Date.now()): GovernanceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("unavailable");
  const key = value as Record<string, unknown>;
  if (!integer(key.id) || key.id === 0 || key.revoked === true) throw new Error("unavailable");
  let source = key;
  if (Object.hasOwn(key, "self_governance")) {
    const own = key.self_governance;
    if (!own || typeof own !== "object" || Array.isArray(own)) throw new Error("unavailable");
    source = own as Record<string, unknown>;
    if (source.key_id !== key.id || !Array.isArray(source.allowed_models) || !Array.isArray(source.allowed_cidrs)) throw new Error("unavailable");
  }
  // New responses separate editable self rules from the effective operator
  // projection. Only an entirely absent nested field permits the legacy shape.
  if (!integer(source.quota_limit_micros) || !integer(source.used_quota_micros) || !integer(source.expires_at) || source.expires_at > 253_402_300_799) throw new Error("unavailable");
  let net = integer(source.net_used_quota_micros) ? source.net_used_quota_micros : null;
  let inherited = integer(source.inherited_used_quota_micros) ? source.inherited_used_quota_micros : null;
  if (net !== null && net > source.used_quota_micros || inherited !== null && inherited > source.used_quota_micros || net !== null && inherited !== null && BigInt(net) + BigInt(inherited) !== BigInt(source.used_quota_micros)) { net = null; inherited = null; }
  const started = integer(source.metering_started_at) && source.metering_started_at > 0 && source.metering_started_at <= 253_402_300_799 && source.metering_started_at * 1000 <= now ? source.metering_started_at : null;
  return { id: key.id, quota_limit_micros: source.quota_limit_micros, used_quota_micros: source.used_quota_micros, net_used_quota_micros: net, inherited_used_quota_micros: inherited, metering_started_at: started, expires_at: source.expires_at, allowed_models: list(source.allowed_models), allowed_cidrs: list(source.allowed_cidrs) };
}
function governanceDraft(value: GovernanceSnapshot | null): GovernanceDraft {
  if (!value) return { quota: "", expiry: "", models: "", cidrs: "" };
  const date = new Date(value.expires_at * 1000), pad = (n: number) => String(n).padStart(2, "0");
  return { quota: amount(value.quota_limit_micros), expiry: value.expires_at ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : "", models: value.allowed_models.join("\n"), cidrs: value.allowed_cidrs.join("\n") };
}
export function parseGovernanceDraft(draft: GovernanceDraft, now: number, baseline?: GovernanceSnapshot): Required<KeyGovernanceInput> {
  const quota = draft.quota.trim();
  if (quota && (!/^\d+(?:\.\d{1,6})?$/.test(quota) || quota.length > 24)) throw new Error("quota");
  const [whole, fraction = ""] = (quota || "0").split(".");
  const micro = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micro > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("quota");
  const expiry = draft.expiry.trim(), expires = expiry ? Date.parse(expiry) : 0;
  if (expiry && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(expiry) || !Number.isFinite(expires) || expires <= now && Math.floor(expires / 1000) !== baseline?.expires_at)) throw new Error("expiry");
  if (expiry) {
    const canonical = governanceDraft({ id: 1, quota_limit_micros: 0, used_quota_micros: 0, net_used_quota_micros: null, inherited_used_quota_micros: null, metering_started_at: null, allowed_models: [], allowed_cidrs: [], expires_at: Math.floor(expires / 1000) }).expiry;
    if (canonical !== (expiry.length === 16 ? expiry + ":00" : expiry)) throw new Error("expiry");
  }
  const rules = (raw: string) => {
    const values = raw.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean);
    if (values.some(value => value.length >= 512 || /[\x00-\x1f\x7f]/.test(value))) throw new Error("list");
    return [...new Set(values)];
  };
  return { quota_limit_micros: Number(micro), expires_at: expires ? Math.floor(expires / 1000) : 0, allowed_models: rules(draft.models), allowed_cidrs: rules(draft.cidrs) };
}
export function governancePatch(value: Required<KeyGovernanceInput>, baseline?: GovernanceSnapshot): KeyGovernanceInput {
  const patch: KeyGovernanceInput = {};
  for (const key of ["quota_limit_micros", "expires_at", "allowed_models", "allowed_cidrs"] as const) {
    const expected = baseline?.[key] ?? (key === "allowed_models" || key === "allowed_cidrs" ? [] : 0);
    if (JSON.stringify(value[key]) !== JSON.stringify(expected)) Object.assign(patch, { [key]: value[key] });
  }
  return patch;
}
export function governanceUnchanged(current: GovernanceSnapshot, baseline: GovernanceSnapshot, patch: KeyGovernanceInput): boolean {
  return current.id === baseline.id && Object.keys(patch).every(key => JSON.stringify(current[key as keyof KeyGovernanceInput]) === JSON.stringify(baseline[key as keyof KeyGovernanceInput]));
}
function governanceApplied(current: GovernanceSnapshot, patch: KeyGovernanceInput): boolean {
  const comparable = (value: unknown) => JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
  return Object.keys(patch).every(key => comparable(current[key as keyof KeyGovernanceInput]) === comparable(patch[key as keyof KeyGovernanceInput]));
}
export function governanceSaveResult(receipt: GovernanceSnapshot, current: GovernanceSnapshot, patch: KeyGovernanceInput): "applied" | "review" {
  const recordedPolicy = { quota_limit_micros: receipt.quota_limit_micros, expires_at: receipt.expires_at, allowed_models: receipt.allowed_models, allowed_cidrs: receipt.allowed_cidrs };
  if (receipt.id !== current.id || !governanceApplied(current, recordedPolicy)) throw new Error("unavailable");
  const otherIntent = { ...patch }; delete otherIntent.allowed_cidrs;
  if (!governanceApplied(current, otherIntent)) throw new Error("unavailable");
  if (governanceApplied(current, patch)) return "applied";
  // The server owns IP parsing. A different recorded string is a review state,
  // not evidence that two networks are equivalent or that the write failed.
  if (patch.allowed_cidrs === undefined) throw new Error("unavailable");
  return "review";
}
export function renderGovernanceReview(input: string, current: GovernanceSnapshot, words: KeyGovernanceWords): string {
  return `<div class="body stack" data-governance-review><h3>${escape(words.reviewTitle)}</h3><p role="status">${escape(words.reviewHint)}</p><section class="card pad"><h4>${escape(words.submittedCIDRs)}</h4><pre class="code" data-governance-submitted style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(input)}</pre></section><section class="card pad"><h4>${escape(words.recordedCIDRs)}</h4><pre class="code" data-governance-recorded style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(current.allowed_cidrs.length ? current.allowed_cidrs.join("\n") : words.noIPRestriction)}</pre></section><p class="note">${escape(words.reviewNoResend)}</p><div class="foot" style="margin:0"><button type="button" class="btn" data-act="close">${escape(words.reviewClose)}</button><button type="button" class="btn pri" data-act="key-governance-use-recorded">${escape(words.reviewUseRecorded)}</button></div></div>`;
}
export function renderGovernanceFields(value: GovernanceSnapshot | null, words: KeyGovernanceWords, locale = "en"): string {
  const draft = governanceDraft(value);
  const metering = value ? `<div class="stack" data-governance-usage><p>${escape(words.used)}: ${escape(amount(value.used_quota_micros))}</p><p data-governance-net>${escape(words.netUsed)}: ${escape(value.net_used_quota_micros === null ? words.unknown : amount(value.net_used_quota_micros))}</p>${value.inherited_used_quota_micros !== 0 ? `<p data-governance-inherited>${escape(words.inheritedUsed)}: ${escape(value.inherited_used_quota_micros === null ? words.unknown : amount(value.inherited_used_quota_micros))}</p>` : ""}${value.inherited_used_quota_micros !== null && value.inherited_used_quota_micros > 0 ? `<p class="note">${escape(words.inheritedHint)}</p>` : ""}<p data-governance-meter-start>${escape(words.meterStarted)}: ${escape(value.metering_started_at === null ? words.unknown : new Date(value.metering_started_at * 1000).toLocaleString(locale))}</p></div>` : "";
  return `${metering}<label class="f">${escape(words.quota)}<input name="governance_quota" type="text" inputmode="decimal" maxlength="24" value="${escape(draft.quota)}" /></label><p class="hint">${escape(words.quotaHint)}</p><label class="f">${escape(words.expiry)}<input name="governance_expiry" type="datetime-local" step="1" value="${escape(draft.expiry)}" /></label><p class="hint">${escape(words.expiryHint)}</p><label class="f">${escape(words.models)}<textarea name="governance_models" rows="3">${escape(draft.models)}</textarea></label><p class="hint">${escape(words.modelsHint)}</p><label class="f">${escape(words.cidrs)}<textarea name="governance_cidrs" rows="3">${escape(draft.cidrs)}</textarea></label><p class="hint">${escape(words.cidrsHint)}</p>`;
}
