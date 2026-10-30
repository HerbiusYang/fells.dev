import { api, APIError, type APIOptions } from "./app-http.ts";
import { isBusinessBlocked, subscribeMaintenance } from "./maintenance.ts";
import { InvalidSupportData, SupportSessionEnded, MAX_SUPPORT_TEXT, validateSupportImage, type SupportAgent, type SupportConversation, type SupportImage, type SupportMessage } from "./support-store.ts";
import type { SupportApiResponse, SupportAttachmentDto, SupportConversationDto, SupportConversationSummaryDto, SupportCursorPage, SupportEventDto, SupportMessageDto, SupportSessionDto, SupportTypingStateDto } from "./support-api.ts";
import type { SupportOrder, SupportOrderCreate, SupportOrderPatch, SupportOrderQuery, SupportOperation, SupportOperationPage, SupportCatalog } from "./support-orders.ts";
import type { SupportOperatorDto } from "./support-api.ts";
import type { SupportTopupInput, SupportTopupReceipt } from "./support-api.ts";
import type { SupportCase, SupportCaseCreate, SupportCasePatch, SupportRefundPlan, SupportRefundChannel, SupportCaseReverse, SupportCompensationReport } from "./support-cases.ts";

export const SESSION_CHANNEL = "fells.session.changed";
const SUPPORT_CHANNEL_HTTP = "fells.support.changed.v1";
export type SupportAudience = "customer" | "operator";
export type CustomerSupportSession = { session: string; userId: string };
type Request = <T>(path: string, options?: APIOptions) => Promise<T>;
type EventStream = Pick<EventSource, "addEventListener" | "close" | "readyState"> & { onerror: ((event: Event) => void) | null };
type State = { id: string; fingerprint: string; handle: string; authMethod: "access" | "password"; controller: AbortController; streams: Set<{ close(): void; expired(): void }> };
type Pending = { content: string; clientId: string; attachmentId?: string };
type Options = { request?: Request; eventSource?: (url: string) => EventStream; notify?: (name: string, detail: unknown) => void };

const positiveID = (value: unknown): string => {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/.test(id)) throw new InvalidSupportData("Invalid server identity");
  return id;
};
const orderID = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new InvalidSupportData("Invalid order identity");
  return value;
};
const sessionID = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new InvalidSupportData("Invalid server session identity");
  return value;
};
const timestamp = (value: string): number => {
  const result = Date.parse(value);
  if (!Number.isFinite(result) || result < 0) throw new InvalidSupportData("Invalid server timestamp");
  return result;
};
const bounded = (value: unknown, max: number): string => {
  if (typeof value !== "string" || value.length > max) throw new InvalidSupportData("Invalid server text");
  return value;
};

