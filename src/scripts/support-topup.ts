import { creditSupportCash, SupportSessionEnded, type SupportAgent, type SupportConversation } from "../lib/support-service.ts";
import type { SupportTopupInput } from "../lib/support-api.ts";
import { parseCashMicro, microText, storeMoneyIntent } from "../lib/currency-flow.ts";
import { currencyFlowCopy } from "../i18n/currency-flow.ts";
import { escapeSupport as esc } from "../lib/support-ui.ts";
import { APIError } from "../lib/app-http.ts";

export function installSupportTopup(root: HTMLElement, lang: string, refresh: () => Promise<void>, onExpired: () => void) {
  const copy = currencyFlowCopy(lang), lifetime = new AbortController();
  const section = document.createElement("section"); section.className = "support-orders support-cash-topup";
  root.querySelector("[data-support-detail-panel]")!.querySelector(".support-customer-facts")!.insertAdjacentElement("afterend", section);
  let agent: SupportAgent | null = null, customer: SupportConversation | undefined, key = "", busy = false;
  let intent: SupportTopupInput | null = null, review: SupportTopupInput | null = null, message = "";
  const drafts = new Map<string, { amount: string; receipt: string; memo: string }>();
  const validIntent = (value: SupportTopupInput) => value && /^[a-f0-9-]{36}$/.test(value.operationId) && Number.isSafeInteger(value.amountMicro) && value.amountMicro > 0 && typeof value.receiptRef === "string" && !!value.receiptRef.trim() && new TextEncoder().encode(value.receiptRef).length <= 256 && typeof value.memo === "string" && !!value.memo.trim() && new TextEncoder().encode(value.memo).length <= 1000;
  function paint() {
    section.hidden = !customer;
    if (!customer) { section.replaceChildren(); return; }
    const draft = drafts.get(key), fixed = intent ?? review;
    section.innerHTML = `<h3>${esc(copy.topup)}</h3><p>${esc(copy.topupHint)}</p><p><b>${esc(copy.customer)}</b>: ${esc(customer.user.name)} · #${esc(customer.user.id)}</p>${fixed ? `<dl class="support-case-receipt"><dt>${esc(copy.amount)}</dt><dd>CNY ${esc(microText(fixed.amountMicro))}</dd><dt>${esc(copy.receipt)}</dt><dd>${esc(fixed.receiptRef)}</dd><dt>${esc(copy.memo)}</dt><dd>${esc(fixed.memo)}</dd><dt>${esc(copy.operation)}</dt><dd>${esc(fixed.operationId)}</dd></dl>${intent ? `<p role="status">${esc(copy.pending)}</p>` : ""}<button type="button" data-cash-confirm class="support-primary-button">${esc(intent ? copy.retry : copy.topupConfirm)}</button>${!intent ? `<button type="button" data-cash-cancel>${esc(copy.cancel)}</button>` : ""}` : `<form data-cash-topup><label>${esc(copy.amount)}<input name="amount" type="text" inputmode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" maxlength="24" required value="${esc(draft?.amount ?? "")}" /></label><label>${esc(copy.receipt)}<input name="receipt" type="text" maxlength="256" required value="${esc(draft?.receipt ?? "")}" /></label><label>${esc(copy.memo)}<textarea name="memo" maxlength="1000" required rows="3">${esc(draft?.memo ?? "")}</textarea></label><button type="submit" class="support-primary-button">${esc(copy.topup)}</button></form>`}<p data-cash-message role="status" class="support-error">${esc(message)}</p>`;
    section.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = busy);
  }
  section.addEventListener("input", () => {
    const form = section.querySelector<HTMLFormElement>("form");
    if (form) { const data = new FormData(form); drafts.set(key, { amount: String(data.get("amount") ?? ""), receipt: String(data.get("receipt") ?? ""), memo: String(data.get("memo") ?? "") }); }
  }, { signal: lifetime.signal });
  section.addEventListener("submit", event => {
    event.preventDefault(); const form = event.target as HTMLFormElement;
    if (busy || !agent || !customer || !form.reportValidity() || intent) return;
    if (!key) { message = copy.storage; paint(); return; }
    const data = new FormData(form), amount = parseCashMicro(String(data.get("amount") ?? ""));
    const proposed = { operationId: crypto.randomUUID(), amountMicro: amount ?? 0, receiptRef: String(data.get("receipt") ?? "").trim(), memo: String(data.get("memo") ?? "").trim() };
    if (!validIntent(proposed)) { message = copy.invalid; paint(); return; }
    review = proposed; message = ""; paint();
  }, { signal: lifetime.signal });
  section.addEventListener("click", async event => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || busy || !agent || !customer) return;
    if (button.hasAttribute("data-cash-cancel")) { review = null; paint(); return; }
    if (!button.hasAttribute("data-cash-confirm") || !key) return;
    if (!intent) {
      if (!review) return;
      try { storeMoneyIntent(key, review); } catch { message = copy.storage; paint(); return; }
      intent = review;
    }
    const activeKey = key, activeAgent = agent, activeCustomer = customer, payload = intent;
    busy = true; paint();
    try {
      const result = await creditSupportCash(activeAgent.session, activeCustomer.id, payload);
      // Clear the exact committed intent even if selection changed while waiting.
      try { sessionStorage.removeItem(activeKey); } catch { /* Server deduplication remains authoritative. */ }
      drafts.delete(activeKey);
      if (key !== activeKey || agent !== activeAgent) return;
      intent = null; review = null;
      message = `${copy.credited}: CNY ${microText(result.creditedCashMicro)} · ${copy.ledger}: #${result.ledgerId}`;
      await refresh();
    } catch (failure) {
      if (failure instanceof SupportSessionEnded) { onExpired(); return; }
      if (key !== activeKey || agent !== activeAgent) return;
      // A rejected validation is definitive. Network/5xx/unknown results keep
      // their immutable UUID and payload, including across a page reload.
      if (failure instanceof APIError && (failure.transactionRejected || [400, 422].includes(failure.status))) {
        try { sessionStorage.removeItem(activeKey); } catch { /* Intent is retained server-side if necessary. */ }
        intent = null; review = null; message = failure.message;
      } else message = copy.pending;
    } finally { if (key === activeKey && agent === activeAgent) { busy = false; paint(); } }
  }, { signal: lifetime.signal });
  return {
    setContext(nextAgent: SupportAgent | null, nextCustomer: SupportConversation | undefined) {
      const nextKey = nextAgent?.id && nextAgent.fingerprint && nextCustomer ? `fells.support.cash.v1:${nextAgent.id}:${nextAgent.fingerprint}:${nextCustomer.id}` : "";
      agent = nextAgent; customer = nextCustomer;
      if (nextKey === key) return;
      key = nextKey; intent = null; review = null; message = ""; busy = false;
      if (key) try { const stored = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (validIntent(stored)) intent = stored; } catch { /* A submission requires functioning storage. */ }
      paint();
    },
    dispose() { lifetime.abort(); drafts.clear(); section.remove(); agent = null; customer = undefined; },
  };
}
