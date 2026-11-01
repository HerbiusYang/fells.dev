import type { SubscriptionOverviewWords } from "../i18n/subscription-overview";

// Selective adaptation of raydocs/fells.dev#14 (281eda05ec5a6e6520270c56fd76d5acd5bd92af).
// Only render server-owned rides[].overview; opening details never selects a ride.
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const timestamp = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000 ? value * 1000 : null;

export function renderSubscriptionOverview(value: unknown, words: SubscriptionOverviewWords, options: { locale: string; now: number; formatTime: (time: number) => string }): string {
  const overview = record(value);
  // Older servers and single-subscription responses omit this optional panel.
  if (!overview) return "";
  const knownStates = ["ready", "tight", "full", "scoped_full", "pending", "unknown"] as const;
  const state = knownStates.find(state => state === overview.state) ?? "unknown";
  const readAt = timestamp(overview.read_at);
  const readingTime = readAt !== null && readAt <= options.now ? `${words.recordedAt}: ${options.formatTime(readAt)}` : words.timeUnavailable;
  const percent = new Intl.NumberFormat(options.locale, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const windows = Array.isArray(overview.windows) ? overview.windows.map(record).filter((window): window is Record<string, unknown> => window !== null) : [];
  const items = windows.map(window => {
    const label = typeof window.scope === "string" && window.scope.trim() ? window.scope
      : window.window_minutes === 300 ? words.fiveHours : window.window_minutes === 10080 ? words.weekly
      : typeof window.kind === "string" && window.kind.trim() ? window.kind : words.window;
    const resetAt = timestamp(window.reset_at);
    const serverReset = window.reset === true;
    // A local clock passing a predicted time is not proof the provider reset.
    // Both cases hide the obsolete percentage; their explanations stay distinct.
    const expectedResetPassed = resetAt !== null && resetAt <= options.now;
    // The server has already combined account limits with the customer's share.
    // Do not divide used_pct by the subscription tier or infer it from other counters.
    const reported = typeof window.used_pct === "number" && Number.isFinite(window.used_pct) && window.used_pct >= 0 && window.used_pct <= 100;
    const used = !serverReset && !expectedResetPassed && reported ? percent.format((window.used_pct as number) / 100) : "—";
    const note = serverReset ? words.serverReset : expectedResetPassed ? words.expectedResetPassed
      : resetAt !== null ? `${words.resets}: ${options.formatTime(resetAt)}` : "";
    return `<li><b>${escape(label)}</b><small>${escape(words.used)}: <span data-subscription-used>${escape(used)}</span>${used === "—" && !note ? ` · ${escape(words.unavailable)}` : ""}</small>${note ? `<small>${escape(note)}</small>` : ""}</li>`;
  }).join("");
  return `<details class="card pad" data-subscription-overview style="margin-top:10px;overflow-wrap:anywhere"><summary style="cursor:pointer;font-weight:600">${escape(words.details)}</summary><p class="hint">${escape(words.recordedStatus)}: ${escape(words.states[state])}<br />${escape(readingTime)}</p>${items ? `<ul class="stack" style="margin:10px 0 0;padding-inline-start:20px">${items}</ul>` : `<p class="hint">${escape(words.unavailable)}</p>`}</details>`;
}
