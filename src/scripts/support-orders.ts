import { listSupportOrders, getSupportOrder, listSupportOperators, createSupportOrder, updateSupportOrder, acceptSupportOrder, getSupportCatalog, listSupportOperations, getSupportOperation, reconcileSupportOperation, listSupportCases, SupportSessionEnded } from "../lib/support-service";
import { APIError } from "../lib/app-http";
import type { SupportOrder, SupportOrderCreate, SupportOrderPatch, SupportOperation, SupportCatalog } from "../lib/support-orders";
import type { SupportCase } from "../lib/support-cases";
import type { SupportOperatorDto } from "../lib/support-api";
import { supportOrdersCopy, orderStatuses } from "../i18n/support-orders";
import { escapeSupport as esc } from "../lib/support-ui";
import { installSupportCases } from "./support-cases";
import type { SupportMessage } from "../lib/support-store";
import { supportCasesCopy } from "../i18n/support-cases";

type Context = { session: string; conversationId: string; userId: string; userName: string; operatorId: string; messages: SupportMessage[] };
const money = (value: number, lang: string) => new Intl.NumberFormat(lang, { style: "currency", currency: "CNY", maximumFractionDigits: 6 }).format(value / 1_000_000);
const input = (name: string, label: string, type = "text", extra = "") => `<label>${esc(label)}<input name="${name}" type="${type}" ${extra}/></label>`;
const localTime = (value: string | null) => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";