export function createSupportHttpService(options: Options = {}) {
  const request = options.request ?? api;
  const createStream = options.eventSource ?? (url => new EventSource(url));
  const source = crypto.randomUUID();
  const states: Partial<Record<SupportAudience, State>> = {};
  const generations = { customer: 0, operator: 0 };
  const conversations = new Map<string, SupportConversation>();
  const pending = new Map<string, Pending>();
  let operatorLogout: State | undefined;
  let customerConversationId = "";
  const notify = options.notify ?? ((name: string, detail: unknown) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
    try { const channel = new BroadcastChannel(name); channel.postMessage(detail); channel.close(); } catch { /* SSE and focus refresh remain available. */ }
  });
  const changed = () => notify(SUPPORT_CHANNEL_HTTP, { source });
  const authChanged = (audience: SupportAudience, redirect?: string) => notify(SESSION_CHANNEL, { audience, source, ...(redirect ? { redirect } : {}) });
  const cacheKey = (state: State, id: string) => `${state.handle}:${id}`;
  function invalidate(audience: SupportAudience, tellStreams = true) {
    generations[audience]++;
    const state = states[audience];
    delete states[audience];
    if (!state) return;
    state.controller.abort();
    for (const stream of [...state.streams]) { stream.close(); if (tellStreams) stream.expired(); }
    for (const key of [...conversations.keys()]) if (key.startsWith(state.handle + ":")) conversations.delete(key);
    for (const key of [...pending.keys()]) if (key.startsWith(state.handle + ":")) pending.delete(key);
    if (audience === "customer") customerConversationId = "";
  }
  function bind(audience: SupportAudience, id: string, fingerprint: string, authMethod: "access" | "password" = "password"): State {
    const previous = states[audience];
    if (previous?.id === id && previous.fingerprint === fingerprint && previous.authMethod === authMethod) return previous;
    if (audience === "operator") operatorLogout = undefined;
    invalidate(audience);
    return states[audience] = { id, fingerprint, authMethod, handle: crypto.randomUUID(), controller: new AbortController(), streams: new Set() };
  }
  function requireState(audience: SupportAudience, handle: string): State {
    const state = states[audience];
    if (!state || state.handle !== handle || state.controller.signal.aborted) throw new SupportSessionEnded("Support session ended");
    return state;
  }
  const headers = (audience: SupportAudience, state: State) => ({
    "X-Fells-Support-Audience": audience,
    [audience === "customer" ? "X-Fells-Expected-User" : "X-Fells-Expected-Operator"]: state.id,
    [audience === "customer" ? "X-Fells-Expected-Session" : "X-Fells-Expected-Operator-Session"]: state.fingerprint,
  });
  async function call<T>(audience: SupportAudience, handle: string, path: string, opts: APIOptions = {}): Promise<T> {
    const state = requireState(audience, handle);
    try {
      const value = await request<SupportApiResponse<T>>("/api/support/" + path, { ...opts, headers: { ...opts.headers, ...headers(audience, state) }, signal: state.controller.signal });
      requireState(audience, handle);
      if (!value || value.ok !== true) throw new InvalidSupportData("Invalid support response");
      return value.data;
    } catch (failure) {
      if (states[audience] !== state || state.controller.signal.aborted) throw new SupportSessionEnded("Support session changed");
      if (failure instanceof APIError && (failure.status === 401 || audience === "operator" && failure.status === 403 && failure.code === "access_required")) { invalidate(audience); throw new SupportSessionEnded("Support sign-in required"); }
      throw failure;
    }
  }
  async function pages<T>(audience: SupportAudience, handle: string, path: string, limit: number): Promise<T[]> {
    const items: T[] = [], seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page: SupportCursorPage<T> = await call(audience, handle, `${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!page || !Array.isArray(page.items) || page.items.length > limit || page.nextCursor !== null && typeof page.nextCursor !== "string") throw new InvalidSupportData("Invalid support pagination");
      items.push(...page.items);
      cursor = page.nextCursor;
      if (cursor) { positiveID(cursor); if (seen.has(cursor)) throw new InvalidSupportData("Repeated support cursor"); seen.add(cursor); }
    } while (cursor);
    return items;
  }
  function image(dto: SupportAttachmentDto, audience: SupportAudience): SupportImage {
    if (!dto || !/^[a-zA-Z0-9_-]{1,64}$/.test(dto.id) || !["image/png", "image/jpeg", "image/webp"].includes(dto.mimeType) || !Number.isSafeInteger(dto.size) || dto.size < 1 || dto.size > 2 * 1024 * 1024) throw new InvalidSupportData("Invalid server image");
    const name = bounded(dto.name, 255);
    // Server images remain private, same-origin signed URLs. A response cannot
    // turn message rendering into an arbitrary remote URL or script URL sink.
    if (typeof dto.url !== "string" || !dto.url.startsWith("/api/support/attachments/") || dto.url.startsWith("//")) throw new InvalidSupportData("Invalid server image URL");
    const url = new URL(dto.url, "https://fells.invalid");
    if (url.pathname !== `/api/support/attachments/${dto.id}` || url.searchParams.get("audience") !== audience || !url.searchParams.get("signature") || !url.searchParams.get("expires")) throw new InvalidSupportData("Invalid server image authorization");
    timestamp(dto.urlExpiresAt);
    return { name, type: dto.mimeType, size: dto.size, dataUrl: dto.url };
  }
  const boolean = (value: unknown): boolean => {
    if (typeof value !== "boolean") throw new InvalidSupportData("Invalid server support state");
    return value;
  };
  const typing = (value: SupportTypingStateDto) => ({ user: boolean(value?.user), agent: boolean(value?.agent) });
  function lifecycle(dto: SupportOrder | SupportCase) {
    if (dto.waitingOn !== undefined && !["team", "customer", "none"].includes(dto.waitingOn)) throw new InvalidSupportData("Invalid waiting party");
    if (dto.acceptanceKind !== undefined && !["", "customer", "system_timeout"].includes(dto.acceptanceKind)) throw new InvalidSupportData("Invalid acceptance kind");
    for (const value of [dto.acceptanceDeadline, dto.disputedAt]) if (value) timestamp(value);
    if (dto.disputeReason !== undefined) bounded(dto.disputeReason, 4000);
    if (dto.rewardAllowanceMicro !== undefined && (!Number.isSafeInteger(dto.rewardAllowanceMicro) || dto.rewardAllowanceMicro < 0)) throw new InvalidSupportData("Invalid confirmation reward");
  }
  function order(dto: SupportOrder): SupportOrder {
    const validStatuses = ["quoted", "awaiting_payment", "awaiting_fulfillment", "completed", "needs_review", "cancelled", "refunding", "refunded", "partially_refunded"];
    if (!dto || !validStatuses.includes(dto.status) || !["subscription", "token_plan", "allowance", "other"].includes(dto.product) || dto.currency !== "CNY" || !Number.isSafeInteger(dto.amountMicro) || dto.amountMicro <= 0 || !Number.isSafeInteger(dto.serviceDays) || dto.serviceDays < 0 || !Number.isSafeInteger(dto.version) || dto.version < 1 || !Array.isArray(dto.history) || typeof dto.accepted !== "boolean") throw new InvalidSupportData("Invalid order response");
    lifecycle(dto);
    if (dto.purchaseConfirmation) { const q = dto.purchaseConfirmation; if (!["required", "confirmed"].includes(q.state) || !/^[a-f0-9]{64}$/.test(q.quoteHash) || q.state === "confirmed" && !q.confirmedAt) throw new InvalidSupportData("Invalid purchase confirmation"); if (q.confirmedAt) timestamp(q.confirmedAt); }
    if (dto.quoteReconfirmation) { const quote=dto.quoteReconfirmation; if(!["required","pending","confirmed"].includes(quote.state))throw new InvalidSupportData("Invalid quote confirmation state");bounded(quote.reason,4000);for(const value of [quote.proposedAt,quote.confirmedAt])if(value)timestamp(value); }
    for (const value of [dto.refundedMicro, dto.refundPendingMicro, dto.openCaseCount]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new InvalidSupportData("Invalid order lifecycle amounts");
    orderID(dto.id); positiveID(dto.conversationId); positiveID(dto.userId);
    for (const key of ["assigneeId", "paymentTopupId", "subscriptionId"] as const) if (dto[key]) positiveID(dto[key]);
    for (const key of ["title", "assigneeName", "subscriptionRef", "allowanceRef", "note"] as const) bounded(dto[key], key === "note" ? 4000 : 255);
    bounded(dto.planCode ?? "", 100); bounded(dto.tokenPlanRef ?? "", 255);
    if (dto.product === "token_plan" && !dto.planCode) throw new InvalidSupportData("Missing Token Plan code");
    timestamp(dto.createdAt); timestamp(dto.updatedAt);
    if (dto.dueAt) timestamp(dto.dueAt);
    if (dto.acceptedAt) timestamp(dto.acceptedAt);
    for (const item of dto.history) { positiveID(item.id); bounded(item.actorName, 100); bounded(item.action, 50); bounded(item.note, 4500); timestamp(item.createdAt); }
    return { ...dto, planCode: dto.planCode ?? "", tokenPlanRef: dto.tokenPlanRef ?? "", paymentTopupId: dto.paymentTopupId ? String(dto.paymentTopupId) : "", subscriptionId: dto.subscriptionId ? String(dto.subscriptionId) : "", assigneeId: dto.assigneeId ? String(dto.assigneeId) : "" };
  }
  function operation(dto: SupportOperation) {
    if (!dto || !/^[a-f0-9-]{36}$/.test(dto.id) || !["pending", "completed"].includes(dto.status) || !["committed", "unknown", "in_progress", "completed", "not_executed"].includes(dto.outcome) || !Number.isSafeInteger(dto.version) || dto.version < 1 || !Number.isSafeInteger(dto.httpStatus) || !dto.evidence || typeof dto.evidence !== "object") throw new InvalidSupportData("Invalid operation response");
    positiveID(dto.userId); bounded(dto.scope, 100); bounded(dto.businessRef, 255); timestamp(dto.createdAt);
    return dto;
  }
  function supportCase(dto: SupportCase): SupportCase {
    if (!dto || !["activation", "compensation", "refund"].includes(dto.caseType) || !["open", "executed", "closed", "cancelled", "needs_review", "reversed"].includes(dto.status) || !Number.isSafeInteger(dto.version) || dto.version < 1 || !Array.isArray(dto.history)) throw new InvalidSupportData("Invalid case response");
    lifecycle(dto);
    if (dto.correctsCaseId) orderID(dto.correctsCaseId);
    if (dto.reversedAt) timestamp(dto.reversedAt);
    if (dto.reasonCode && !["service_outage", "delivery_error", "billing_error", "goodwill"].includes(dto.reasonCode)) throw new InvalidSupportData("Invalid compensation reason");
    if (dto.refund != null) {
      const r = dto.refund;
      if (!["pending", "unknown", "failed", "paid"].includes(r.stage) || !["", "pending", "unknown", "failed", "paid"].includes(r.claimedStage ?? "")) throw new InvalidSupportData("Invalid refund stage");
      if (r.plan && !["proportional", "remaining", "waive"].includes(r.plan.mode)) throw new InvalidSupportData("Invalid refund recovery plan");
      for (const value of [r.channelAmountMicro, r.recovery?.lossCashMicro, r.recovery?.guaranteeRecalledMicro, r.recovery?.guaranteeLossMicro]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new InvalidSupportData("Invalid refund amount");
      if (r.channelCurrency && r.channelCurrency !== "CNY") throw new InvalidSupportData("Invalid refund currency");
      for (const value of [r.provider, r.account, r.refundId]) if (value !== undefined) bounded(value, 255);
      for (const actor of [r.executedBy, r.recordedBy, r.reviewedBy, r.plan?.proposedBy, r.plan?.approvedBy]) if (actor) positiveID(actor);
      for (const value of [r.reversedAt, r.plan?.approvedAt]) if (value) timestamp(value);
    }
    orderID(dto.id); orderID(dto.orderId); positiveID(dto.conversationId); positiveID(dto.userId);
    for (const key of ["requestedAllowanceMicro", "requestedHours", "refundMicro"] as const) if (!Number.isSafeInteger(dto[key]) || dto[key] < 0) throw new InvalidSupportData("Invalid case amount");
    if (!Number.isSafeInteger(dto.requestedPlanPeriods ?? 0) || (dto.requestedPlanPeriods ?? 0) < 0 || (dto.requestedPlanPeriods ?? 0) > 1) throw new InvalidSupportData("Invalid Token Plan periods");
    if (dto.requestedHours > 744) throw new InvalidSupportData("Invalid compensation hours");
    bounded(dto.reason, 1000);
    for (const key of ["evidenceNote", "note", "refundProof"] as const) bounded(dto[key], 4000);
    for (const key of ["evidenceMessageId", "refundProofMessageId"] as const) if (dto[key]) positiveID(dto[key]);
    timestamp(dto.createdAt); timestamp(dto.updatedAt);
    if (dto.receipt !== null) {
      const receipt = dto.receipt;
      if (!receipt || !Number.isSafeInteger(receipt.allowanceMicro) || !Number.isSafeInteger(receipt.subscriptionHours) || !Number.isSafeInteger(receipt.cashRefundMicro)) throw new InvalidSupportData("Invalid case receipt");
      bounded(receipt.actionRef, 255); bounded(receipt.ledgerRef, 255);
      bounded(receipt.tokenPlanRef ?? "", 255);
      if (receipt.tokenPlanSubscriptionId != null && (!Number.isSafeInteger(receipt.tokenPlanSubscriptionId) || receipt.tokenPlanSubscriptionId <= 0)) throw new InvalidSupportData("Invalid Token Plan subscription ID");
      if (!Number.isSafeInteger(receipt.tokenPlanPeriods ?? 0) || (receipt.tokenPlanPeriods ?? 0) < 0 || (receipt.tokenPlanPeriods ?? 0) > 1) throw new InvalidSupportData("Invalid Token Plan receipt period");
      for (const snapshot of [receipt.before, receipt.after]) {
        if (!snapshot || typeof snapshot !== "object") throw new InvalidSupportData("Invalid account snapshot");
        const values = snapshot as Record<string, unknown>;
        for (const key of ["balanceMicro", "grantMicro", "allowanceMicro", "allowanceGrantMicro", "allowanceExpiresAt", "subscriptionExpiresAt"]) if (!Number.isSafeInteger(values[key])) throw new InvalidSupportData("Invalid account amount");
        boolean(values.selfKeys); bounded(values.rideMode, 35);
      }
    }
    for (const item of dto.history) { positiveID(item.id); bounded(item.actorName, 100); bounded(item.action, 50); bounded(item.note, 4500); timestamp(item.createdAt); }
    return { ...dto, requestedPlanPeriods: dto.requestedPlanPeriods ?? 0 };
  }
  function message(dto: SupportMessageDto, id: string, audience: SupportAudience): SupportMessage {
    if (!dto || positiveID(dto.conversationId) !== id || dto.sender !== "user" && dto.sender !== "agent" || !Array.isArray(dto.attachments) || dto.attachments.length > 1) throw new InvalidSupportData("Invalid server message");
    const text = bounded(dto.text, MAX_SUPPORT_TEXT), media = dto.attachments[0] ? image(dto.attachments[0], audience) : undefined;
    if (dto.orderId) { orderID(dto.orderId); bounded(dto.orderTitle, 200); if(!Number.isSafeInteger(dto.orderAmountMicro) || dto.orderAmountMicro! <= 0) throw new InvalidSupportData("Invalid order message amount"); }
    if (!text.trim() && !media && !dto.orderId) throw new InvalidSupportData("Empty server message");
    return { id: positiveID(dto.id), sender: dto.sender, text, created: timestamp(dto.createdAt), ...(media ? { image: media } : {}), ...(dto.orderId ? { orderId: dto.orderId, orderTitle: dto.orderTitle, orderAmountMicro: dto.orderAmountMicro, orderProduct: dto.orderProduct } : {}) };
  }
  async function load(audience: SupportAudience, handle: string, dto: SupportConversationDto): Promise<SupportConversation> {
    const state = requireState(audience, handle), id = positiveID(dto.id), customer = dto.customer;
    if (audience === "customer" && positiveID(customer.id) !== state.id) throw new SupportSessionEnded("Support customer changed");
    if (dto.status !== "open" && dto.status !== "resolved") throw new InvalidSupportData("Invalid conversation status");
    const raw = await pages<SupportMessageDto>(audience, handle, `conversations/${id}/messages`, 200);
    let previousPosition = -1, previousID = 0n;
    const messages = raw.map(item => {
      const mapped = message(item, id, audience);
      if (BigInt(mapped.id) <= previousID) throw new InvalidSupportData("Unordered server messages");
      previousID = BigInt(mapped.id);
      // The existing UI uses numeric read positions. Preserve server ordering
      // when multiple committed messages share a millisecond, while retaining
      // the displayed time to millisecond precision for ordinary messages.
      mapped.created = Math.max(mapped.created, previousPosition + 1);
      previousPosition = mapped.created;
      return mapped;
    });
    const readAt = (cursor: string | null) => {
      if (cursor === null) return 0;
      const found = messages.find(item => item.id === positiveID(cursor));
      if (!found) throw new InvalidSupportData("Invalid server read cursor");
      return found.created;
    };
    // Usage can leave API allowance below zero; retain that signed balance in
    // customer details instead of rejecting the entire operator inbox.
    if (customer.creditsCurrency !== "USD" || customer.creditsKind !== "api_allowance" || customer.walletCurrency !== "CNY" || !Number.isSafeInteger(customer.walletCashMicro) || !dto.userRead || !dto.agentRead || !Number.isSafeInteger(customer.workspaceCount) || customer.workspaceCount < 0 || !Number.isFinite(customer.credits)) throw new InvalidSupportData("Invalid customer profile");
    const result: SupportConversation = {
      id, user: { id: positiveID(customer.id), name: bounded(customer.name, 100), email: bounded(customer.email, 254), joined: timestamp(customer.joinedAt), locale: bounded(customer.preferredLocale, 35), workspaceCount: customer.workspaceCount, credits: customer.credits, walletCashMicro: customer.walletCashMicro },
      status: dto.status, messages, userReadAt: readAt(dto.userRead.lastReadMessageId), agentReadAt: readAt(dto.agentRead.lastReadMessageId), updatedAt: timestamp(dto.updatedAt), demo: false,
    };
    requireState(audience, handle);
    conversations.set(cacheKey(state, id), result);
    return result;
  }
  async function get(audience: SupportAudience, handle: string, id: string) {
    return load(audience, handle, await call<SupportConversationDto>(audience, handle, `conversations/${positiveID(id)}`));
  }
  async function readCustomerSession(): Promise<CustomerSupportSession | null> {
    const generation = generations.customer;
    try {
      const response = await request<{ session_id: string; user: { id: number | string; username: string } }>("/api/app/bootstrap");
      if (generation !== generations.customer) throw new SupportSessionEnded("Customer session changed");
      const id = positiveID(response.user.id), state = bind("customer", id, sessionID(response.session_id));
      return { session: state.handle, userId: state.id };
    } catch (failure) {
      if (generation !== generations.customer) throw new SupportSessionEnded("Customer session changed");
      if (failure instanceof APIError && failure.status === 401) { invalidate("customer"); return null; }
      throw failure;
    }
  }
  async function readSupportSession(): Promise<SupportAgent | null> {
    const generation = generations.operator, state = states.operator;
    const value = await request<SupportApiResponse<SupportSessionDto | null>>("/api/support/session", { headers: state ? headers("operator", state) : { "X-Fells-Support-Audience": "operator" }, signal: state?.controller.signal }).catch(failure => {
      if (generation !== generations.operator) throw new SupportSessionEnded("Operator session changed");
      if (failure instanceof APIError && (failure.status === 401 || failure.status === 403)) { invalidate("operator"); throw new SupportSessionEnded("Operator session ended"); }
      throw failure;
    });
    if (generation !== generations.operator) throw new SupportSessionEnded("Operator session changed");
    if (!value || value.ok !== true) throw new InvalidSupportData("Invalid operator response");
    if (!value.data) { invalidate("operator"); return null; }
    const dto = value.data;
    timestamp(dto.expiresAt);
    if (dto.authMethod !== undefined && dto.authMethod !== "access" && dto.authMethod !== "password") throw new InvalidSupportData("Invalid operator authentication method");
    const bound = bind("operator", positiveID(dto.operator.id), sessionID(dto.sessionId), dto.authMethod);
    return { session: bound.handle, fingerprint: bound.fingerprint, id: bound.id, name: bounded(dto.operator.name, 100), email: bounded(dto.operator.email, 254), ...(dto.authMethod ? { authMethod: dto.authMethod } : {}) };
  }
  async function ensureUserConversation(snapshot: CustomerSupportSession, _locale: string): Promise<SupportConversation> {
    requireState("customer", snapshot.session);
    let dto = await call<SupportConversationDto | null>("customer", snapshot.session, "conversations/current");
    if (!dto) dto = await call<SupportConversationDto>("customer", snapshot.session, "conversations/current", { method: "POST", body: {} });
    const conversation = await load("customer", snapshot.session, dto);
    customerConversationId = conversation.id;
    return conversation;
  }
  async function send(audience: SupportAudience, handle: string, id: string, text: string, attachment?: SupportImage, sharedOrderId?: string) {
    const state = requireState(audience, handle), key = cacheKey(state, positiveID(id));
    if (sharedOrderId) orderID(sharedOrderId);
    if (typeof text !== "string" || text.length > MAX_SUPPORT_TEXT || !text.trim() && !attachment && !sharedOrderId) throw new InvalidSupportData("Invalid message text");
    const prepared = attachment ? validateSupportImage(attachment) : undefined;
    const content = JSON.stringify([text, prepared ?? null, sharedOrderId ?? null]);
    let intent = pending.get(key);
    if (!intent || intent.content !== content) { intent = { content, clientId: crypto.randomUUID() }; pending.set(key, intent); }
    if (prepared && !intent.attachmentId) {
      const data = atob(prepared.dataUrl.slice(prepared.dataUrl.indexOf(",") + 1));
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(data, c => c.charCodeAt(0))], { type: prepared.type }), prepared.name);
      const uploaded = await call<SupportAttachmentDto>(audience, handle, "attachments", { method: "POST", body: form });
      image(uploaded, audience);
      intent.attachmentId = uploaded.id;
    }
    await call<SupportMessageDto>(audience, handle, `conversations/${id}/messages`, { method: "POST", body: { clientMessageId: intent.clientId, text, attachmentIds: intent.attachmentId ? [intent.attachmentId] : [], ...(sharedOrderId ? { orderId: sharedOrderId } : {}) } });
    const result = await get(audience, handle, id);
    if (pending.get(key) === intent) pending.delete(key);
    changed();
    return result;
  }
  async function markRead(audience: SupportAudience, handle: string, id: string, throughCreated?: number) {
    const state = requireState(audience, handle), current = conversations.get(cacheKey(state, id));
    const conversation = current ?? await get(audience, handle, id);
    const latest = conversation.messages.filter(item => throughCreated === undefined || item.created <= throughCreated).at(-1);
    if (!latest) return;
    await call(audience, handle, `conversations/${id}/read`, { method: "PATCH", body: { lastReadMessageId: latest.id } });
    changed();
  }
  function openSupportEvents(audience: SupportAudience, handle: string, onEvent: (event: SupportEventDto) => void) {
    const state = requireState(audience, handle);
    const query = new URLSearchParams({ audience, [audience === "customer" ? "expected_user" : "expected_operator"]: state.id, [audience === "customer" ? "expected_session" : "expected_operator_session"]: state.fingerprint });
    let stream: EventStream | undefined;
    let closed = false, probing = false, retries = 0, paused = false;
    let unsubscribeMaintenance = () => {};
    let lastEventId = "";
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const sameState = () => states[audience] === state && !state.controller.signal.aborted;
    const active = () => !closed && sameState() && (audience !== "operator" || operatorLogout !== state);
    const connection = {
      close() {
        if (closed) return;
        closed = true;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        if (stream) { stream.onerror = null; stream.close(); }
        unsubscribeMaintenance();
        state.streams.delete(connection);
      },
      expired() { onEvent({ id: "", type: "session.expired", data: { role: audience === "customer" ? "user" : "agent" } }); },
    };
    state.streams.add(connection);
    function retryClosedStream() {
      // CONNECTING already retries natively. HTTP 5xx can instead permanently
      // close EventSource; allow one bounded replacement timer for that case.
      if (!active() || isBusinessBlocked() || stream?.readyState !== 2 || retryTimer !== undefined || retries >= 6) return;
      const delay = Math.min(1000 * 2 ** retries++, 30000);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!active() || isBusinessBlocked() || stream?.readyState !== 2) return;
        stream.onerror = null;
        stream.close();
        if (lastEventId) query.set("lastEventId", lastEventId);
        stream = createStream("/api/support/events?" + query);
        listen(stream);
      }, delay);
    }
    async function probeIdentity() {
      // Probe the existing binding without rebinding it. A late successful
      // response must not restore an identity after logout or another tab.
      if (audience === "customer") {
        const dto = await request<{ session_id: string; user: { id: number | string } }>("/api/app/bootstrap", { signal: state.controller.signal });
        if (sameState() && (positiveID(dto.user.id) !== state.id || sessionID(dto.session_id) !== state.fingerprint)) invalidate(audience);
      } else {
        const value = await request<SupportApiResponse<SupportSessionDto | null>>("/api/support/session", { headers: headers(audience, state), signal: state.controller.signal });
        if (!sameState()) return;
        if (!value || value.ok !== true) throw new InvalidSupportData("Invalid operator response");
        const dto = value.data;
        if (!dto || positiveID(dto.operator.id) !== state.id || sessionID(dto.sessionId) !== state.fingerprint || (dto.authMethod ?? "password") !== state.authMethod) invalidate(audience);
      }
    }
    function listen(current: EventStream) {
      const receive = (event: Event) => {
        if (!active() || current !== stream) return;
        let value: SupportEventDto;
        try { value = JSON.parse((event as MessageEvent).data); } catch { return; }
        if (!value || typeof value.id !== "string" || typeof value.type !== "string" || !value.data) return;
        if (value.type === "session.expired") {
          // The server may confirm revocation to another tab before DELETE's
          // response arrives. Clear its binding first, then use the same fixed
          // Access exit as a successful logout, without a competing /admin/ hop.
          const access = audience === "operator" && state.authMethod === "access";
          invalidate(audience, !access);
          if (access) authChanged("operator", "/cdn-cgi/access/logout");
          return;
        }
        if (value.type === "wallet.updated" && audience === "customer") notify("fells.wallet.changed", { userId: state.id, sessionId: state.fingerprint });
        // The server accepts signed-int64 cursors. Keep the exact decimal text,
        // including values above Number.MAX_SAFE_INTEGER, for a new source.
        if (/^(0|[1-9]\d{0,18})$/.test(value.id) && BigInt(value.id) <= 9223372036854775807n && (!lastEventId || BigInt(value.id) > BigInt(lastEventId))) lastEventId = value.id;
        onEvent(value);
      };
      for (const kind of ["message.created", "conversation.updated", "conversation.read", "conversation.typing", "order.updated", "case.updated", "wallet.updated", "session.expired"]) current.addEventListener(kind, receive);
      current.addEventListener("open", () => { if (active() && current === stream) retries = 0; });
      current.onerror = () => {
        if (!active() || current !== stream) return;
        if (isBusinessBlocked()) { current.close(); paused = true; return; }
        retryClosedStream();
        if (probing) return;
        probing = true;
        // A pending probe cannot block recovery, but its eventual 401/403 still
        // invalidates this same binding, including any replacement stream.
        void probeIdentity().catch(failure => {
          if (sameState() && failure instanceof APIError && (failure.status === 401 || audience === "operator" && failure.status === 403)) invalidate(audience);
        }).finally(() => { probing = false; });
      };
    }
    function connect() {
      if (!active() || isBusinessBlocked()) { paused = true; return; }
      if (lastEventId) query.set("lastEventId", lastEventId);
      stream = createStream("/api/support/events?" + query); paused = false; listen(stream);
    }
    unsubscribeMaintenance = subscribeMaintenance(() => {
      if (isBusinessBlocked()) {
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        retryTimer = undefined;
        // Keep a live event stream. Stop only a failed/connecting stream so its
        // native reconnect cannot send new requests during maintenance.
        if (stream && stream.readyState !== 1) { stream.onerror = null; stream.close(); paused = true; }
      } else if (paused && active()) {
        void probeIdentity().then(() => connect()).catch(failure => {
          if (sameState() && failure instanceof APIError && (failure.status === 401 || audience === "operator" && failure.status === 403)) invalidate(audience);
        });
      }
    });
    connect();
    return connection;
  }
  return {
    invalidateSession: invalidate,
    handleSessionChange(detail: unknown) {
      const value = detail as { audience?: SupportAudience; source?: string; redirect?: string } | null;
      if (value?.source === source) return;
      if (!value?.audience || value.audience === "customer") invalidate("customer");
      if (!value?.audience || value.audience === "operator") {
        operatorLogout = undefined;
        // The console owns this one fixed redirect. Expiring its stream first
        // would navigate to /admin/ before the logout message is delivered.
        invalidate("operator", value?.redirect !== "/cdn-cgi/access/logout");
      }
    },
    readCustomerSession, readSupportSession, ensureUserConversation, openSupportEvents,
    async listSupportOrders(audience: SupportAudience, handle: string, conversationId?: string, query: SupportOrderQuery = {}) {
      const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
      if (query.status) params.set("status", query.status);
      if (query.assignee) params.set("assignee", positiveID(query.assignee));
      if (query.overdue) params.set("overdue", "true");
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.waitingOn) params.set("waitingOn", query.waitingOn);
      if (audience === "customer" && !conversationId) throw new InvalidSupportData("Open a conversation first");
      const path = conversationId ? `conversations/${positiveID(conversationId)}/orders` : "orders";
      const data = await call<{ items: SupportOrder[]; nextCursor: string | null; hasMore?: boolean; historySyncPending?: boolean }>(audience, handle, `${path}?${params}`);
      if (!data || !Array.isArray(data.items) || data.items.length > 100 || data.historySyncPending != null && typeof data.historySyncPending !== "boolean" || data.nextCursor != null && (typeof data.nextCursor !== "string" || !data.nextCursor || data.nextCursor.length > 4096)) throw new InvalidSupportData("Invalid order list");
      return { ...data, historySyncPending: data.historySyncPending ?? false, items: data.items.map(order) };
    },
    async getSupportOrder(audience: SupportAudience, handle: string, id: string) { return order(await call<SupportOrder>(audience, handle, `orders/${orderID(id)}`)); },
    async creditSupportCash(handle: string, conversationId: string, payload: SupportTopupInput) {
      const result = await call<SupportTopupReceipt>("operator", handle, `conversations/${positiveID(conversationId)}/topups`, { method: "POST", body: payload });
      if (!result || result.currency !== "CNY" || !Number.isSafeInteger(result.creditedCashMicro) || result.creditedCashMicro !== payload.amountMicro || !Number.isSafeInteger(result.cashBalanceMicro) || typeof result.duplicate !== "boolean") throw new InvalidSupportData("Invalid CNY receipt");
      positiveID(result.topupId); positiveID(result.ledgerId); changed(); return result;
    },
    async createSupportOrder(handle: string, conversationId: string, payload: SupportOrderCreate) { const result = order(await call<SupportOrder>("operator", handle, `conversations/${positiveID(conversationId)}/orders`, { method: "POST", body: payload })); changed(); return result; },
    async updateSupportOrder(handle: string, id: string, payload: SupportOrderPatch) { const result = order(await call<SupportOrder>("operator", handle, `orders/${orderID(id)}`, { method: "PATCH", body: payload })); changed(); return result; },
    async acceptSupportOrder(handle: string, id: string, version: number) { const result = order(await call<SupportOrder>("customer", handle, `orders/${orderID(id)}/accept`, { method: "POST", body: { version } })); changed(); return result; },
    async fulfillSupportOrder(handle: string, id: string, payload: { version: number; operationId: string; enableApiKeys: boolean }) { const result = order(await call<SupportOrder>("operator", handle, `orders/${orderID(id)}/fulfill`, { method: "POST", body: payload })); changed(); return result; },
    async getSupportCatalog(handle: string) { const data = await call<SupportCatalog>("operator", handle, "catalog"); if (!data || !Array.isArray(data.subscriptions) || !Array.isArray(data.tokenPlans ?? []) || !data.allowance || !data.subscriptions.every(plan => Number.isSafeInteger(plan.poolId) && plan.poolId > 0 && [1, 2, 4].includes(plan.tier) && Number.isSafeInteger(plan.monthlyMicro) && plan.monthlyMicro >= 0) || !(data.tokenPlans ?? []).every(plan => typeof plan.code === "string" && !!plan.code && plan.code.length <= 100 && typeof plan.name === "string" && !!plan.name && Number.isSafeInteger(plan.priceMicro) && plan.priceMicro > 0 && Number.isSafeInteger(plan.periodDays) && plan.periodDays > 0 && typeof plan.enabled === "boolean")) throw new InvalidSupportData("Invalid sales catalog"); return { ...data, tokenPlans: data.tokenPlans ?? [] }; },
    async listSupportCases(audience: SupportAudience, handle: string, reference: { orderId?: string; conversationId?: string } = {}, query: { status?: string; assignee?: string; cursor?: string; waitingOn?: "team" | "customer" | "none"; overdue?: boolean } = {}) {
      if (audience === "customer" && !reference.orderId && !reference.conversationId) throw new InvalidSupportData("Open a case context first");
      const params = new URLSearchParams({ limit: "100" }); if (query.cursor) params.set("cursor", query.cursor); if (query.status) params.set("status", query.status); if (query.assignee) params.set("assignee", positiveID(query.assignee));
      if (query.waitingOn) params.set("waitingOn", query.waitingOn); if (query.overdue) params.set("overdue", "true");
      const path = reference.orderId ? `orders/${orderID(reference.orderId)}/cases` : reference.conversationId ? `conversations/${positiveID(reference.conversationId)}/cases` : "cases";
      const data = await call<{ items: SupportCase[]; nextCursor: string | null; hasMore?: boolean }>(audience, handle, `${path}?${params}`);
      if (!data || !Array.isArray(data.items) || data.items.length > 100 || data.nextCursor !== null && (typeof data.nextCursor !== "string" || !data.nextCursor || data.nextCursor.length > 2048)) throw new InvalidSupportData("Invalid case list");
      return { ...data, items: data.items.map(supportCase) };
    },
    async getSupportCase(audience: SupportAudience, handle: string, id: string) { return supportCase(await call<SupportCase>(audience, handle, `cases/${orderID(id)}`)); },
    async createSupportCase(handle: string, id: string, payload: SupportCaseCreate) { bounded(payload.reason, 1000); const periods = payload.requestedPlanPeriods ?? 0; if (!payload.reason.trim() || !Number.isSafeInteger(payload.requestedHours) || payload.requestedHours < 0 || payload.requestedHours > 744 || !Number.isSafeInteger(periods) || periods < 0 || periods > 1) throw new InvalidSupportData("Invalid case request"); const result = supportCase(await call<SupportCase>("operator", handle, `orders/${orderID(id)}/cases`, { method: "POST", body: payload })); changed(); return result; },
    async updateSupportCase(handle: string, id: string, payload: SupportCasePatch) { const result = supportCase(await call<SupportCase>("operator", handle, `cases/${orderID(id)}`, { method: "PATCH", body: payload })); changed(); return result; },
    async executeSupportCase(handle: string, id: string, version: number) { const result = supportCase(await call<SupportCase>("operator", handle, `cases/${orderID(id)}/execute`, { method: "POST", body: { version } })); changed(); return result; },
    async acceptSupportCase(handle: string, id: string, version: number) { const result = supportCase(await call<SupportCase>("customer", handle, `cases/${orderID(id)}/accept`, { method: "POST", body: { version } })); changed(); return result; },
    async requoteSupportOrder(handle: string, id: string, payload: { version: number; reason: string; evidenceMessageId?: string | null; evidenceAttachmentId?: string | null }) { const result = order(await call<SupportOrder>("operator", handle, `orders/${orderID(id)}/requote`, {method:"POST",body:payload}));changed();return result; },
    async confirmSupportOrderPurchase(handle: string, id: string, input: { version: number; operationId: string; quoteHash: string; maxChargeMicro: number }) { const result = order(await call<SupportOrder>("customer", handle, `orders/${orderID(id)}/confirm-purchase`, {method:"POST",body:input}));changed();return result; },
    async confirmSupportOrderQuote(handle: string, id: string, version: number) { const result = order(await call<SupportOrder>("customer", handle, `orders/${orderID(id)}/confirm-quote`, {method:"POST",body:{version}}));changed();return result; },
    async disputeSupportOrder(handle: string, id: string, version: number, reason: string) { bounded(reason, 4000); if (!reason.trim()) throw new InvalidSupportData("A problem description is required"); const result = order(await call<SupportOrder>("customer", handle, `orders/${orderID(id)}/dispute`, { method: "POST", body: { version, reason } })); changed(); return result; },
    async disputeSupportCase(handle: string, id: string, version: number, reason: string) { bounded(reason, 4000); if (!reason.trim()) throw new InvalidSupportData("A problem description is required"); const result = supportCase(await call<SupportCase>("customer", handle, `cases/${orderID(id)}/dispute`, { method: "POST", body: { version, reason } })); changed(); return result; },
    async setSupportRefundPlan(handle: string, id: string, payload: SupportRefundPlan) { const result = supportCase(await call<SupportCase>("operator", handle, `cases/${orderID(id)}/refund-plan`, { method: "POST", body: payload })); changed(); return result; },
    async recordSupportRefundChannel(handle: string, id: string, payload: SupportRefundChannel) { const result = supportCase(await call<SupportCase>("operator", handle, `cases/${orderID(id)}/refund-channel`, { method: "POST", body: payload })); changed(); return result; },
    async reviewSupportRefundChannel(handle: string, id: string, version: number, note: string) { const result = supportCase(await call<SupportCase>("operator", handle, `cases/${orderID(id)}/refund-review`, { method: "POST", body: { version, note } })); changed(); return result; },
    async reverseSupportCase(handle: string, id: string, payload: SupportCaseReverse) { const result = supportCase(await call<SupportCase>("operator", handle, `cases/${orderID(id)}/reverse`, { method: "POST", body: payload })); changed(); return result; },
    async getSupportCompensationReport(handle: string, month: string) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new InvalidSupportData("Invalid report month");
      const data = await call<SupportCompensationReport>("operator", handle, `compensation-report?month=${encodeURIComponent(month)}`);
      if (!data || data.month !== month || !Array.isArray(data.items)) throw new InvalidSupportData("Invalid compensation report");
      for (const item of data.items) { positiveID(item.userId); for (const value of [item.allowanceMicro, item.hours, item.planPeriods, item.caseCount]) if (!Number.isSafeInteger(value) || value < 0) throw new InvalidSupportData("Invalid compensation totals"); }
      return data;
    },
    async listSupportOperators(handle: string) {
      const data = await call<{ items: SupportOperatorDto[] }>("operator", handle, "operators");
      if (!data || !Array.isArray(data.items)) throw new InvalidSupportData("Invalid operator list");
      return data.items.map(dto => ({ id: positiveID(dto.id), name: bounded(dto.name, 100), email: dto.email ? bounded(dto.email, 254) : "" }));
    },
    async listSupportOperations(handle: string, userId?: string, query: { cursor?: string; limit?: number } = {}) {
      const limit = query.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || query.cursor !== undefined && (!query.cursor || query.cursor.length > 2048)) throw new InvalidSupportData("Invalid operation pagination");
      const params = new URLSearchParams({status:"pending",limit:String(limit)});
      if(userId)params.set("userId",positiveID(userId));if(query.cursor)params.set("cursor",query.cursor);
      const data = await call<SupportOperationPage>("operator", handle, `operations?${params}`);
      if (!data || !Array.isArray(data.items) || data.items.length > limit || typeof data.hasMore !== "boolean" || !Number.isSafeInteger(data.totalPending) || data.totalPending < 0 || (data.nextCursor !== null && (typeof data.nextCursor !== "string" || !data.nextCursor || data.nextCursor.length > 2048)) || data.hasMore !== (data.nextCursor !== null)) throw new InvalidSupportData("Invalid operation list");
      return { ...data, items: data.items.map(operation) };
    },
    async getSupportOperation(handle: string, id: string) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new InvalidSupportData("Invalid operation identity"); return operation(await call<SupportOperation>("operator", handle, `operations/${id}`)); },
    async reconcileSupportOperation(handle: string, id: string, payload: { action: "confirm_committed" | "confirm_not_executed" | "needs_review"; note: string; version: number }) { if (!/^[a-f0-9-]{36}$/.test(id)) throw new InvalidSupportData("Invalid operation identity"); const result = operation(await call<SupportOperation>("operator", handle, `operations/${id}/reconcile`, { method: "POST", body: payload })); changed(); return result; },
    async endSupportSession(handle: string) {
      const state = operatorLogout?.handle === handle ? operatorLogout : requireState("operator", handle);
      operatorLogout = state;
      for (const stream of [...state.streams]) stream.close();
      // Revocation can expire SSE before this response arrives. Keep this exact
      // logout intent independent of the expired reads' AbortController, also
      // on retry after a lost response. Never bootstrap a replacement session.
      const value = await request<SupportApiResponse<null>>("/api/support/session", { method: "DELETE", body: {}, headers: headers("operator", state) });
      if (operatorLogout !== state || states.operator && states.operator !== state) throw new SupportSessionEnded("Operator session changed");
      if (!value || value.ok !== true || value.data !== null) throw new InvalidSupportData("Invalid support logout response");
      operatorLogout = undefined;
      invalidate("operator", false);
      authChanged("operator", state.authMethod === "access" ? "/cdn-cgi/access/logout" : undefined);
    },
    async readSupport(handle?: string): Promise<SupportConversation[]> {
      const agent = handle ? { session: handle } : await readSupportSession();
      if (!agent) throw new SupportSessionEnded("Operator sign-in required");
      requireState("operator", agent.session);
      const summaries = await pages<SupportConversationSummaryDto>("operator", agent.session, "conversations", 100);
      const output: SupportConversation[] = new Array(summaries.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, summaries.length) }, async () => {
        while (next < summaries.length) { const index = next++; output[index] = await get("operator", agent.session, positiveID(summaries[index].id)); }
      }));
      requireState("operator", agent.session);
      return output;
    },
    sendUserMessage(handle: string, text: string, attachment?: SupportImage, sharedOrderId?: string) { requireState("customer", handle); if (!customerConversationId) throw new InvalidSupportData("Open a support conversation first"); return send("customer", handle, customerConversationId, text, attachment, sharedOrderId); },
    async endUserConversation(handle: string, conversation: SupportConversation) {
      requireState("customer", handle);
      const id = positiveID(conversation.id);
      if (id !== customerConversationId) throw new InvalidSupportData("Open your current support conversation first");
      // Use the caller's visible snapshot, rather than a newer background cache.
      // A reply arriving after this snapshot must cause a server conflict.
      const last = conversation.messages.at(-1);
      await call<SupportConversationSummaryDto>("customer", handle, `conversations/${id}/end`, { method: "POST", body: { lastMessageId: last ? positiveID(last.id) : null } });
      const result = await get("customer", handle, id);
      changed();
      return result;
    },
    sendAgentMessage(handle: string, id: string, text: string, attachment?: SupportImage) { return send("operator", handle, id, text, attachment); },
    markUserRead(handle: string, through?: number) { requireState("customer", handle); if (!customerConversationId) return Promise.resolve(); return markRead("customer", handle, customerConversationId, through); },
    markAgentRead(handle: string, id: string, through?: number) { return markRead("operator", handle, positiveID(id), through); },
    async setConversationStatus(handle: string, id: string, status: "open" | "resolved") { await call("operator", handle, `conversations/${positiveID(id)}/status`, { method: "PATCH", body: { status } }); changed(); },
    async readUserTyping(handle: string) { requireState("customer", handle); if (!customerConversationId) return false; return typing(await call<SupportTypingStateDto>("customer", handle, `conversations/${customerConversationId}/typing`)).agent; },
    async setUserTyping(handle: string, typing: boolean, sourceId: string) { requireState("customer", handle); if (customerConversationId) await call("customer", handle, `conversations/${customerConversationId}/typing`, { method: "PUT", body: { typing, sourceId } }); },
    async readAgentTyping(handle: string, id: string) { return typing(await call<SupportTypingStateDto>("operator", handle, `conversations/${positiveID(id)}/typing`)).user; },
    async setAgentTyping(handle: string, id: string, typing: boolean, sourceId: string) { await call("operator", handle, `conversations/${positiveID(id)}/typing`, { method: "PUT", body: { typing, sourceId } }); },
    async readSupportAvailability(handle: string) { return boolean((await call<{ online: boolean }>("customer", handle, "availability"))?.online); },
    async setAgentAvailability(handle: string, online: boolean, sourceId: string) { await call("operator", handle, "session/availability", { method: "PUT", body: { online, sourceId } }); },
  };
}

export const supportHttp = createSupportHttpService();
if (typeof window !== "undefined") {
  window.addEventListener(SESSION_CHANNEL, event => supportHttp.handleSessionChange((event as CustomEvent).detail));
  // Deliver invalidation and UI navigation in one synchronous event. Separate
  // BroadcastChannel listeners allow an aborted read's microtask to navigate
  // before the console has received the same logout redirect.
  try { const channel = new BroadcastChannel(SESSION_CHANNEL); channel.onmessage = event => window.dispatchEvent(new CustomEvent(SESSION_CHANNEL, { detail: event.data })); } catch { /* Cookie checks remain authoritative. */ }
}
