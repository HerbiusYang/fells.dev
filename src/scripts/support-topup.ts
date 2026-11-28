import { creditSupportCash, sendAgentMessage, SupportSessionEnded, type SupportAgent, type SupportConversation } from "../lib/support-service.ts";
import type { SupportTopupInput } from "../lib/support-api.ts";
import { parseCashMicro, microText, storeMoneyIntent } from "../lib/currency-flow.ts";
import { currencyFlowCopy } from "../i18n/currency-flow.ts";
import { escapeSupport as esc, supportRequestError } from "../lib/support-ui.ts";
import { APIError } from "../lib/app-http.ts";
import { installFieldValidation, validateFields } from "../lib/field-validation.ts";
import { isBusinessBlocked, subscribeMaintenance } from "../lib/maintenance.ts";
import { createSupportCustomerDialog } from "./support-customer-dialog.ts";
import { supportOrdersCopy } from "../i18n/support-orders.ts";

export function installSupportTopup(root: HTMLElement, lang: string, refresh: () => Promise<void>, onExpired: () => void) {
  installFieldValidation();
  const copy = currencyFlowCopy(lang), lifetime = new AbortController();
  const trigger = root.querySelector<HTMLButtonElement>("[data-support-cash-open]")!;
  const modal = createSupportCustomerDialog(root, "cash", copy.topup, supportOrdersCopy(lang).close);
  const section = modal.body;
  let agent: SupportAgent | null = null, customer: SupportConversation | undefined, key = "", busy = false;
  let intent: SupportTopupInput | null = null, review: SupportTopupInput | null = null, message = "", messageKind: "error" | "success" | "info" = "error";
  const drafts = new Map<string, { amount: string; receipt: string; memo: string }>();
  const validIntent = (value: SupportTopupInput) => value && /^[a-f0-9-]{36}$/.test(value.operationId) && Number.isSafeInteger(value.amountMicro) && value.amountMicro > 0 && typeof value.receiptRef === "string" && !!value.receiptRef.trim() && new TextEncoder().encode(value.receiptRef).length <= 256 && typeof value.memo === "string" && !!value.memo.trim() && new TextEncoder().encode(value.memo).length <= 1000;
  function controls() {
    const unavailable = busy || isBusinessBlocked();
    section.querySelectorAll<HTMLButtonElement>("button").forEach(button => { button.disabled = unavailable; });
    section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach(field => { field.readOnly = unavailable; });
  }
  const unsubscribe = subscribeMaintenance(controls);
  function paint() {
    if (!customer) { modal.context.textContent = ""; section.replaceChildren(); return; }
    modal.context.textContent = `${customer.user.name} · #${customer.user.id}`;
    const draft = drafts.get(key), fixed = intent ?? review;
    section.innerHTML = `<p class="support-customer-dialog-hint">${esc(copy.topupHint)}</p>${fixed ? `<dl class="support-case-receipt"><dt>${esc(copy.receivedAmount)}</dt><dd>CNY ${esc(microText(fixed.amountMicro))}</dd><dt>${esc(copy.receipt)}</dt><dd>${esc(fixed.receiptRef)}</dd><dt>${esc(copy.memo)}</dt><dd>${esc(fixed.memo)}</dd><dt>${esc(copy.operation)}</dt><dd>${esc(fixed.operationId)}</dd></dl>${intent ? `<p role="status">${esc(copy.pending)}</p>` : ""}<div class="support-customer-dialog-actions"><button type="button" data-cash-confirm class="support-primary-button">${esc(intent ? copy.retry : copy.topupConfirm)}</button>${!intent ? `<button type="button" data-cash-cancel>${esc(copy.cancel)}</button>` : ""}</div>` : `<form data-cash-topup><label>${esc(copy.receivedAmount)}<input name="amount" type="text" inputmode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" maxlength="24" required value="${esc(draft?.amount ?? "")}" /></label><label>${esc(copy.receipt)}<input name="receipt" type="text" maxlength="256" required value="${esc(draft?.receipt ?? "")}" /></label><label>${esc(copy.memo)}<textarea name="memo" maxlength="1000" required rows="3">${esc(draft?.memo ?? "")}</textarea></label><button type="submit" class="support-primary-button">${esc(copy.topup)}</button></form>`}<p data-cash-message role="status" tabindex="-1" data-kind="${messageKind}" class="support-error${messageKind === "success" ? " is-success" : messageKind === "info" ? " is-info" : ""}">${esc(message)}</p>`;
    controls();
  }
  section.addEventListener("input", () => {
    const form = section.querySelector<HTMLFormElement>("form");
    if (form) { const data = new FormData(form); drafts.set(key, { amount: String(data.get("amount") ?? ""), receipt: String(data.get("receipt") ?? ""), memo: String(data.get("memo") ?? "") }); }
  }, { signal: lifetime.signal });
  section.addEventListener("submit", event => {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (busy || !modal.open || isBusinessBlocked() || !agent || !customer || !validateFields(form) || intent) return;
    if (!key) { messageKind = "error"; message = copy.storage; paint(); return; }
    const data = new FormData(form), amount = parseCashMicro(String(data.get("amount") ?? ""));
    const proposed = { operationId: crypto.randomUUID(), amountMicro: amount ?? 0, receiptRef: String(data.get("receipt") ?? "").trim(), memo: String(data.get("memo") ?? "").trim() };
    if (!validIntent(proposed)) { messageKind = "error"; message = copy.invalid; paint(); return; }
    review = proposed; message = ""; messageKind = "error"; paint();
    section.querySelector<HTMLElement>("[data-cash-confirm]")?.focus({ preventScroll: true });
  }, { signal: lifetime.signal });
  section.addEventListener("click", async event => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || busy || !modal.open || isBusinessBlocked() || !agent || !customer) return;
    if (button.hasAttribute("data-cash-cancel")) { review = null; paint(); section.querySelector<HTMLElement>("[name=amount]")?.focus({ preventScroll: true }); return; }
    if (!button.hasAttribute("data-cash-confirm") || !key) return;
    if (!intent) {
      if (!review) return;
      try { storeMoneyIntent(key, review); } catch { messageKind = "error"; message = copy.storage; paint(); return; }
      intent = review;
    }
    const activeKey = key, activeAgent = agent, activeCustomer = customer, payload = intent;
    busy = true; paint(); modal.focusClose();
    try {
      const result = await creditSupportCash(activeAgent.session, activeCustomer.id, payload);
      // Clear the exact committed intent even if selection changed while waiting.
      try { sessionStorage.removeItem(activeKey); } catch { /* Server deduplication remains authoritative. */ }
      drafts.delete(activeKey);
      if (key !== activeKey || agent !== activeAgent) return;
      intent = null; review = null;
      messageKind = "success";
      message = `${copy.credited}: CNY ${microText(result.creditedCashMicro)} · ${supportOrdersCopy(lang).payment}: #${result.topupId} · ${copy.ledger}: #${result.ledgerId}`;
      // Tell the customer, in their language, how to turn the CNY into API
      // allowance. The credit is already committed; a failed notice only
      // asks the operator to tell the customer by hand.
      const notice = currencyFlowCopy(activeCustomer.user.locale || "en").topupNotice.replace("{amount}", microText(result.creditedCashMicro));
      try { await sendAgentMessage(activeAgent.session, activeCustomer.id, notice); }
      catch (failure) {
        if (failure instanceof SupportSessionEnded) { onExpired(); return; }
        if (key === activeKey && agent === activeAgent) { messageKind = "info"; message += ` · ${copy.noticeFailed}`; }
      }
      await refresh();
    } catch (failure) {
      if (failure instanceof SupportSessionEnded) { onExpired(); return; }
      if (key !== activeKey || agent !== activeAgent) return;
      // A rejected validation is definitive. Network/5xx/unknown results keep
      // their immutable UUID and payload, including across a page reload.
      if (failure instanceof APIError && (failure.transactionRejected || [400, 422].includes(failure.status))) {
        try { sessionStorage.removeItem(activeKey); } catch { /* Intent is retained server-side if necessary. */ }
        intent = null; review = null; messageKind = "error"; message = supportRequestError(failure, lang, copy.invalid);
      } else { messageKind = "info"; message = copy.pending; }
    } finally {
      if (key === activeKey && agent === activeAgent) {
        busy = false; paint();
        if (modal.open && message) section.querySelector<HTMLElement>("[data-cash-message]")?.focus({ preventScroll: true });
      }
    }
  }, { signal: lifetime.signal });
  trigger.addEventListener("click", () => {
    if (key && customer && !isBusinessBlocked()) modal.show(trigger);
  }, { signal: lifetime.signal });
  return {
    setContext(nextAgent: SupportAgent | null, nextCustomer: SupportConversation | undefined) {
      const nextKey = nextAgent?.id && nextAgent.fingerprint && nextCustomer && !nextCustomer.demo ? `fells.support.cash.v1:${nextAgent.id}:${nextAgent.fingerprint}:${nextCustomer.id}` : "";
      agent = nextAgent; customer = nextCustomer;
      trigger.hidden = !nextKey;
      if (nextKey === key) { if (customer) modal.context.textContent = `${customer.user.name} · #${customer.user.id}`; return; }
      modal.close(false);
      key = nextKey; intent = null; review = null; message = ""; messageKind = "error"; busy = false;
      if (key) try { const stored = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (validIntent(stored)) intent = stored; } catch { /* A submission requires functioning storage. */ }
      paint();
    },
    dispose() { lifetime.abort(); unsubscribe(); drafts.clear(); modal.dispose(); agent = null; customer = undefined; },
  };
}
