import { listSupportOrders, getSupportOrder, listSupportOperators, createSupportOrder, updateSupportOrder, acceptSupportOrder, getSupportCatalog, listSupportOperations, getSupportOperation, reconcileSupportOperation, listSupportCases, disputeSupportOrder, requoteSupportOrder, confirmSupportOrderQuote, getSupportCompensationReport, SupportSessionEnded } from "../lib/support-service.ts";
import { supportLifecycleCopy } from "../i18n/support-lifecycle.ts";
import { supportLifecycleMarkup, supportPolicyMarkup, supportDisputeForm } from "../lib/support-lifecycle.ts";
import { supportQuoteMarkup } from "./support-order-quote.ts";
import { APIError } from "../lib/app-http.ts";
import type { SupportOrder, SupportOrderCreate, SupportOrderPatch, SupportOperation, SupportCatalog } from "../lib/support-orders.ts";
import type { SupportCase } from "../lib/support-cases.ts";
import type { SupportOperatorDto } from "../lib/support-api.ts";
import { supportOrdersCopy, orderStatuses } from "../i18n/support-orders.ts";
import { escapeSupport as esc } from "../lib/support-ui.ts";
import { installSupportCases } from "./support-cases.ts";
import type { SupportMessage } from "../lib/support-store.ts";
import { supportCasesCopy } from "../i18n/support-cases.ts";

type Context = { session: string; conversationId: string; userId: string; userName: string; operatorId: string; messages: SupportMessage[] };
const money = (value: number, lang: string) => new Intl.NumberFormat(lang, { style: "currency", currency: "CNY", maximumFractionDigits: 6 }).format(value / 1_000_000);
const input = (name: string, label: string, type = "text", extra = "") => `<label>${esc(label)}<input name="${name}" type="${type}" ${extra}/></label>`;
const localTime = (value: string | null) => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";

