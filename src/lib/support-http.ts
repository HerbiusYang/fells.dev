import { api, APIError, type APIOptions } from "./app-http.ts";
import { InvalidSupportData, SupportSessionEnded, MAX_SUPPORT_TEXT, validateSupportImage, type SupportAgent, type SupportConversation, type SupportImage, type SupportMessage } from "./support-store.ts";
import type { SupportApiResponse, SupportAttachmentDto, SupportConversationDto, SupportConversationSummaryDto, SupportCursorPage, SupportEventDto, SupportMessageDto, SupportSessionDto, SupportTypingStateDto } from "./support-api.ts";

export const SESSION_CHANNEL = "fells.session.changed";
const SUPPORT_CHANNEL_HTTP = "fells.support.changed.v1";
export type SupportAudience = "customer" | "operator";
export type CustomerSupportSession = { session: string; userId: string };
type Request = <T>(path: string, options?: APIOptions) => Promise<T>;
type EventStream = Pick<EventSource, "addEventListener" | "close"> & { onerror: ((event: Event) => void) | null };
type State = { id: string; fingerprint: string; handle: string; controller: AbortController; streams: Set<{ close(): void; expired(): void }> };
type Pending = { content: string; clientId: string; attachmentId?: string };
type Options = { request?: Request; eventSource?: (url: string) => EventStream; notify?: (name: string, detail: unknown) => void };

