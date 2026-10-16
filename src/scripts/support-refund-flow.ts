import type { SupportCase } from "../lib/support-cases.ts";
import { setSupportRefundPlan, recordSupportRefundChannel, reviewSupportRefundChannel, reverseSupportCase } from "../lib/support-service.ts";
import { supportLifecycleCopy } from "../i18n/support-lifecycle.ts";
import { escapeSupport as esc } from "../lib/support-ui.ts";
const text = (name: string, label: string, value = "", extra = "") => `<label>${esc(label)}<input name="${name}" value="${esc(value)}" maxlength="255" ${extra}/></label>`;
export function supportRefundMarkup(item: SupportCase, lang: string, audience: "customer" | "operator", operatorId: string, evidence: (prefix: string, message?: string | null, attachment?: string | null) => string) {
  const copy = supportLifecycleCopy(lang), refund = item.refund;
  const stage = (value: string | undefined) => value === "paid" ? copy.verified : value === "failed" ? copy.transferFailed : value === "unknown" ? copy.unknown : copy.pending;
  const reversed = item.status === "reversed" || item.reversedAt || refund?.reversedAt;
  const identityLocked=refund?.refundId?"required readonly":"required";
  const summary = item.caseType === "refund" ? `<dl class="support-refund-stages" data-refund-stages><div><dt>${esc(copy.ledger)}</dt><dd>${esc(reversed ? copy.reversed : item.executedAt ? copy.executed : copy.pending)}</dd></div><div><dt>${esc(copy.channel)}</dt><dd>${esc(stage(refund?.stage))}${refund?.claimedStage && !refund.reviewedBy ? ` · ${esc(copy.submitted)}` : ""}${refund?.refundId ? `<br/>${esc(copy.transferRef)}: ${esc(refund.refundId)}` : ""}</dd></div></dl>${refund?.plan?`<p data-customer-recovery><b>${esc(copy.recovery)}</b>: ${esc(refund.plan.mode==="waive"?copy.waive:refund.plan.mode==="remaining"?copy.remaining:copy.recoveryPlan)}</p>`:""}<p>${esc(copy.ledgerHint)}</p>${(refund?.recovery?.lossCashMicro??0)>0?`<p data-recovery-loss>${esc(copy.recoveryLoss)}: ${esc(new Intl.NumberFormat(lang,{style:"currency",currency:"CNY"}).format(refund!.recovery!.lossCashMicro!/1_000_000))}</p>`:""}` : "";
  const link = item.reversalRef || refund?.reversalRef;
  const reversal = link ? `<p data-reversal-link><b>${esc(copy.reversed)}</b>: ${esc(link)}</p>` : "";
  if (audience === "customer" || reversed) return `${summary}${reversal}`;
  const base = `<input type="hidden" name="version" value="${item.version}"/>`;
  const note = (name = "note", value = "") => `<label>${esc(copy.actionNote)}<textarea name="${name}" required maxlength="4000" rows="3">${esc(value)}</textarea></label>`;
  let body = "";
  if (item.caseType === "refund") {
    const plan = refund?.plan;
    body += `<details ${!item.executedAt ? "open" : ""}><summary>${esc(copy.recovery)}</summary><p>${esc(copy.approveHint)}</p>${plan ? `<p>${esc(plan.mode === "waive" ? copy.waive : plan.mode === "remaining" ? copy.remaining : copy.recoveryPlan)} · ${esc(plan.approvedAt ? copy.approved : copy.pending)}</p><p>${esc(plan.reason)}</p>` : ""}`;
    if (!item.executedAt) {
      body += `<form data-refund-action="plan" data-case="${esc(item.id)}">${base}<label>${esc(copy.recovery)}<select name="mode"><option value="proportional" ${plan?.mode === "proportional" || !plan ? "selected" : ""}>${esc(copy.recoveryPlan)}</option><option value="remaining" ${plan?.mode === "remaining" ? "selected" : ""}>${esc(copy.remaining)}</option><option value="waive" ${plan?.mode === "waive" ? "selected" : ""}>${esc(copy.waive)}</option></select></label>${note("reason", plan?.reason)}<button type="submit" name="action" value="propose">${esc(copy.proposePlan)}</button>${plan && !plan.approvedAt ? `<button type="submit" name="action" value="approve" ${plan.proposedBy === operatorId ? "disabled" : ""}>${esc(plan.mode === "waive" ? copy.approveWaiver : copy.approve)}</button>` : ""}</form>`;
    }
    body += `</details>`;
    if (item.executedAt && !reversed && item.status !== "closed") {
      if(refund?.stage!=="paid"||!refund.reviewedBy)body += `<details><summary>${esc(copy.recordTransfer)}</summary><form data-refund-action="channel" data-case="${esc(item.id)}">${base}${text("amountMicro",copy.transferAmount,String(item.refundMicro),'type="hidden"')}<p>${esc(copy.transferAmount)}: ${esc(new Intl.NumberFormat(lang,{style:"currency",currency:"CNY"}).format(item.refundMicro/1_000_000))}</p><label>${esc(copy.channel)}<select name="stage">${["pending", "unknown", "failed", "paid"].map(value => `<option value="${value}" ${value === (refund?.claimedStage || refund?.stage) ? "selected" : ""}>${esc(value === "paid" ? copy.recordTransfer : stage(value))}</option>`).join("")}</select></label>${text("provider", copy.provider, refund?.provider, identityLocked)}${text("account", copy.account, refund?.account, identityLocked)}${text("refundId", copy.transferRef, refund?.refundId, identityLocked)}${refund?.refundId?`<p>${esc(copy.channelFrozen)}</p>`:""}${evidence("refundChannel", item.refundProofMessageId, item.refundProofAttachmentId)}${note()}<button type="submit">${esc(copy.recordTransfer)}</button></form></details>`;
      if (refund?.claimedStage && (!refund.reviewedBy || refund.stage !== refund.claimedStage)) body += `<details open><summary>${esc(copy.reviewTransfer)}</summary><p>${esc(copy.reviewHint)}</p><form data-refund-action="review" data-case="${esc(item.id)}">${base}${note()}<button type="submit" ${operatorId === refund.executedBy || operatorId === refund.recordedBy ? "disabled" : ""}>${esc(copy.reviewTransfer)}</button></form></details>`;
    }
  }
  if (item.executedAt && !reversed) body += `<details><summary>${esc(copy.reverse)}</summary><form data-refund-action="reverse" data-case="${esc(item.id)}">${base}${note("reason")}${evidence("reverse")}<label class="support-order-check"><input type="checkbox" name="acceptRewardLoss"/>${esc(copy.acceptRewardLoss)}</label><button type="submit" ${item.caseType === "refund" && refund?.stage !== "failed" ? "disabled" : ""}>${esc(copy.reverse)}</button></form></details>`;
  return `${summary}${reversal}${body ? `<section class="support-refund-flow" data-refund-flow><h4>${esc(copy.refundAction)}</h4>${body}</section>` : ""}`;
}
export async function submitSupportRefundAction(form: HTMLFormElement, session: string, submitter: HTMLElement | null) {
  const data = new FormData(form), version = Number(data.get("version")), id = form.dataset.case!;
  const value = (name: string) => String(data.get(name) ?? "");
  switch (form.dataset.refundAction) {
    case "plan": return setSupportRefundPlan(session, id, { version, action: submitter?.getAttribute("value") === "approve" ? "approve" : "propose", mode: value("mode") as "proportional" | "remaining" | "waive", reason: value("reason") });
    case "channel": return recordSupportRefundChannel(session, id, { version, amountMicro: Number(value("amountMicro")), currency: "CNY", stage: value("stage") as "pending" | "unknown" | "failed" | "paid", provider: value("provider"), account: value("account"), refundId: value("refundId"), note: value("note"), proofMessageId: value("refundChannelMessageId") || null, proofAttachmentId: value("refundChannelAttachmentId") || null });
    case "review": return reviewSupportRefundChannel(session, id, version, value("note"));
    case "reverse": return reverseSupportCase(session, id, { acceptRewardLoss: data.get("acceptRewardLoss")==="on", version, reason: value("reason"), evidenceMessageId: value("reverseMessageId") || null, evidenceAttachmentId: value("reverseAttachmentId") || null });
    default: throw new Error("Unknown refund action");
  }
}