export function installSupportOrders(root: HTMLElement, lang: string, selectConversation: (id: string) => Promise<void>, onSessionEnded: () => void) {
  const copy = supportOrdersCopy(lang), life = supportLifecycleCopy(lang);
  const caseCopy = supportCasesCopy(lang);
  const lifecycle = new AbortController();
  const panel = root.querySelector<HTMLElement>("[data-support-detail-panel]")!;
  const section = document.createElement("section"); section.className = "support-orders";
  section.innerHTML = `<h3>${esc(copy.orders)}</h3><button type="button" class="support-secondary-button" data-order-new>${esc(copy.newOrder)}</button><p data-order-error role="status" class="support-error"></p><div data-order-list></div><div data-order-editor></div>`;
  panel.append(section);
  const cases = installSupportCases(section, lang, "operator", onSessionEnded);
  const actions = root.querySelector<HTMLElement>(".support-topbar-actions")!;
  const queueButton = document.createElement("button"); queueButton.className = "support-secondary-button"; queueButton.textContent = copy.queue; queueButton.type = "button"; queueButton.dataset.ordersQueue = "";
  const pendingButton = document.createElement("button"); pendingButton.className = "support-secondary-button"; pendingButton.textContent = copy.pending; pendingButton.type = "button"; pendingButton.dataset.operationsQueue = "";
  actions.prepend(queueButton, pendingButton);
  const dialog = document.createElement("dialog"); dialog.className = "support-work-dialog";
  dialog.innerHTML = `<header><h2 data-work-title></h2><button type="button" data-work-close aria-label="${esc(copy.close)}">×</button></header><div class="support-work-controls"><select data-work-status aria-label="${esc(copy.details)}"><option value="">${esc(copy.all)}</option>${orderStatuses.map(status => `<option value="${status}">${esc(copy.statuses[status])}</option>`).join("")}</select><select data-work-owner aria-label="${esc(copy.assignee)}"></select><label><input type="checkbox" data-work-overdue/> ${esc(copy.overdue)}</label><button type="button" data-work-refresh>${esc(copy.refresh)}</button></div><p data-work-error class="support-error" role="status"></p><p data-work-sort>${esc(life.dueFirst)}</p><div data-work-list></div><div data-work-detail></div>`;
  root.append(dialog);
  const waiting = document.createElement("select"); waiting.dataset.workWaiting = ""; waiting.setAttribute("aria-label", life.waiting); waiting.innerHTML = `<option value="">${esc(life.everyone)}</option><option value="team">${esc(life.team)}</option><option value="customer">${esc(life.customer)}</option><option value="none">${esc(life.none)}</option>`; dialog.querySelector(".support-work-controls")!.prepend(waiting);
  const reportButton = document.createElement("button"); reportButton.type = "button"; reportButton.dataset.workReport = ""; reportButton.textContent = life.report; dialog.querySelector(".support-work-controls")!.append(reportButton);
  const reportMonth = document.createElement("input"); reportMonth.type = "month"; reportMonth.dataset.workMonth = ""; const monthParts=new Intl.DateTimeFormat("en",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit"}).formatToParts(new Date()); reportMonth.value = `${monthParts.find(part=>part.type==="year")!.value}-${monthParts.find(part=>part.type==="month")!.value}`; reportMonth.setAttribute("aria-label", life.month); reportMonth.hidden = true; dialog.querySelector(".support-work-controls")!.append(reportMonth);
  let context: Context | null = null, operators: SupportOperatorDto[] = [], orders: SupportOrder[] = [], editId = "", creating = false, dirty = false, busy = false, generation = 0, loaded = false;
  let mode: "orders" | "operations" | "cases" | "report" = "orders", caseQueueDepth = 1, queueGeneration = 0, orderQueueDepth = 1, orderListDepth = 1;
  let orderQueueCursor: string | null = null, orderListCursor: string | null = null;
  let caseQueueCursor: string | null = null;
  const caseQueueButton = document.createElement("button"); caseQueueButton.type = "button"; caseQueueButton.dataset.workCases = ""; caseQueueButton.textContent = caseCopy.cases; dialog.querySelector(".support-work-controls")!.append(caseQueueButton);
  let catalog: SupportCatalog = { subscriptions: [], tokenPlans: [], allowance: { priceCny: null } };
  const drafts = new Map<string, Record<string, string>>();
  const orderBaselines = new Map<string, SupportOrder>();
  let editorBaseline: SupportOrder | null = null;
  const createIds = new Map<string, string>();
  const createPayloads = new Map<string, SupportOrderCreate>();
  const list = section.querySelector<HTMLElement>("[data-order-list]")!, editor = section.querySelector<HTMLElement>("[data-order-editor]")!, error = section.querySelector<HTMLElement>("[data-order-error]")!;
  const workError = dialog.querySelector<HTMLElement>("[data-work-error]")!, workList = dialog.querySelector<HTMLElement>("[data-work-list]")!, workDetail = dialog.querySelector<HTMLElement>("[data-work-detail]")!;
  const draftKey = () => context ? `${context.conversationId}:${creating ? "new" : editId}` : "";
  const capture = () => { const form = editor.querySelector<HTMLFormElement>("form"); if (form && context) { drafts.set(draftKey(), Object.fromEntries(new FormData(form).entries()) as Record<string, string>); if(editorBaseline&&!orderBaselines.has(draftKey()))orderBaselines.set(draftKey(),editorBaseline); } };
  const fail = (failure: unknown, target = error) => { if (failure instanceof SupportSessionEnded) onSessionEnded(); else target.textContent = failure instanceof APIError ? failure.message : copy.error; };
  const ownerOptions = (selected = "") => `<option value="">${esc(copy.unassigned)}</option>${operators.map(op => `<option value="${esc(op.id)}" ${op.id === selected ? "selected" : ""}>${esc(op.name)}</option>`).join("")}`;
  const history = (order: SupportOrder) => `<details><summary>${esc(copy.history)}</summary><ol>${order.history.map(item => `<li><time>${esc(new Date(item.createdAt).toLocaleString(lang))}</time> · ${esc(item.actorName)}<p>${esc(item.note)}</p></li>`).join("")}</ol></details>`;
  const orderSummary = (order: SupportOrder) => `${supportLifecycleMarkup(order,lang)}${order.openCaseCount ? `<p>${esc(life.openCases)}: ${order.openCaseCount}</p>` : ""}${order.afterSalesStatus && order.afterSalesStatus !== "none" ? `<p>${esc(life.afterSales)}: ${esc(order.afterSalesStatus === "settled" ? life.settled : order.afterSalesStatus === "needs_review" ? copy.statuses.needs_review : life.pending)}</p>` : ""}${(order.refundedMicro ?? 0) > 0 || (order.refundPendingMicro ?? 0) > 0 ? `<p>${esc(life.refunded)}: ${esc(money(order.refundedMicro ?? 0,lang))} · ${esc(life.refundPending)}: ${esc(money(order.refundPendingMicro ?? 0,lang))}</p>` : ""}`;
  const card = (order: SupportOrder, queue = false) => `<article class="support-order-card" data-order-id="${esc(order.id)}"><div><strong>#${esc(order.id)} ${esc(order.title)}</strong><span>${esc(copy.statuses[order.status])}</span></div><p>${esc(money(order.amountMicro, lang))} · ${esc(order.assigneeName || copy.unassigned)}${order.dueAt ? ` · ${esc(new Date(order.dueAt).toLocaleString(lang))}` : ""}</p>${orderSummary(order)}<button type="button" data-${queue ? "queue" : "order"}-edit="${esc(order.id)}" ${queue ? `data-conversation-id="${esc(order.conversationId)}"` : ""}>${esc(copy.details)}</button></article>`;
  function paintEditor() {
    const current = orderBaselines.get(draftKey()) ?? orders.find(order => order.id === editId);
    editorBaseline=current??null;
    if (!context || !creating && !current) { editor.replaceChildren(); cases.setContext(null); return; }
    cases.setContext(current ? { session: context.session, conversationId: context.conversationId, order: current, messages: context.messages, operators, operatorId: context.operatorId } : null);
    const editable = !current || ["quoted", "awaiting_payment"].includes(current.status) && !current.paymentTopupId;
    editor.innerHTML = `<form data-order-form><h4>${esc(current ? `#${current.id} ${current.title}` : copy.newOrder)}</h4>${input("title", copy.title, "text", `required maxlength="200" ${editable ? "" : "disabled"}`)}<label>${esc(copy.product)}<select name="product" ${editable ? "" : "disabled"}>${Object.entries(copy.products).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join("")}</select></label>${input("amount", copy.amount, "number", `required min="0.000001" step="0.000001" ${editable ? "" : "disabled"}`)}${input("serviceDays", copy.days, "number", `required min="0" max="3660" step="1" ${editable ? "" : "disabled"}`)}${input("dueAt", copy.due, "datetime-local")}${current ? `<label>${esc(copy.assignee)}<select name="assigneeId">${ownerOptions(current.assigneeId)}</select></label><button type="button" data-order-claim>${esc(copy.claim)}</button><label>${esc(copy.details)}<select name="status">${orderStatuses.map(status => `<option value="${status}" ${status === current.status ? "selected" : ""}>${esc(copy.statuses[status])}</option>`).join("")}</select></label>${input("paymentTopupId", copy.payment, "text", "inputmode='numeric' pattern='[1-9][0-9]*'")}${input("subscriptionId", copy.subscription, "text", "inputmode='numeric' pattern='[1-9][0-9]*'")}${input("subscriptionRef", copy.subscriptionRef, "text", "maxlength='255'")}${input("allowanceRef", copy.allowanceRef, "text", "maxlength='255'")}<p>${esc(copy.version)} ${current.version}${current.accepted ? ` · ${esc(copy.accepted)}` : ""}</p>` : ""}<label>${esc(copy.note)}<textarea name="note" maxlength="4000" rows="3"></textarea></label><p class="support-order-hint">${esc(copy.publicNote)}</p><button class="support-primary-button" type="submit">${esc(copy.save)}</button>${current?`<p data-order-conflict role="status"></p><button type="button" data-order-reload>${esc(caseCopy.reloadDraft)}</button>`:""}</form>${current ? `${supportQuoteMarkup(current,lang,"operator",context.messages)}${history(current)}` : ""}`;
    const form = editor.querySelector<HTMLFormElement>("form")!;
    const planFields = document.createElement("div"); planFields.className = "support-plan-fields";
    planFields.innerHTML = `<label>${esc(copy.plan)}<select name="plan" ${editable ? "" : "disabled"}><option value=""></option>${catalog.subscriptions.map(plan => `<option value="${plan.poolId}:${plan.tier}">${esc(plan.poolName)} · ${plan.tier} · ${esc(money(plan.monthlyMicro, lang))}</option>`).join("")}</select></label>${input("months", copy.months, "number", `min="1" max="12" step="1" ${editable ? "" : "disabled"}`)}`;
    form.querySelector<HTMLSelectElement>("[name=product]")!.parentElement!.insertAdjacentElement("afterend", planFields);
    const tokenPlanFields = document.createElement("div"); tokenPlanFields.className = "support-token-plan-fields";
    tokenPlanFields.innerHTML = `<label>${esc(copy.tokenPlan)}<select name="planCode" ${editable ? "" : "disabled"}><option value=""></option>${(catalog.tokenPlans ?? []).filter(plan => plan.enabled || plan.code === current?.planCode).map(plan => `<option value="${esc(plan.code)}">${esc(plan.name)} · ${esc(money(plan.priceMicro, lang))} · ${plan.periodDays} ${esc(copy.days)}</option>`).join("")}</select></label>`;
    planFields.insertAdjacentElement("afterend", tokenPlanFields);
    const values = drafts.get(draftKey()) ?? (current ? { ...current, amount: String(current.amountMicro / 1_000_000), serviceDays: String(current.serviceDays), dueAt: localTime(current.dueAt) } : { product: "subscription", amount: "", serviceDays: "30", dueAt: "", title: "", note: "" });
    for (const [name, value] of Object.entries(values)) { const control = form.elements.namedItem(name); if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) control.value = String(value ?? ""); }
    const planSelect = form.querySelector<HTMLSelectElement>("[name=plan]")!, monthInput = form.querySelector<HTMLInputElement>("[name=months]")!;
    planSelect.value = drafts.get(draftKey())?.plan ?? (current?.poolId ? `${current.poolId}:${current.tier}` : catalog.subscriptions[0] ? `${catalog.subscriptions[0].poolId}:${catalog.subscriptions[0].tier}` : "");
    monthInput.value = drafts.get(draftKey())?.months ?? String(current?.months || 1);
    planFields.hidden = form.querySelector<HTMLSelectElement>("[name=product]")!.value !== "subscription";
    const tokenPlanSelect = form.querySelector<HTMLSelectElement>("[name=planCode]")!;
    tokenPlanSelect.value = drafts.get(draftKey())?.planCode ?? current?.planCode ?? "";
    tokenPlanFields.hidden = form.querySelector<HTMLSelectElement>("[name=product]")!.value !== "token_plan";
    form.querySelector<HTMLInputElement>("[name=amount]")!.readOnly = !editable || !tokenPlanFields.hidden;
    form.querySelector<HTMLInputElement>("[name=serviceDays]")!.readOnly = !editable || !tokenPlanFields.hidden;
    if (current?.product === "allowance") form.insertAdjacentHTML("beforeend", `<p>${esc(copy.usd)}: $${esc(String(current.allowanceUsdMicro / 1_000_000))}</p>`);
    if (current?.tokenPlanRef) form.insertAdjacentHTML("beforeend", `<p>${esc(copy.tokenPlanRef)}: ${esc(current.tokenPlanRef)}</p>`);
    if (current) {
      if (current.product === "other") form.insertAdjacentHTML("beforeend", `<p>${esc(copy.manual)}</p>`);
      form.insertAdjacentHTML("beforeend", `<p>${esc(copy.paymentHint)}</p>`);
      if (current.fulfilled) form.insertAdjacentHTML("beforeend", `<p>${esc(copy.fulfilled)}${current.enableApiKeys ? `<br/>✓ ${esc(copy.enableApiKeys)}` : ""}</p>`);
      else if (current.product !== "other" && current.status === "awaiting_fulfillment" && current.paymentTopupId) {
        form.insertAdjacentHTML("beforeend", `<p class="support-order-hint" data-order-activation-hint>${esc(copy.activationCaseHint)}</p>`);
      }
    }
    dirty = drafts.has(draftKey());
  }
  async function refresh() {
    if (!context?.conversationId || busy) return;
    const expected = ++generation, active = context;
    try {
      const orderPages = async (status?: string) => { let cursor: string | undefined; const items: SupportOrder[] = []; for(let depth=0;depth<orderListDepth;depth++){const page=await listSupportOrders("operator",active.session,active.conversationId,{status,cursor});items.push(...page.items);cursor=page.nextCursor??undefined;if(!cursor)break;}return {items,nextCursor:cursor}; };
      const [activePage, page, people, products, detail] = await Promise.all([orderPages("active"), orderPages(), loaded ? Promise.resolve(operators) : listSupportOperators(active.session), loaded ? Promise.resolve(catalog) : getSupportCatalog(active.session), editId ? getSupportOrder("operator", active.session, editId) : Promise.resolve(null)]);
      if (expected !== generation || context !== active) return;
      loaded = true; operators = people; catalog = products;
      const merged = new Map(activePage.items.map(order => [order.id, order])); for (const order of page.items) if (!merged.has(order.id)) merged.set(order.id, order); if (detail?.conversationId === active.conversationId) merged.set(detail.id, detail); orders = [...merged.values()];
      list.innerHTML = orders.length ? orders.map(order => card(order)).join("") : `<p>${esc(copy.empty)}</p>`;
      orderListCursor = activePage.nextCursor ?? page.nextCursor ?? null; if (orderListCursor) list.insertAdjacentHTML("beforeend", `<button type="button" data-order-more>${esc(life.loadOrders)}</button>`);
      const caseOrder = orders.find(order => order.id === editId);
      if (caseOrder) cases.setContext({ session: active.session, conversationId: active.conversationId, order: caseOrder, messages: active.messages, operators, operatorId: active.operatorId });
      if (!dirty) paintEditor(); else { const baseline=orderBaselines.get(draftKey()),latest=orders.find(order=>order.id===editId),hint=editor.querySelector<HTMLElement>("[data-order-conflict]");if(hint)hint.textContent=baseline&&latest&&baseline.version!==latest.version?caseCopy.conflictHint:""; }
    } catch (failure) { if (expected === generation) fail(failure); }
  }
  section.addEventListener("input", event => { if (!(event.target instanceof Element) || !event.target.closest("[data-order-form],[data-order-requote]")) return; dirty = true; capture(); }, { signal: lifecycle.signal });
  section.addEventListener("change", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-order-form],[data-order-requote]")) return;
    const form = editor.querySelector<HTMLFormElement>("form");
    if (form && event.target instanceof HTMLElement && ["product", "plan", "months", "planCode"].includes(event.target.getAttribute("name") ?? "")) {
      const product = form.querySelector<HTMLSelectElement>("[name=product]")!.value;
      form.querySelector<HTMLElement>(".support-plan-fields")!.hidden = product !== "subscription";
      form.querySelector<HTMLElement>(".support-token-plan-fields")!.hidden = product !== "token_plan";
      form.querySelector<HTMLInputElement>("[name=amount]")!.readOnly = product === "token_plan";
      form.querySelector<HTMLInputElement>("[name=serviceDays]")!.readOnly = product === "token_plan";
      if (product === "subscription") { const plan = catalog.subscriptions.find(item => `${item.poolId}:${item.tier}` === form.querySelector<HTMLSelectElement>("[name=plan]")!.value); const months = Number(form.querySelector<HTMLInputElement>("[name=months]")!.value); if (plan) form.querySelector<HTMLInputElement>("[name=amount]")!.value = String(plan.monthlyMicro * months / 1_000_000); form.querySelector<HTMLInputElement>("[name=serviceDays]")!.value = String(30 * months); }
      else if (product === "token_plan") { const plan = (catalog.tokenPlans ?? []).find(item => item.enabled && item.code === form.querySelector<HTMLSelectElement>("[name=planCode]")!.value); form.querySelector<HTMLSelectElement>("[name=planCode]")!.required = true; form.querySelector<HTMLInputElement>("[name=amount]")!.value = plan ? String(plan.priceMicro / 1_000_000) : ""; form.querySelector<HTMLInputElement>("[name=serviceDays]")!.value = plan ? String(plan.periodDays) : ""; }
      else form.querySelector<HTMLInputElement>("[name=serviceDays]")!.value = "0";
      if (product !== "token_plan") form.querySelector<HTMLSelectElement>("[name=planCode]")!.required = false;
    }
    dirty = true; capture();
  }, { signal: lifecycle.signal });
  section.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
    if (!button || busy || !context) return;
    if(button.hasAttribute("data-order-reload")){drafts.delete(draftKey());orderBaselines.delete(draftKey());dirty=false;void refresh();return;}
    if (button.hasAttribute("data-order-more") && orderListCursor) { orderListDepth++; void refresh(); return; }
    if (button.hasAttribute("data-order-new") || button.dataset.orderEdit) { capture(); creating = button.hasAttribute("data-order-new"); editId = button.dataset.orderEdit ?? ""; dirty = false; error.textContent = ""; paintEditor(); }
    if (button.hasAttribute("data-order-claim")) { const own = operators.find(op => op.id === context!.operatorId); const control = editor.querySelector<HTMLSelectElement>("[name=assigneeId]"); if (own && control) { control.value = own.id; dirty = true; capture(); } }
  }, { signal: lifecycle.signal });
  section.addEventListener("submit", async event => {
    const form = event.target as HTMLFormElement;
    if(form.matches('[data-order-requote]')){event.preventDefault();if(!context||busy||!form.reportValidity())return;const active=context,values=new FormData(form);busy=true;generation++;error.textContent='';form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=true);try{await requoteSupportOrder(active.session,form.dataset.orderRequote!,{version:Number(values.get('version')),reason:String(values.get('reason')??''),evidenceMessageId:String(values.get('evidenceMessageId')??'')||null});if(context===active){dirty=false;drafts.delete(draftKey());orderBaselines.delete(draftKey());}}catch(failure){if(context===active)fail(failure);}finally{if(context===active){busy=false;form.querySelectorAll<HTMLButtonElement>('button').forEach(button=>button.disabled=false);await refresh();}}return;}
    if (!form.matches("[data-order-form]")) return; event.preventDefault();
    if (busy || !context || !form.reportValidity()) return;
    capture(); const active = context, wasCreating = creating, id = editId, values = Object.fromEntries(new FormData(form).entries());
    const current = orderBaselines.get(draftKey()) ?? editorBaseline ?? orders.find(order => order.id === id), amount = Number(values.amount) * 1_000_000;
    const [pool, tier] = String(values.plan ?? "").split(":").map(Number);
    const productConfig = values.product === "subscription" ? { poolId: pool || null, tier: tier || 0, months: Number(values.months), planCode: "" } : { poolId: null, tier: 0, months: 0, planCode: values.product === "token_plan" ? String(values.planCode ?? "") : "" };
    if ([values.paymentTopupId, values.subscriptionId].some(value => value && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0))) { error.textContent = copy.error; return; }
    if ((wasCreating || !form.querySelector<HTMLInputElement>("[name=amount]")!.disabled) && (!Number.isSafeInteger(Math.round(amount)) || Math.abs(amount - Math.round(amount)) > 0.001 || amount <= 0)) { error.textContent = copy.error; return; }
    generation++; busy = true; form.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = true); error.textContent = "";
    try {
      let saved: SupportOrder;
      if (wasCreating) {
        let clientOrderId = createIds.get(active.conversationId); if (!clientOrderId) { clientOrderId = crypto.randomUUID(); createIds.set(active.conversationId, clientOrderId); }
        const payload: SupportOrderCreate = createPayloads.get(active.conversationId) ?? { clientOrderId, title: String(values.title), product: values.product as SupportOrder["product"], amountMicro: Math.round(amount), serviceDays: Number(values.serviceDays), note: String(values.note), dueAt: values.dueAt ? new Date(String(values.dueAt)).toISOString() : null, ...productConfig };
        createPayloads.set(active.conversationId, payload);
        saved = await createSupportOrder(active.session, active.conversationId, payload); if (context !== active) return; createIds.delete(active.conversationId); createPayloads.delete(active.conversationId);
      } else {
        if (!current) throw new Error("Missing order");
        const proposed = { version: current.version, status: values.status as SupportOrder["status"], assigneeId: String(values.assigneeId), dueAt: values.dueAt ? new Date(String(values.dueAt)).toISOString() : null, paymentTopupId: values.paymentTopupId ? Number(values.paymentTopupId) : null, subscriptionId: values.subscriptionId ? Number(values.subscriptionId) : null, subscriptionRef: String(values.subscriptionRef), allowanceRef: String(values.allowanceRef), note: String(values.note), ...(!form.querySelector<HTMLInputElement>("[name=amount]")!.disabled ? { title: String(values.title), product: values.product as SupportOrder["product"], amountMicro: Math.round(amount), serviceDays: Number(values.serviceDays), ...productConfig } : {}) };
        if (String(values.dueAt ?? "") === localTime(current.dueAt)) proposed.dueAt = current.dueAt;
        const original = { ...current, paymentTopupId: current.paymentTopupId ? Number(current.paymentTopupId) : null, subscriptionId: current.subscriptionId ? Number(current.subscriptionId) : null };
        const payload = Object.fromEntries(Object.entries(proposed).filter(([key, value]) => key === "version" || value !== original[key as keyof typeof original])) as SupportOrderPatch;
        saved = await updateSupportOrder(active.session, id, payload);
      }
      if (context === active) { drafts.delete(`${active.conversationId}:${wasCreating ? "new" : id}`); orderBaselines.delete(`${active.conversationId}:${wasCreating ? "new" : id}`); dirty = false; creating = false; editId = saved.id; }
    } catch (failure) { if (context === active) { if (wasCreating && failure instanceof APIError && [400, 403, 404, 422].includes(failure.status)) { createIds.delete(active.conversationId); createPayloads.delete(active.conversationId); } fail(failure); } }
    finally { if (context === active) { busy = false; form.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false); if (wasCreating) { const uncertain = createPayloads.has(active.conversationId); form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach(control => control.readOnly = uncertain); form.querySelectorAll<HTMLSelectElement>("select").forEach(control => control.disabled = uncertain); form.querySelector<HTMLButtonElement>("[type=submit]")!.textContent = uncertain ? copy.retry : copy.save; } await refresh(); } }
  }, { signal: lifecycle.signal });
  async function refreshQueue() {
    if (!context) return;
    const active = context, activeMode = mode, expected = ++queueGeneration; workError.textContent = ""; workList.textContent = copy.loading;
    try {
      if (mode === "orders") {
        const status = dialog.querySelector<HTMLSelectElement>("[data-work-status]")!.value;
        let cursor: string | undefined; const records: SupportOrder[] = [];
        for(let depth=0;depth<orderQueueDepth;depth++){const page=await listSupportOrders("operator",active.session,undefined,{status:status||"active",assignee:dialog.querySelector<HTMLSelectElement>("[data-work-owner]")!.value,overdue:dialog.querySelector<HTMLInputElement>("[data-work-overdue]")!.checked,waitingOn:waiting.value as "team"|"customer"|"none"||undefined,cursor});records.push(...page.items);cursor=page.nextCursor??undefined;if(!cursor)break;}
        const page = {items:[...new Map(records.map(order=>[order.id,order])).values()],nextCursor:cursor};
        if (context?.session !== active.session || mode !== activeMode || expected !== queueGeneration) return;
        const items = page.items;
        workList.innerHTML = items.length ? items.map(order => card(order, true)).join("") : `<p>${esc(copy.empty)}</p>`;
        orderQueueCursor = page.nextCursor ?? null; if(orderQueueCursor) workList.insertAdjacentHTML("beforeend", `<button type="button" data-work-order-more>${esc(life.loadOrders)}</button>`);
      } else if (mode === "cases") {
        const assignee = dialog.querySelector<HTMLSelectElement>("[data-work-owner]")!.value;
        let cursor: string | undefined; const records: SupportCase[] = [], seen = new Set<string>();
        for (let depth = 0; depth < caseQueueDepth; depth++) { const page = await listSupportCases("operator", active.session, {}, { status: dialog.querySelector<HTMLSelectElement>("[data-work-status]")!.value || "active", assignee, cursor, waitingOn: waiting.value as "team"|"customer"|"none"||undefined, overdue: dialog.querySelector<HTMLInputElement>("[data-work-overdue]")!.checked }); records.push(...page.items); if (!page.nextCursor || seen.has(page.nextCursor)) { cursor = undefined; break; } seen.add(page.nextCursor); cursor = page.nextCursor; }
        if (context?.session !== active.session || mode !== activeMode || expected !== queueGeneration) return;
        caseQueueCursor = cursor ?? null;
        const items = [...new Map(records.map(item => [item.id, item])).values()];
        workList.innerHTML = items.length ? items.map(item => `<article class="support-order-card"><strong>${esc(caseCopy.types[item.caseType])} · ${esc(caseCopy.statuses[item.status])}</strong><p>${esc(item.reason)} · ${esc(item.assigneeName || copy.unassigned)}</p>${supportLifecycleMarkup(item,lang)}<button type="button" data-queue-edit="${esc(item.orderId)}" data-conversation-id="${esc(item.conversationId)}" data-queue-case="${esc(item.id)}">${esc(copy.details)}</button></article>`).join("") : `<p>${esc(copy.empty)}</p>`;
        if (caseQueueCursor) workList.insertAdjacentHTML("beforeend", `<button type="button" data-work-case-more>${esc(caseCopy.loadMore)}</button>`);
      } else if (mode === "report") {
        const report = await getSupportCompensationReport(active.session, reportMonth.value);
        if(context?.session!==active.session||expected!==queueGeneration)return;
        workList.innerHTML = `<p>${esc(life.caps)}</p>${report.items.length ? `<div class="support-case-table"><table><thead><tr><th>${esc(caseCopy.customerId)}</th><th>${esc(caseCopy.allowance)}</th><th>${esc(caseCopy.hours)}</th><th>${esc(caseCopy.tokenPlanPeriod)}</th><th>${esc(life.caseCount)}</th></tr></thead><tbody>${report.items.map(item=>`<tr><td>${esc(item.userId)}</td><td>${esc(new Intl.NumberFormat(lang,{style:"currency",currency:"USD"}).format(item.allowanceMicro/1_000_000))}</td><td>${item.hours}</td><td>${item.planPeriods}</td><td>${item.caseCount}</td></tr>`).join("")}</tbody></table></div>` : `<p>${esc(copy.empty)}</p>`}`;
      } else {
        const page = await listSupportOperations(active.session);
        if (context?.session !== active.session || mode !== activeMode || expected !== queueGeneration) return;
        workList.innerHTML = page.items.length ? page.items.map(op => `<article class="support-order-card"><strong>${esc(op.userName || op.userId)} · ${esc(op.scope)}</strong><p>${esc(op.id)} · ${esc(op.outcome === "committed" ? copy.reconcile : op.outcome === "not_executed" ? copy.notExecuted : copy.unknown)}</p><button type="button" data-operation="${esc(op.id)}">${esc(copy.details)}</button></article>`).join("") : `<p>${esc(copy.empty)}</p>`;
      }
    } catch (failure) { fail(failure, workError); }
  }
  let operation: SupportOperation | null = null;
  let operationBusy = false;
  const operationNotes = new Map<string, string>();
  async function showOperation(id: string) {
    if (!context) return;
    try {
      const op = await getSupportOperation(context.session, id); operation = op;
      workDetail.innerHTML = `<h3>${esc(op.userName || op.userId)} · ${esc(op.scope)}</h3><p>${esc(copy.receiptHint)}</p><p>${esc(op.id)} · ${esc(op.businessRef)}</p><p>${esc(copy.outcome)}: ${esc(op.outcome === "committed" ? copy.reconcile : op.outcome === "not_executed" ? copy.notExecuted : copy.unknown)}</p><details><summary>${esc(copy.evidence)}</summary><pre>${esc(JSON.stringify(op.evidence, null, 2))}</pre></details><form data-operation-form><label>${esc(copy.note)}<textarea name="note" rows="3" maxlength="4000" required>${esc(operationNotes.get(id) ?? op.note ?? "")}</textarea></label><button type="submit" name="action" value="confirm_committed" ${op.outcome === "committed" && op.httpStatus === 0 ? "" : "disabled"}>${esc(copy.reconcile)}</button><button type="submit" name="action" value="confirm_not_executed" ${op.outcome === "not_executed" && op.httpStatus === 0 ? "" : "disabled"}>${esc(copy.notExecuted)}</button><button type="submit" name="action" value="needs_review">${esc(copy.statuses.needs_review)}</button></form>`;
    } catch (failure) { fail(failure, workError); }
  }
  dialog.addEventListener("click", async event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
    if (!button) return;
    if (button.hasAttribute("data-work-close")) dialog.close();
    if (button.hasAttribute("data-work-refresh")) { await refreshQueue(); if (operation) await showOperation(operation.id); }
    if (button.hasAttribute("data-work-order-more") && orderQueueCursor) { orderQueueDepth++; await refreshQueue(); }
    if (button.hasAttribute("data-work-report")) { mode="report"; workDetail.replaceChildren(); dialog.querySelector<HTMLElement>("[data-work-title]")!.textContent=life.report; reportMonth.hidden=false; dialog.querySelectorAll<HTMLElement>("select,label").forEach(control=>control.hidden=true); void refreshQueue(); }
    if (button.hasAttribute("data-work-case-more") && caseQueueCursor) { caseQueueDepth++; await refreshQueue(); }
    if (button.hasAttribute("data-work-cases")) { caseQueueDepth = 1; dialog.querySelector<HTMLSelectElement>("[data-work-status]")!.innerHTML=`<option value="">${esc(copy.all)}</option>${Object.entries(caseCopy.statuses).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join("")}`; dialog.querySelector<HTMLElement>("[data-work-status]")!.hidden = false; waiting.hidden=false; reportMonth.hidden=true; dialog.querySelector<HTMLElement>("[data-work-overdue]")!.parentElement!.hidden = false; dialog.querySelector<HTMLElement>("[data-work-owner]")!.hidden = false; mode = "cases"; dialog.querySelector<HTMLElement>("[data-work-title]")!.textContent = caseCopy.cases; void refreshQueue(); }
    if (button.dataset.operation) await showOperation(button.dataset.operation);
    if (button.dataset.queueEdit && button.dataset.conversationId) {
      dialog.close(); await selectConversation(button.dataset.conversationId);
      if (context?.conversationId !== button.dataset.conversationId) return;
      editId = button.dataset.queueEdit; creating = false; dirty = false; await refresh(); paintEditor();
      if (button.dataset.queueCase) cases.openCase(button.dataset.queueCase);
      root.querySelector<HTMLButtonElement>("[data-support-details]")!.click();
    }
  }, { signal: lifecycle.signal });
  dialog.addEventListener("change", event => { if (event.target instanceof Element && event.target.matches("[data-work-status],[data-work-owner],[data-work-overdue],[data-work-waiting],[data-work-month]")) { caseQueueDepth = orderQueueDepth = 1; void refreshQueue(); } }, { signal: lifecycle.signal });
  dialog.addEventListener("input", event => { if (operation && event.target instanceof HTMLTextAreaElement) operationNotes.set(operation.id, event.target.value); }, { signal: lifecycle.signal });
  dialog.addEventListener("submit", async event => {
    event.preventDefault(); if (!context || !operation || operationBusy) return;
    const form = event.target as HTMLFormElement, action = (event as SubmitEvent).submitter?.getAttribute("value") as "confirm_committed" | "confirm_not_executed" | "needs_review";
    if (!["confirm_committed", "confirm_not_executed", "needs_review"].includes(action) || !form.reportValidity()) return;
    const active = context, op = operation, note = form.querySelector<HTMLTextAreaElement>("textarea")!.value;
    generation++; operationNotes.set(op.id, note); operationBusy = true; form.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = true);
    try { await reconcileSupportOperation(active.session, op.id, { version: op.version, action, note }); if (context !== active) return; operationNotes.delete(op.id); workDetail.replaceChildren(); operation = null; await refreshQueue(); }
    catch (failure) { if (context === active) { fail(failure, workError); await showOperation(op.id); } }
    finally { if (context === active) operationBusy = false; }
  }, { signal: lifecycle.signal });
  const openQueue = (next: typeof mode) => { if (!context) return; mode = next; orderQueueDepth=caseQueueDepth=1; reportMonth.hidden=true; dialog.querySelector<HTMLSelectElement>("[data-work-status]")!.innerHTML=`<option value="">${esc(copy.all)}</option>${orderStatuses.map(value=>`<option value="${value}">${esc(copy.statuses[value])}</option>`).join("")}`; operation = null; workDetail.replaceChildren(); dialog.querySelector<HTMLElement>("[data-work-title]")!.textContent = next === "orders" ? copy.queue : copy.pending; dialog.querySelector<HTMLElement>(".support-work-controls")!.querySelectorAll<HTMLElement>("select,label").forEach(control => control.hidden = next !== "orders"); dialog.querySelector<HTMLSelectElement>("[data-work-owner]")!.innerHTML = `<option value="">${esc(copy.assignee)}</option>` + operators.map(op => `<option value="${esc(op.id)}">${esc(op.name)}</option>`).join(""); dialog.showModal(); void refreshQueue(); };
  queueButton.addEventListener("click", () => openQueue("orders"), { signal: lifecycle.signal }); pendingButton.addEventListener("click", () => openQueue("operations"), { signal: lifecycle.signal });
  async function openOrder(id: string) { if(!context)return; const order=await getSupportOrder("operator",context.session,id); await selectConversation(order.conversationId); if(context?.conversationId!==order.conversationId)return; editId=id;creating=false;dirty=false;await refresh();paintEditor(); if(root.dataset.details!=="true")root.querySelector<HTMLButtonElement>("[data-support-details]")!.click(); }
  root.addEventListener("click",event=>{const button=event.target instanceof Element?event.target.closest<HTMLElement>("[data-support-order]"):null;if(button?.dataset.supportOrder)void openOrder(button.dataset.supportOrder).catch(failure=>fail(failure));},{signal:lifecycle.signal});
  return {
    openOrder,
    setContext(next: Context | null) {
      const same = context && next && context.conversationId === next.conversationId && context.session === next.session;
      if (same) Object.assign(context!, next);
      else {
        const sessionChanged = context?.session !== next?.session;
        generation++; orderListDepth=1;orderListCursor=null;busy = false; operationBusy = false; editId = ""; creating = false; dirty = false; orders = [];
        drafts.clear(); orderBaselines.clear();editorBaseline=null;createIds.clear(); createPayloads.clear();
        if (sessionChanged) { loaded = false; operators = []; catalog = { subscriptions: [], tokenPlans: [], allowance: { priceCny: null } }; operation = null; operationNotes.clear(); workDetail.replaceChildren(); workList.replaceChildren(); dialog.close(); }
        list.replaceChildren(); editor.replaceChildren(); cases.setContext(null); context = next ? { ...next } : null;
      }
      if (context) void refresh();
    },
    dispose() { generation++; context = null; drafts.clear(); orderBaselines.clear();editorBaseline=null;createIds.clear(); createPayloads.clear(); cases.dispose(); lifecycle.abort(); dialog.close(); dialog.remove(); section.remove(); queueButton.remove(); pendingButton.remove(); },
  };
}