export function installSupportOrders(root: HTMLElement, lang: string, selectConversation: (id: string) => Promise<void>, onSessionEnded: () => void) {
  const copy = supportOrdersCopy(lang);
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
  dialog.innerHTML = `<header><h2 data-work-title></h2><button type="button" data-work-close aria-label="${esc(copy.close)}">×</button></header><div class="support-work-controls"><select data-work-status aria-label="${esc(copy.details)}"><option value="">${esc(copy.all)}</option>${orderStatuses.map(status => `<option value="${status}">${esc(copy.statuses[status])}</option>`).join("")}</select><select data-work-owner aria-label="${esc(copy.assignee)}"></select><label><input type="checkbox" data-work-overdue/> ${esc(copy.overdue)}</label><button type="button" data-work-refresh>${esc(copy.refresh)}</button></div><p data-work-error class="support-error" role="status"></p><p>${esc(copy.queueLimit)}</p><div data-work-list></div><div data-work-detail></div>`;
  root.append(dialog);
  let context: Context | null = null, operators: SupportOperatorDto[] = [], orders: SupportOrder[] = [], editId = "", creating = false, dirty = false, busy = false, generation = 0, loaded = false;
  let mode: "orders" | "operations" | "cases" = "orders", caseQueueDepth = 1, queueGeneration = 0;
  let caseQueueCursor: string | null = null;
  const caseQueueButton = document.createElement("button"); caseQueueButton.type = "button"; caseQueueButton.dataset.workCases = ""; caseQueueButton.textContent = caseCopy.cases; dialog.querySelector(".support-work-controls")!.append(caseQueueButton);
  let catalog: SupportCatalog = { subscriptions: [], tokenPlans: [], allowance: { priceCny: null } };
  const drafts = new Map<string, Record<string, string>>();
  const createIds = new Map<string, string>();
  const createPayloads = new Map<string, SupportOrderCreate>();
  const list = section.querySelector<HTMLElement>("[data-order-list]")!, editor = section.querySelector<HTMLElement>("[data-order-editor]")!, error = section.querySelector<HTMLElement>("[data-order-error]")!;
  const workError = dialog.querySelector<HTMLElement>("[data-work-error]")!, workList = dialog.querySelector<HTMLElement>("[data-work-list]")!, workDetail = dialog.querySelector<HTMLElement>("[data-work-detail]")!;
  const draftKey = () => context ? `${context.conversationId}:${creating ? "new" : editId}` : "";
  const capture = () => { const form = editor.querySelector<HTMLFormElement>("form"); if (form && context) drafts.set(draftKey(), Object.fromEntries(new FormData(form).entries()) as Record<string, string>); };
  const fail = (failure: unknown, target = error) => { if (failure instanceof SupportSessionEnded) onSessionEnded(); else target.textContent = failure instanceof APIError ? failure.message : copy.error; };
  const ownerOptions = (selected = "") => `<option value="">${esc(copy.unassigned)}</option>${operators.map(op => `<option value="${esc(op.id)}" ${op.id === selected ? "selected" : ""}>${esc(op.name)}</option>`).join("")}`;
  const history = (order: SupportOrder) => `<details><summary>${esc(copy.history)}</summary><ol>${order.history.map(item => `<li><time>${esc(new Date(item.createdAt).toLocaleString(lang))}</time> · ${esc(item.actorName)}<p>${esc(item.note)}</p></li>`).join("")}</ol></details>`;
  const card = (order: SupportOrder, queue = false) => `<article class="support-order-card" data-order-id="${esc(order.id)}"><div><strong>#${esc(order.id)} ${esc(order.title)}</strong><span>${esc(copy.statuses[order.status])}</span></div><p>${esc(money(order.amountMicro, lang))} · ${esc(order.assigneeName || copy.unassigned)}${order.dueAt ? ` · ${esc(new Date(order.dueAt).toLocaleString(lang))}` : ""}</p><button type="button" data-${queue ? "queue" : "order"}-edit="${esc(order.id)}" ${queue ? `data-conversation-id="${esc(order.conversationId)}"` : ""}>${esc(copy.details)}</button></article>`;
  function paintEditor() {
    const current = orders.find(order => order.id === editId);
    if (!context || !creating && !current) { editor.replaceChildren(); cases.setContext(null); return; }
    cases.setContext(current ? { session: context.session, conversationId: context.conversationId, order: current, messages: context.messages, operators } : null);
    const editable = !current || ["quoted", "awaiting_payment"].includes(current.status) && !current.paymentTopupId;
    editor.innerHTML = `<form data-order-form><h4>${esc(current ? `#${current.id} ${current.title}` : copy.newOrder)}</h4>${input("title", copy.title, "text", `required maxlength="200" ${editable ? "" : "disabled"}`)}<label>${esc(copy.product)}<select name="product" ${editable ? "" : "disabled"}>${Object.entries(copy.products).map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join("")}</select></label>${input("amount", copy.amount, "number", `required min="0.000001" step="0.000001" ${editable ? "" : "disabled"}`)}${input("serviceDays", copy.days, "number", `required min="0" max="3660" step="1" ${editable ? "" : "disabled"}`)}${input("dueAt", copy.due, "datetime-local")}${current ? `<label>${esc(copy.assignee)}<select name="assigneeId">${ownerOptions(current.assigneeId)}</select></label><button type="button" data-order-claim>${esc(copy.claim)}</button><label>${esc(copy.details)}<select name="status">${orderStatuses.map(status => `<option value="${status}" ${status === current.status ? "selected" : ""}>${esc(copy.statuses[status])}</option>`).join("")}</select></label>${input("paymentTopupId", copy.payment, "text", "inputmode='numeric' pattern='[1-9][0-9]*'")}${input("subscriptionId", copy.subscription, "text", "inputmode='numeric' pattern='[1-9][0-9]*'")}${input("subscriptionRef", copy.subscriptionRef, "text", "maxlength='255'")}${input("allowanceRef", copy.allowanceRef, "text", "maxlength='255'")}<p>${esc(copy.version)} ${current.version}${current.accepted ? ` · ${esc(copy.accepted)}` : ""}</p>` : ""}<label>${esc(copy.note)}<textarea name="note" maxlength="4000" rows="3"></textarea></label><p class="support-order-hint">${esc(copy.publicNote)}</p><button class="support-primary-button" type="submit">${esc(copy.save)}</button></form>${current ? history(current) : ""}`;
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
      const [activePage, page, people, products, detail] = await Promise.all([listSupportOrders("operator", active.session, active.conversationId, { status: "active" }), listSupportOrders("operator", active.session, active.conversationId), loaded ? Promise.resolve(operators) : listSupportOperators(active.session), loaded ? Promise.resolve(catalog) : getSupportCatalog(active.session), editId ? getSupportOrder("operator", active.session, editId) : Promise.resolve(null)]);
      if (expected !== generation || context !== active) return;
      loaded = true; operators = people; catalog = products;
      const merged = new Map(activePage.items.map(order => [order.id, order])); for (const order of page.items) if (!merged.has(order.id)) merged.set(order.id, order); if (detail?.conversationId === active.conversationId) merged.set(detail.id, detail); orders = [...merged.values()];
      list.innerHTML = orders.length ? orders.map(order => card(order)).join("") : `<p>${esc(copy.empty)}</p>`;
      if (activePage.hasMore || page.hasMore) list.insertAdjacentHTML("beforeend", `<p data-order-more-records role="status">${esc(caseCopy.moreRecordsHint)}</p>`);
      const caseOrder = orders.find(order => order.id === editId);
      if (caseOrder) cases.setContext({ session: active.session, conversationId: active.conversationId, order: caseOrder, messages: active.messages, operators });
      if (!dirty) paintEditor();
    } catch (failure) { if (expected === generation) fail(failure); }
  }
  section.addEventListener("input", event => { if (!(event.target instanceof Element) || !event.target.closest("[data-order-form]")) return; dirty = true; capture(); }, { signal: lifecycle.signal });
  section.addEventListener("change", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-order-form]")) return;
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
    if (button.hasAttribute("data-order-new") || button.dataset.orderEdit) { capture(); creating = button.hasAttribute("data-order-new"); editId = button.dataset.orderEdit ?? ""; dirty = false; error.textContent = ""; paintEditor(); }
    if (button.hasAttribute("data-order-claim")) { const own = operators.find(op => op.id === context!.operatorId); const control = editor.querySelector<HTMLSelectElement>("[name=assigneeId]"); if (own && control) { control.value = own.id; dirty = true; capture(); } }
  }, { signal: lifecycle.signal });
  section.addEventListener("submit", async event => {
    const form = event.target as HTMLFormElement; if (!form.matches("[data-order-form]")) return; event.preventDefault();
    if (busy || !context || !form.reportValidity()) return;
    capture(); const active = context, wasCreating = creating, id = editId, values = Object.fromEntries(new FormData(form).entries());
    const current = orders.find(order => order.id === id), amount = Number(values.amount) * 1_000_000;
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
      if (context === active) { drafts.delete(`${active.conversationId}:${wasCreating ? "new" : id}`); dirty = false; creating = false; editId = saved.id; }
    } catch (failure) { if (context === active) { if (wasCreating && failure instanceof APIError && [400, 403, 404, 422].includes(failure.status)) { createIds.delete(active.conversationId); createPayloads.delete(active.conversationId); } fail(failure); } }
    finally { if (context === active) { busy = false; form.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = false); if (wasCreating) { const uncertain = createPayloads.has(active.conversationId); form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea").forEach(control => control.readOnly = uncertain); form.querySelectorAll<HTMLSelectElement>("select").forEach(control => control.disabled = uncertain); form.querySelector<HTMLButtonElement>("[type=submit]")!.textContent = uncertain ? copy.retry : copy.save; } await refresh(); } }
  }, { signal: lifecycle.signal });
  async function refreshQueue() {
    if (!context) return;
    const active = context, activeMode = mode, expected = ++queueGeneration; workError.textContent = ""; workList.textContent = copy.loading;
    try {
      if (mode === "orders") {
        const status = dialog.querySelector<HTMLSelectElement>("[data-work-status]")!.value;
        const page = await listSupportOrders("operator", active.session, undefined, { status: status || "active", assignee: dialog.querySelector<HTMLSelectElement>("[data-work-owner]")!.value, overdue: dialog.querySelector<HTMLInputElement>("[data-work-overdue]")!.checked });
        if (context?.session !== active.session || mode !== activeMode || expected !== queueGeneration) return;
        const items = page.items;
        workList.innerHTML = items.length ? items.map(order => card(order, true)).join("") : `<p>${esc(copy.empty)}</p>`;
        if (page.hasMore) workList.insertAdjacentHTML("beforeend", `<p data-work-truncated role="status">${esc(copy.queueLimit)}</p>`);
      } else if (mode === "cases") {
        const assignee = dialog.querySelector<HTMLSelectElement>("[data-work-owner]")!.value;
        let cursor: string | undefined; const records: SupportCase[] = [], seen = new Set<string>();
        for (let depth = 0; depth < caseQueueDepth; depth++) { const page = await listSupportCases("operator", active.session, {}, { status: "active", assignee, cursor }); records.push(...page.items); if (!page.nextCursor || seen.has(page.nextCursor)) { cursor = undefined; break; } seen.add(page.nextCursor); cursor = page.nextCursor; }
        if (context?.session !== active.session || mode !== activeMode || expected !== queueGeneration) return;
        caseQueueCursor = cursor ?? null;
        const items = [...new Map(records.map(item => [item.id, item])).values()];
        workList.innerHTML = items.length ? items.map(item => `<article class="support-order-card"><strong>${esc(caseCopy.types[item.caseType])} · ${esc(caseCopy.statuses[item.status])}</strong><p>${esc(item.reason)} · ${esc(item.assigneeName || copy.unassigned)}</p><button type="button" data-queue-edit="${esc(item.orderId)}" data-conversation-id="${esc(item.conversationId)}" data-queue-case="${esc(item.id)}">${esc(copy.details)}</button></article>`).join("") : `<p>${esc(copy.empty)}</p>`;
        if (caseQueueCursor) workList.insertAdjacentHTML("beforeend", `<button type="button" data-work-case-more>${esc(caseCopy.loadMore)}</button>`);
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
    if (button.hasAttribute("data-work-case-more") && caseQueueCursor) { caseQueueDepth++; await refreshQueue(); }
    if (button.hasAttribute("data-work-cases")) { caseQueueDepth = 1; dialog.querySelector<HTMLElement>("[data-work-status]")!.hidden = true; dialog.querySelector<HTMLElement>("[data-work-overdue]")!.parentElement!.hidden = true; dialog.querySelector<HTMLElement>("[data-work-owner]")!.hidden = false; mode = "cases"; dialog.querySelector<HTMLElement>("[data-work-title]")!.textContent = caseCopy.cases; void refreshQueue(); }
    if (button.dataset.operation) await showOperation(button.dataset.operation);
    if (button.dataset.queueEdit && button.dataset.conversationId) {
      dialog.close(); await selectConversation(button.dataset.conversationId);
      if (context?.conversationId !== button.dataset.conversationId) return;
      editId = button.dataset.queueEdit; creating = false; dirty = false; await refresh(); paintEditor();
      if (button.dataset.queueCase) cases.openCase(button.dataset.queueCase);
      root.querySelector<HTMLButtonElement>("[data-support-details]")!.click();
    }
  }, { signal: lifecycle.signal });
  dialog.addEventListener("change", event => { if (event.target instanceof Element && event.target.matches("[data-work-status],[data-work-owner],[data-work-overdue]")) { caseQueueDepth = 1; void refreshQueue(); } }, { signal: lifecycle.signal });
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
  const openQueue = (next: typeof mode) => { if (!context) return; mode = next; operation = null; workDetail.replaceChildren(); dialog.querySelector<HTMLElement>("[data-work-title]")!.textContent = next === "orders" ? copy.queue : copy.pending; dialog.querySelector<HTMLElement>(".support-work-controls")!.querySelectorAll<HTMLElement>("select,label").forEach(control => control.hidden = next !== "orders"); dialog.querySelector<HTMLSelectElement>("[data-work-owner]")!.innerHTML = `<option value="">${esc(copy.assignee)}</option>` + operators.map(op => `<option value="${esc(op.id)}">${esc(op.name)}</option>`).join(""); dialog.showModal(); void refreshQueue(); };
  queueButton.addEventListener("click", () => openQueue("orders"), { signal: lifecycle.signal }); pendingButton.addEventListener("click", () => openQueue("operations"), { signal: lifecycle.signal });
  return {
    setContext(next: Context | null) {
      const same = context && next && context.conversationId === next.conversationId && context.session === next.session;
      if (same) Object.assign(context!, next);
      else {
        const sessionChanged = context?.session !== next?.session;
        generation++; busy = false; operationBusy = false; editId = ""; creating = false; dirty = false; orders = [];
        drafts.clear(); createIds.clear(); createPayloads.clear();
        if (sessionChanged) { loaded = false; operators = []; catalog = { subscriptions: [], tokenPlans: [], allowance: { priceCny: null } }; operation = null; operationNotes.clear(); workDetail.replaceChildren(); workList.replaceChildren(); dialog.close(); }
        list.replaceChildren(); editor.replaceChildren(); cases.setContext(null); context = next ? { ...next } : null;
      }
      if (context) void refresh();
    },
    dispose() { generation++; context = null; drafts.clear(); createIds.clear(); createPayloads.clear(); cases.dispose(); lifecycle.abort(); dialog.close(); dialog.remove(); section.remove(); queueButton.remove(); pendingButton.remove(); },
  };
}

export function installCustomerOrders(root: HTMLElement, lang: string, onSessionEnded: () => void) {
  const copy = supportOrdersCopy(lang), caseCopy = supportCasesCopy(lang), controller = new AbortController();
  const section = document.createElement("details"); section.className = "support-customer-orders"; section.dataset.customerOrders = "";
  section.innerHTML = `<summary>${esc(copy.orders)}</summary><p data-customer-order-error role="status"></p><div data-customer-order-list></div>`;
  root.querySelector<HTMLElement>(".support-panel-header")!.insertAdjacentElement("afterend", section);
  const cases = installSupportCases(section, lang, "customer", onSessionEnded);
  let context: { session: string; conversationId: string } | null = null, generation = 0, items: SupportOrder[] = [], busy = false;
  const list = section.querySelector<HTMLElement>("[data-customer-order-list]")!, error = section.querySelector<HTMLElement>("[data-customer-order-error]")!;
  const fail = (failure: unknown) => { if (failure instanceof SupportSessionEnded) onSessionEnded(); else error.textContent = failure instanceof APIError ? failure.message : copy.error; };
  async function refresh() {
    if (!context || busy) return; const active = context, expected = ++generation;
    try {
      const [activePage, page, casePage] = await Promise.all([listSupportOrders("customer", active.session, active.conversationId, { status: "active" }), listSupportOrders("customer", active.session, active.conversationId), listSupportCases("customer", active.session, { conversationId: active.conversationId }, { status: "active" })]);
      const activationCases = new Set(casePage.items.filter(item => item.caseType === "activation" && ["open", "executed", "needs_review"].includes(item.status)).map(item => item.orderId));
      if (expected !== generation || active !== context) return;
      const merged = new Map(activePage.items.map(order => [order.id, order])); for (const order of page.items) if (!merged.has(order.id)) merged.set(order.id, order); items = [...merged.values()];
      list.innerHTML = items.length ? items.map(order => `<article class="support-order-card"><strong>#${esc(order.id)} ${esc(order.title)}</strong><p>${esc(money(order.amountMicro, lang))} · ${esc(copy.statuses[order.status])}</p><p>${esc(copy.assignee)}: ${esc(order.assigneeName || copy.unassigned)}${order.dueAt ? ` · ${esc(new Date(order.dueAt).toLocaleString(lang))}` : ""}</p>${order.note ? `<p>${esc(order.note)}</p>` : ""}${order.accepted ? `<p>${esc(copy.accepted)}</p>` : order.product !== "other" && !activationCases.has(order.id) && ["awaiting_fulfillment", "needs_review"].includes(order.status) ? `<p>${esc(copy.acceptHint)}</p><button type="button" data-order-accept="${esc(order.id)}">${esc(copy.accept)}</button>` : ""}<details><summary>${esc(copy.history)}</summary>${order.history.map(item => `<p>${esc(new Date(item.createdAt).toLocaleString(lang))} · ${esc(item.actorName)}<br/>${esc(item.note)}</p>`).join("")}</details></article>`).join("") : `<p>${esc(copy.empty)}</p>`;
      if (activePage.hasMore || page.hasMore) list.insertAdjacentHTML("beforeend", `<p data-customer-order-more-records role="status">${esc(caseCopy.moreRecordsHint)}</p>`);
    } catch (failure) { if (expected === generation) fail(failure); }
  }
  section.addEventListener("click", async event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-order-accept]") : null;
    const order = items.find(item => item.id === button?.dataset.orderAccept);
    if (!button || !order || !context || busy) return;
    const active = context; generation++; busy = true; button.disabled = true; error.textContent = "";
    try { await acceptSupportOrder(active.session, order.id, order.version); }
    catch (failure) { if (context === active) fail(failure); }
    finally { if (context === active) { busy = false; await refresh(); } }
  }, { signal: controller.signal });
  section.addEventListener("toggle", () => { if (section.open && context) { void refresh(); cases.setContext(context); } }, { signal: controller.signal });
  return { refresh(session: string, conversationId: string) { if (context?.session === session && context.conversationId === conversationId) Object.assign(context, { session, conversationId }); else { generation++; busy = false; context = { session, conversationId }; items = []; list.replaceChildren(); error.textContent = ""; cases.setContext(null); } if (section.open) { void refresh(); cases.setContext(context); } }, dispose() { generation++; context = null; items = []; cases.dispose(); controller.abort(); section.remove(); } };
}
