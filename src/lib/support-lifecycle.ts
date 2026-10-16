import { supportLifecycleCopy } from "../i18n/support-lifecycle.ts";
import { escapeSupport as esc } from "./support-ui.ts";
import { supportRecoveryCopy } from "../i18n/support-recovery.ts";
export type SupportWaitingOn = "team" | "operator" | "owner" | "finance" | "customer" | "system" | "none";
export interface SupportLifecycle {
  waitingOn?: SupportWaitingOn;
  acceptanceKind?: "" | "customer" | "system_timeout" | "system_no_objection";
  acceptanceDeadline?: string | null;
  disputedAt?: string | null;
  disputeReason?: string;
  closurePolicy?: string;
  rewardPolicy?: string;
  rewardAllowanceMicro?: number;
  rewardStatus?: string;
  rewardReason?: string;
}
export function supportPolicyMarkup(lang: string) {
  const copy = supportLifecycleCopy(lang);
  return `<aside class="support-policy" data-support-policy><strong>${esc(copy.policyTitle)}</strong><p>${esc(copy.policy)}</p></aside>`;
}
function supportWaitingLabel(value: SupportWaitingOn, lang: string) {
  const copy = supportLifecycleCopy(lang);
  return value === "customer" ? copy.customer : value === "none" ? copy.none : copy.team;
}
export function supportLifecycleMarkup(item: SupportLifecycle, lang: string) {
  const copy = supportLifecycleCopy(lang);
  const date = item.acceptanceDeadline ? new Date(item.acceptanceDeadline).toLocaleString(lang, { dateStyle: "medium", timeStyle: "long" }) : "";
  const system = item.acceptanceKind === "system_timeout" || item.acceptanceKind === "system_no_objection";
  const closed = system ? `<div class="support-policy support-policy--closed" data-system-closure><strong>${esc(copy.system)}</strong><p>${esc(copy.systemHint)}</p>${date ? `<p>${esc(copy.deadline)}: <time datetime="${esc(item.acceptanceDeadline!)}">${esc(date)}</time></p>` : ""}</div>` : item.acceptanceKind === "customer" ? `<p class="support-state-tag" data-personal-acceptance>${esc(copy.personal)}</p>` : "";
  const dispute = item.disputedAt ? `<div class="support-policy support-policy--problem" data-dispute-state><strong>${esc(copy.disputed)}</strong>${item.disputeReason ? `<p>${esc(item.disputeReason)}</p>` : ""}</div>` : "";
  const deadline = !closed && !dispute && date ? `<p class="support-deadline" data-acceptance-deadline><b>${esc(copy.deadline)}</b><time datetime="${esc(item.acceptanceDeadline!)}">${esc(date)}</time></p>` : "";
  const reward = (item.rewardAllowanceMicro ?? 0) > 0 ? `<p class="support-reward" data-reward-received><b>${esc(copy.rewardReceived)}</b>: ${esc(new Intl.NumberFormat(lang, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(item.rewardAllowanceMicro! / 1_000_000))}<br/>${esc(copy.rewardRights)} ${esc(copy.rewardRefundPolicy)}</p>` : item.rewardStatus === "monthly_cap_reached" || item.rewardReason === "monthly_cap_reached" ? `<p data-reward-none>${esc(copy.rewardCap)}</p>` : "";
  return `${item.waitingOn ? `<p class="support-state-tag" data-waiting-on="${esc(item.waitingOn)}">${esc(copy.waiting)}: ${esc(supportWaitingLabel(item.waitingOn, lang))}</p>` : ""}${closed}${dispute}${deadline}${reward}`;
}
export function supportDisputeForm(kind: "case" | "order", id: string, lang: string, draft?: { reason: string; unavailable?: boolean }) {
  const copy = supportLifecycleCopy(lang);
  const recovery = supportRecoveryCopy(lang);
  return `<details class="support-dispute" data-dispute ${draft ? "open" : ""}><summary>${esc(copy.problem)}</summary><form data-${kind}-dispute="${esc(id)}">${draft?.unavailable ? `<p role="status">${esc(recovery.disputeUnavailable)}</p>` : ""}<label>${esc(copy.problemReason)}<textarea name="reason" required maxlength="4000" rows="3" ${draft?.unavailable ? "readonly" : ""}>${esc(draft?.reason ?? "")}</textarea></label><button type="submit" ${draft?.unavailable ? "disabled" : ""}>${esc(copy.submitProblem)}</button><button type="button" data-dispute-refresh>${esc(recovery.refreshDispute)}</button><button type="button" data-dispute-cancel>${esc(copy.cancel)}</button></form></details>`;
}