const positiveID = (value: unknown): string => {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/.test(id)) throw new InvalidSupportData("Invalid server identity");
  return id;
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
  let customerConversationId = "";
  const notify = options.notify ?? ((name: string, detail: unknown) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
    try { const channel = new BroadcastChannel(name); channel.postMessage(detail); channel.close(); } catch { /* SSE and focus refresh remain available. */ }
  });
  const changed = () => notify(SUPPORT_CHANNEL_HTTP, { source });
  const authChanged = (audience: SupportAudience) => notify(SESSION_CHANNEL, { audience, source });
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
  function bind(audience: SupportAudience, id: string, fingerprint: string): State {
    const previous = states[audience];
    if (previous?.id === id && previous.fingerprint === fingerprint) return previous;
    invalidate(audience);
    return states[audience] = { id, fingerprint, handle: crypto.randomUUID(), controller: new AbortController(), streams: new Set() };
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
      if (failure instanceof APIError && failure.status === 401) { invalidate(audience); throw new SupportSessionEnded("Support sign-in required"); }
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
  function message(dto: SupportMessageDto, id: string, audience: SupportAudience): SupportMessage {
    if (!dto || positiveID(dto.conversationId) !== id || dto.sender !== "user" && dto.sender !== "agent" || !Array.isArray(dto.attachments) || dto.attachments.length > 1) throw new InvalidSupportData("Invalid server message");
    const text = bounded(dto.text, MAX_SUPPORT_TEXT), media = dto.attachments[0] ? image(dto.attachments[0], audience) : undefined;
    if (!text.trim() && !media) throw new InvalidSupportData("Empty server message");
    return { id: positiveID(dto.id), sender: dto.sender, text, created: timestamp(dto.createdAt), ...(media ? { image: media } : {}) };
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
    if (customer.creditsCurrency !== "USD" || customer.creditsKind !== "api_allowance" || !dto.userRead || !dto.agentRead || !Number.isSafeInteger(customer.workspaceCount) || customer.workspaceCount < 0 || !Number.isFinite(customer.credits) || customer.credits < 0) throw new InvalidSupportData("Invalid customer profile");
    const result: SupportConversation = {
      id, user: { id: positiveID(customer.id), name: bounded(customer.name, 100), email: bounded(customer.email, 254), joined: timestamp(customer.joinedAt), locale: bounded(customer.preferredLocale, 35), workspaceCount: customer.workspaceCount, credits: customer.credits },
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
      if (failure instanceof APIError && failure.status === 401) { invalidate("operator"); throw new SupportSessionEnded("Operator session ended"); }
      throw failure;
    });
    if (generation !== generations.operator) throw new SupportSessionEnded("Operator session changed");
    if (!value || value.ok !== true) throw new InvalidSupportData("Invalid operator response");
    if (!value.data) { invalidate("operator"); return null; }
    const dto = value.data;
    timestamp(dto.expiresAt);
    const bound = bind("operator", positiveID(dto.operator.id), sessionID(dto.sessionId));
    return { session: bound.handle, name: bounded(dto.operator.name, 100), email: bounded(dto.operator.email, 254) };
  }
  async function ensureUserConversation(snapshot: CustomerSupportSession, _locale: string): Promise<SupportConversation> {
    requireState("customer", snapshot.session);
    let dto = await call<SupportConversationDto | null>("customer", snapshot.session, "conversations/current");
    if (!dto) dto = await call<SupportConversationDto>("customer", snapshot.session, "conversations/current", { method: "POST", body: {} });
    const conversation = await load("customer", snapshot.session, dto);
    customerConversationId = conversation.id;
    return conversation;
  }
  async function send(audience: SupportAudience, handle: string, id: string, text: string, attachment?: SupportImage) {
    const state = requireState(audience, handle), key = cacheKey(state, positiveID(id));
    if (typeof text !== "string" || text.length > MAX_SUPPORT_TEXT || !text.trim() && !attachment) throw new InvalidSupportData("Invalid message text");
    const prepared = attachment ? validateSupportImage(attachment) : undefined;
    const content = JSON.stringify([text, prepared ?? null]);
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
    await call<SupportMessageDto>(audience, handle, `conversations/${id}/messages`, { method: "POST", body: { clientMessageId: intent.clientId, text, attachmentIds: intent.attachmentId ? [intent.attachmentId] : [] } });
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
    const stream = createStream("/api/support/events?" + query);
    let closed = false;
    const connection = {
      close() { if (closed) return; closed = true; stream.close(); state.streams.delete(connection); },
      expired() { onEvent({ id: "", type: "session.expired", data: { role: audience === "customer" ? "user" : "agent" } }); },
    };
    state.streams.add(connection);
    const receive = (event: Event) => {
      if (closed || states[audience] !== state) return;
      let value: SupportEventDto;
      try { value = JSON.parse((event as MessageEvent).data); } catch { return; }
      if (!value || typeof value.id !== "string" || typeof value.type !== "string" || !value.data) return;
      if (value.type === "session.expired") { invalidate(audience); return; }
      onEvent(value);
    };
    for (const kind of ["message.created", "conversation.updated", "conversation.read", "conversation.typing", "session.expired"]) stream.addEventListener(kind, receive);
    let probing = false;
    stream.onerror = () => {
      if (closed || probing || states[audience] !== state) return;
      probing = true;
      // EventSource cannot expose an HTTP 401. Verify through the ordinary
      // identity endpoint; transient failures leave native reconnection active.
      void (audience === "customer" ? readCustomerSession() : readSupportSession()).then(active => {
        if (!closed && (!active || active.session !== handle)) invalidate(audience);
      }).catch(failure => { if (!closed && failure instanceof SupportSessionEnded) invalidate(audience); }).finally(() => { probing = false; });
    };
    return connection;
  }
  return {
    invalidateSession: invalidate,
    handleSessionChange(detail: unknown) {
      const value = detail as { audience?: SupportAudience; source?: string } | null;
      if (value?.source === source) return;
      if (!value?.audience || value.audience === "customer") invalidate("customer");
      if (!value?.audience || value.audience === "operator") invalidate("operator");
    },
    readCustomerSession, readSupportSession, ensureUserConversation, openSupportEvents,
    async beginSupportSession(email: string, password: string): Promise<SupportAgent> {
      const value = await request<SupportApiResponse<SupportSessionDto>>("/api/support/session", { method: "POST", body: { email, password }, headers: { "X-Fells-Support-Audience": "operator" } });
      if (!value || value.ok !== true || !value.data) throw new InvalidSupportData("Invalid support sign-in response");
      invalidate("operator");
      const dto = value.data;
      timestamp(dto.expiresAt);
      const state = bind("operator", positiveID(dto.operator.id), sessionID(dto.sessionId));
      authChanged("operator");
      return { session: state.handle, name: bounded(dto.operator.name, 100), email: bounded(dto.operator.email, 254) };
    },
    async endSupportSession(handle: string) { await call("operator", handle, "session", { method: "DELETE", body: {} }); invalidate("operator"); authChanged("operator"); },
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
    sendUserMessage(handle: string, text: string, attachment?: SupportImage) { requireState("customer", handle); if (!customerConversationId) throw new InvalidSupportData("Open a support conversation first"); return send("customer", handle, customerConversationId, text, attachment); },
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
  try { const channel = new BroadcastChannel(SESSION_CHANNEL); channel.onmessage = event => supportHttp.handleSessionChange(event.data); } catch { /* Cookie checks remain authoritative. */ }
}