export function installCustomerOrders(root: HTMLElement, lang: string, onSessionEnded: () => void, shareOrder: (id: string) => Promise<void>) {
  const copy = supportOrdersCopy(lang), life = supportLifecycleCopy(lang), controller = new AbortController();
  const section = document.createElement("details"); section.className = "support-customer-orders"; section.dataset.customerOrders = "";
  section.innerHTML = `<summary>${esc(life.orderHistory)}</summary><p data-customer-order-error role="status"></p><p data-customer-history-sync role="status" hidden></p><div data-customer-order-list></div>`;
  root.querySelector<HTMLElement>(".support-panel-header")!.insertAdjacentElement("afterend", section);
  const policy = document.createElement("div"); policy.className="support-customer-policy"; policy.innerHTML=`<details><summary data-policy-summary>${esc(life.policyShort)}</summary>${supportPolicyMarkup(lang)}</details>`; section.insertAdjacentElement("beforebegin",policy);
  const historyButton = section.querySelector<HTMLElement>("summary")!; historyButton.dataset.customerOrdersOpen="";
  const cases = installSupportCases(section, lang, "customer", onSessionEnded);
  let context: { session: string; conversationId: string } | null = null, generation = 0, items: SupportOrder[] = [], busy = false, depth = 1, cursor: string | null = null, selectedId="", disputeDirty=false, historySyncPending=false;
  const list = section.querySelector<HTMLElement>("[data-customer-order-list]")!, error = section.querySelector<HTMLElement>("[data-customer-order-error]")!;
  const fail = (failure: unknown) => { if (failure instanceof SupportSessionEnded) onSessionEnded(); else {error.dataset.kind='error';error.textContent = failure instanceof APIError ? failure.message : copy.error;} };
  const paint = () => {
    const sync=section.querySelector<HTMLElement>("[data-customer-history-sync]")!;sync.hidden=!historySyncPending;sync.textContent=historySyncPending?life.historySyncPending:"";
    list.innerHTML=items.length?items.map(order=>{
      const pendingActivation=order.hasPendingActivationCase??(order.openCaseCount??0)>0;
      const accepts=!order.disputedAt&&!order.accepted&&!order.acceptanceKind&&order.product!=="other"&&!pendingActivation&&(!order.quoteReconfirmation||order.quoteReconfirmation.state==="confirmed")&&(order.fulfilled||order.fulfillmentStatus==="delivered"||!order.fulfillmentStatus&&!!(order.subscriptionRef||order.allowanceRef||order.tokenPlanRef))&&["awaiting_fulfillment","needs_review"].includes(order.status);
      return `<article class="support-order-card" data-customer-order="${esc(order.id)}" ${selectedId===order.id?'tabindex="-1"':''}><strong>${esc(order.title)}</strong><p>#${esc(order.id)}</p><p>${esc(money(order.amountMicro,lang))} · ${esc(copy.statuses[order.status])}</p>${supportLifecycleMarkup(order,lang)}${supportQuoteMarkup(order,lang,"customer")}<p>${esc(copy.assignee)}: ${esc(order.assigneeName||copy.unassigned)}${order.dueAt?` · ${esc(new Date(order.dueAt).toLocaleString(lang))}`:''}</p>${order.note?`<p>${esc(order.note)}</p>`:''}${order.openCaseCount?`<p>${esc(life.openCases)}: ${order.openCaseCount}</p>`:''}${(order.refundedMicro??0)>0||(order.refundPendingMicro??0)>0?`<p>${esc(life.refunded)}: ${esc(money(order.refundedMicro??0,lang))}<br/>${esc(life.refundPending)}: ${esc(money(order.refundPendingMicro??0,lang))}${order.afterSalesStatus==='settled'?` · ${esc((order.refundedMicro??0)<order.amountMicro?life.partialSettled:life.settled)}`:''}</p>`:''}${order.accepted&&!order.acceptanceKind?`<p>${esc(life.personal)}</p>`:''}${order.rewardStatus==='eligible'?`<p class="support-policy" data-reward-policy>${esc(life.rewardPolicy)} ${esc(life.rewardRefundPolicy)}</p>`:''}${accepts?`<p>${esc(copy.acceptHint)}</p><button type="button" data-order-accept="${esc(order.id)}">${esc(copy.accept)}</button>`:''}${!order.disputedAt&&!pendingActivation&&(order.fulfilled||order.fulfillmentStatus==="accepted"||order.fulfillmentStatus==="system_closed"||order.fulfillmentStatus==="delivered"||order.accepted)?supportDisputeForm('order',order.id,lang):''}<button type="button" data-order-share="${esc(order.id)}">${esc(life.shareOrder)}</button><details><summary>${esc(copy.history)}</summary>${order.history.map(item=>`<p>${esc(new Date(item.createdAt).toLocaleString(lang))} · ${esc(item.actorName)}<br/>${esc(item.note)}</p>`).join('')}</details></article>`;
    }).join(''):`<p>${esc(copy.empty)}</p>`;
    if(cursor)list.insertAdjacentHTML('beforeend',`<button type="button" data-customer-order-more>${esc(life.loadOrders)}</button>`);
  };
  async function refresh() {
    if(!context||busy||disputeDirty)return;const active=context,expected=++generation;
    try{
      let next:string|undefined,syncPending=false;const records:SupportOrder[]=[];const seen=new Set<string>();
      for(let page=0;page<depth;page++){const result=await listSupportOrders('customer',active.session,active.conversationId,{cursor:next});syncPending ||= result.historySyncPending;records.push(...result.items);next=result.nextCursor??undefined;if(!next||seen.has(next)){next=undefined;break;}seen.add(next);}
      const detail=selectedId?await getSupportOrder('customer',active.session,selectedId):null;
      if(expected!==generation||active!==context)return;
      if(detail&&detail.conversationId===active.conversationId)records.push(detail);
      items=[...new Map(records.map(order=>[order.id,order])).values()];cursor=next??null;historySyncPending=syncPending;paint();
    }catch(failure){if(expected===generation)fail(failure);}
  }
  root.addEventListener('click',async event=>{
    const button=event.target instanceof Element?event.target.closest<HTMLButtonElement>('[data-order-accept],[data-order-share],[data-order-confirm-quote],[data-customer-order-more],[data-support-order],[data-dispute-cancel]'):null;
    if(!button||!context||busy)return;
    if(button.hasAttribute('data-dispute-cancel')){disputeDirty=false;await refresh();return;}
    if(button.hasAttribute('data-customer-order-more')){depth++;await refresh();return;}
    if(button.dataset.supportOrder){selectedId=button.dataset.supportOrder;section.open=true;await refresh();list.querySelector<HTMLElement>(`[data-customer-order="${selectedId}"]`)?.focus();return;}
    const order=items.find(item=>item.id===(button.dataset.orderAccept??button.dataset.orderShare??button.dataset.orderConfirmQuote));if(!order)return;
    const active=context;generation++;busy=true;button.disabled=true;error.textContent='';
    try{if(button.dataset.orderShare){await shareOrder(order.id);error.dataset.kind='success';error.textContent=life.orderShared;}else if(button.dataset.orderConfirmQuote)await confirmSupportOrderQuote(active.session,order.id,order.version);else await acceptSupportOrder(active.session,order.id,order.version);}
    catch(failure){if(context===active)fail(failure);}finally{if(context===active){busy=false;button.disabled=false;await refresh();}}
  },{signal:controller.signal});
  section.addEventListener('input',event=>{if(event.target instanceof Element&&event.target.closest('[data-order-dispute]'))disputeDirty=true;},{signal:controller.signal});
  section.addEventListener('submit',async event=>{
    const form=event.target as HTMLFormElement;if(!form.matches('[data-order-dispute]'))return;event.preventDefault();event.stopPropagation();
    if(!context||busy||!form.reportValidity())return;const order=items.find(item=>item.id===form.dataset.orderDispute);if(!order)return;const active=context;busy=true;generation++;error.textContent='';
    try{await disputeSupportOrder(active.session,order.id,order.version,String(new FormData(form).get('reason')??''));if(context===active)disputeDirty=false;}
    catch(failure){if(context===active)fail(failure);}finally{if(context===active){busy=false;await refresh();}}
  },{signal:controller.signal});
  section.addEventListener('toggle',()=>{if(section.open&&context){void refresh();cases.setContext(context);}},{signal:controller.signal});
  return {
    refresh(session:string,conversationId:string){if(context?.session===session&&context.conversationId===conversationId)Object.assign(context,{session,conversationId});else{generation++;busy=false;disputeDirty=false;depth=1;cursor=null;selectedId='';historySyncPending=false;section.querySelector<HTMLElement>('[data-customer-history-sync]')!.hidden=true;context={session,conversationId};items=[];list.replaceChildren();error.textContent='';cases.setContext(null);}if(section.open){void refresh();cases.setContext(context);}},
    dispose(){generation++;context=null;items=[];cases.dispose();controller.abort();section.remove();policy.remove();},
  };
}
