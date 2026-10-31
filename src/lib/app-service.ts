// Real /app persistence. Preview storage remains available only to the explicit
// preview; financial balances and execution results never enter its state blob.
import { api, APIError, API_READ_TIMEOUT_MS, type APIOptions } from "./app-http.ts";
import { freshState, MAX_MESSAGE, InvalidState, type PreviewState, type Ws, type Chat } from "./preview-state.ts";
import { StaleState, EndedSession, type Snapshot } from "./preview-store.ts";
import { conversationKey } from "./model-chat.ts";
import type { AccountFundingBalance } from "./account-funding.ts";
import { parseChatAttachment, type ChatAttachment } from "./chat-attachments.ts";
import { parseChatRefusal, type ChatRefusalDetails } from "./chat-refusal.ts";
import { readChatStream, MAX_CHAT_STREAM_SEQ, type ChatStreamFrame, type ChatStreamProgress } from "./chat-stream.ts";
import { isBusinessBlocked } from "./maintenance.ts";
export { StaleState, EndedSession } from "./preview-store.ts";
export type { Snapshot } from "./preview-store.ts";

const APP_CHANNEL = "fells.app.changed.v1";
const APP_CHANGE_SOURCE = crypto.randomUUID();
export type AppIdentity = Pick<Snapshot, "session" | "revision">;
export class UnconfirmedChatDeletion extends Error {
  cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Deletion result is unconfirmed");
    this.name = "UnconfirmedChatDeletion"; this.cause = cause;
  }
}
export type AppWorkspaceRole = "owner" | "editor" | "viewer";
type AppWorkspace = Ws & { role: AppWorkspaceRole };
export type AppMessageMetadata = { id: string; created: number; imported: boolean; author_user_id?: number; author_name?: string; attachments?: ChatAttachment[] };
export type AppMember = { user_id: number; name: string; role: AppWorkspaceRole };
export type AppPendingInvitation = { id: string; label: string; role: "editor" | "viewer"; created: number; expires: number };
export type AppReceivedInvitation = { id: string; workspace_id: string; workspace_name: string; role: "editor" | "viewer"; inviter_name: string; created: number; expires: number };
export type AppKey = { id: number; name: string; prefix: string; created_at: number; revoked: boolean; monthly_allow_limit_micro: number; [key: string]: unknown };
export type AppChatRunStatus = "pending" | "running" | "completed" | "failed" | "unknown";
export type AppChatRun = { request_id: string; status: AppChatRunStatus; id?: string; chat_id?: string; error_code?: string; message_id?: string; assistant_message_id?: string; created?: number; updated?: number; refusal?: ChatRefusalDetails };
export type AppChatInput = { request_id: string; body: string; model: string; web_search?: boolean; attachment_ids?: string[]; stream_updates?: boolean } & ({ billing_mode: "account_allowance"; key_id?: never } | { key_id: number; billing_mode?: never });
export type AppChatResult = { snapshot: Snapshot | null; run: AppChatRun | null; error?: unknown; refusal?: ChatRefusalDetails };
export type AppChatStreamEvent = Extract<ChatStreamFrame, { type: "delta" | "progress" }>
  | { type: "snapshot"; seq: number; text: string; progress: ChatStreamProgress; run: AppChatRun; live: boolean; cancel_available: boolean }
  | { type: "terminal"; seq: number; run: AppChatRun };
export type AppBootstrap = {
  schema_version: number; session_id: string;
  user: { id: number; username: string; email: string; name: string; joined_at: number; self_keys: boolean; self_keys_exchange_blocked?: boolean };
  wallet: { currency: "CNY"; cash_micro: number; grant_micro: number; grant_expires_at: number };
  api_allowance: { currency: "USD"; balance: AccountFundingBalance & { expires_at: number; [key: string]: unknown }; term_months: number; price_cny?: number };
  agreement: Record<string, unknown>; capabilities: Record<string, boolean>;
};
export type AppAccount = Pick<AppBootstrap, "user" | "wallet" | "api_allowance" | "agreement" | "capabilities">;
type Remote = {
  state: PreviewState; bootstrap: AppBootstrap; roles: Map<string, AppWorkspaceRole>;
  metadata: Map<string, AppMessageMetadata[]>; keys: AppKey[];
};
type Active = Remote & { snapshot: Snapshot };
let active: Active | null = null;
let epoch = 0;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(run: () => Promise<T>): Promise<T> {
  const pending = queue.then(run, run);
  queue = pending.catch(() => undefined);
  return pending;
}
const copy = <T>(value: T): T => structuredClone(value);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function invalid(message: string): never { throw new InvalidState(message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Invalid server object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200): string {
  if (typeof value !== "string" || value.length > max) return invalid("Invalid text field");
  return value;
}
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid("Invalid integer field");
  return value;
}
function signedInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : invalid("Invalid integer field");
}
function keyLimit(value: unknown): number {
  return value === -1 ? -1 : number(value);
}
function positive(value: unknown): number { const n = number(value); return n > 0 ? n : invalid("Invalid user ID"); }
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : invalid("Invalid boolean field"); }
function id(value: unknown, empty = false): string {
  const v = text(value, 64);
  if (empty && v === "") return v;
  return /^[a-zA-Z0-9_-]+$/.test(v) && !["__proto__", "prototype", "constructor", "example"].includes(v) ? v : invalid("Invalid resource ID");
}
function array<T>(value: unknown, parse: (item: unknown) => T, max = Number.MAX_SAFE_INTEGER): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid("Invalid list");
  return value.map(parse);
}
function unique<T extends { id: string }>(values: T[]): T[] {
  return new Set(values.map(v => v.id)).size === values.length ? values : invalid("Duplicate resource ID");
}
function workspace(value: unknown): AppWorkspace {
  const v = object(value), tz = text(v.tz, 100);
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { invalid("Invalid time zone"); }
  const role = v.role;
  if (!["owner", "editor", "viewer"].includes(String(role))) invalid("Invalid workspace role");
  return { id: id(v.id), name: text(v.name, 60), region: id(v.region), tz, created: number(v.created, 8.64e15), role: role as AppWorkspaceRole };
}
function invitationRole(value: unknown): "editor" | "viewer" {
  if (value !== "editor" && value !== "viewer") invalid("Invalid invitation role");
  return value;
}
function pendingInvitation(value: unknown): AppPendingInvitation {
  const v = object(value);
  return { id: id(v.id), label: text(v.label, 1000), role: invitationRole(v.role),
    created: number(v.created), expires: number(v.expires) };
}
function receivedInvitation(value: unknown): AppReceivedInvitation {
  const v = object(value);
  return { id: id(v.id), workspace_id: id(v.workspace_id), workspace_name: text(v.workspace_name, 60),
    role: invitationRole(v.role), inviter_name: text(v.inviter_name, 1000),
    created: number(v.created), expires: number(v.expires) };
}
function chat(value: unknown): Chat {
  const v = object(value);
  return { id: id(v.id), ws: id(v.ws), title: text(v.title, 100), agent: id(v.agent), model: text(v.model), created: number(v.created, 8.64e15),
    messages: array(v.messages, m => { if (!Array.isArray(m) || m.length !== 2) return invalid("Invalid message tuple"); return [text(m[0], 100), text(m[1], MAX_MESSAGE)] as [string, string]; }, 500) };
}
function messageMetadata(value: unknown): AppMessageMetadata {
  const v = object(value);
  const out: AppMessageMetadata = { id: id(v.id), created: number(v.created, 8.64e15), imported: boolean(v.imported) };
  if (v.author_user_id !== undefined) out.author_user_id = positive(v.author_user_id);
  if (v.author_name !== undefined) out.author_name = text(v.author_name, 1000);
  if (v.attachments !== undefined) {
    out.attachments = array(v.attachments, parseChatAttachment, 4);
    if (new Set(out.attachments.map(file => file.id)).size !== out.attachments.length || out.attachments.some(file => file.message_id !== out.id)) invalid("Invalid message attachment binding");
  }
  return out;
}
function avatar(value: unknown): number | string {
  if (typeof value === "number") return number(value, 7);
  const v = text(value, 100_000);
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(v)) return v;
  // Only this private, authenticated endpoint is allowed as a remote avatar.
  const base = typeof location === "undefined" ? "http://localhost" : location.origin;
  let url: URL;
  try { url = new URL(v, base); } catch { return invalid("Invalid avatar URL"); }
  if (url.origin !== base || url.pathname !== "/api/app/avatar" || url.username || url.password || url.hash) return invalid("Invalid avatar URL");
  return url.pathname + url.search;
}
function preferences(value: unknown): Pick<PreviewState, "theme" | "prefs" | "notifs" | "onboarded" | "answers" | "promoClosed" | "sbHidden"> {
  const v = object(value), p = object(v.prefs);
  if (!["system", "light", "dark"].includes(String(v.theme))) invalid("Invalid theme");
  const notifs = array(v.notifs, boolean, 4), answers = array(v.answers, a => array(a, n => number(n, 20), 20), 4);
  if (notifs.length !== 4 || answers.length !== 4) invalid("Invalid preference dimensions");
  return { theme: v.theme as PreviewState["theme"], prefs: { agent: id(p.agent, true), send: number(p.send, 1) }, notifs, answers,
    onboarded: boolean(v.onboarded), promoClosed: boolean(v.promoClosed), sbHidden: boolean(v.sbHidden) };
}
function bootstrap(value: unknown): AppBootstrap {
  const v = object(value), u = object(v.user), w = object(v.wallet), a = object(v.api_allowance), balance = object(a.balance), caps = object(v.capabilities);
  const funding = { ...balance };
  const availability = ["available_micro", "available_plan_micro", "available_comp_micro"] as const;
  const completeAvailability = availability.every(field => typeof balance[field] === "number" && Number.isSafeInteger(balance[field]));
  for (const field of availability) {
    if (completeAvailability) funding[field] = signedInteger(balance[field]);
    else delete funding[field];
  }
  for (const field of ["reserved_micro", "pending_micro"] as const) if (balance[field] !== undefined) funding[field] = number(balance[field]);
  if (w.currency !== "CNY" || a.currency !== "USD" || !/^[a-f0-9]{64}$/.test(String(v.session_id))) invalid("Invalid account currency or session");
  for (const enabled of Object.values(caps)) boolean(enabled);
  return { schema_version: number(v.schema_version), session_id: String(v.session_id),
    user: { id: positive(u.id), username: text(u.username, 1000), email: text(u.email, 10000), name: text(u.name, 100), joined_at: number(u.joined_at), self_keys: boolean(u.self_keys), ...(u.self_keys_exchange_blocked === undefined ? {} : { self_keys_exchange_blocked: boolean(u.self_keys_exchange_blocked) }) },
    wallet: { currency: "CNY", cash_micro: number(w.cash_micro), grant_micro: number(w.grant_micro), grant_expires_at: number(w.grant_expires_at) },
    api_allowance: { currency: "USD", balance: { ...funding, micro: signedInteger(balance.micro), expires_at: number(balance.expires_at), ...(balance.plan_micro === undefined ? {} : { plan_micro: number(balance.plan_micro) }), ...(balance.comp_micro === undefined ? {} : { comp_micro: number(balance.comp_micro) }) }, term_months: number(a.term_months), ...(a.price_cny === undefined ? {} : { price_cny: typeof a.price_cny === "number" && Number.isFinite(a.price_cny) && a.price_cny >= 0 ? a.price_cny : invalid("Invalid allowance price") }) },
    agreement: object(v.agreement), capabilities: caps as Record<string, boolean> };
}
function guardHeaders(b: AppBootstrap): Record<string, string> {
  return { "X-Fells-Expected-User": String(b.user.id), "X-Fells-Expected-Session": b.session_id };
}
function checkEpoch(expectedEpoch: number) { if (epoch !== expectedEpoch) throw new EndedSession("Account session changed"); }
function invalidate() { epoch++; active = null; }
function isUnauthorized(error: unknown) { return error instanceof APIError && error.status === 401; }
async function guarded<T>(b: AppBootstrap, expectedEpoch: number, path: string, options: APIOptions = {}, verifyGenerationUnauthorized = false): Promise<T> {
  checkEpoch(expectedEpoch);
  options.signal?.throwIfAborted();
  try {
    const result = await api<T>(path, { ...options, headers: { ...options.headers, ...guardHeaders(b) } });
    checkEpoch(expectedEpoch);
    options.signal?.throwIfAborted();
    return result;
  } catch (error) {
    if (isUnauthorized(error)) {
      if (verifyGenerationUnauthorized) {
        // A dispatched model call may return its provider's HTTP 401. Verify
        // the current cookie independently before accepting any run receipt.
        await identity(expectedEpoch, b);
        throw error;
      }
      if (epoch === expectedEpoch) invalidate();
      throw new EndedSession("Account session ended or changed");
    }
    checkEpoch(expectedEpoch);
    throw error;
  }
}
async function identity(expectedEpoch: number, expected?: AppBootstrap, signal?: AbortSignal): Promise<AppBootstrap> {
  checkEpoch(expectedEpoch);
  signal?.throwIfAborted();
  let value: unknown;
  try { value = await api("/api/app/bootstrap", { signal }); }
  catch (error) {
    checkEpoch(expectedEpoch);
    if (expected && isUnauthorized(error)) {
      invalidate(); throw new EndedSession("Account session ended or changed");
    }
    throw error;
  }
  signal?.throwIfAborted();
  const b = bootstrap(value);
  checkEpoch(expectedEpoch);
  if (expected && (b.user.id !== expected.user.id || b.session_id !== expected.session_id)) {
    invalidate(); throw new EndedSession("Account session changed");
  }
  return b;
}
const currentKey = (b: AppBootstrap) => `fells.app.current.${b.user.id}`;
function localCurrent(b: AppBootstrap, list: Ws[]): string {
  let selected = "";
  try { selected = sessionStorage.getItem(currentKey(b)) ?? ""; } catch { /* Browser storage is optional. */ }
  const valid = (value: string) => value === "example" || list.some(w => w.id === value);
  if (valid(selected)) return selected;
  // Keep this page's selection when optional storage is blocked or evicted.
  // The exact cookie identity prevents a replacement login inheriting it.
  if (active?.bootstrap.user.id === b.user.id && active.bootstrap.session_id === b.session_id && valid(active.state.current)) return active.state.current;
  return list[0]?.id ?? "";
}
function storeCurrent(b: AppBootstrap, selected: string) {
  try { sessionStorage.setItem(currentKey(b), selected); } catch { /* It remains selected for this page. */ }
}
async function readRemote(expectedEpoch: number, expected?: AppBootstrap, signal?: AbortSignal): Promise<Remote> {
  const b = await identity(expectedEpoch, expected, signal);
  const [profileValue, prefValue, wsValue, keysValue] = await Promise.all([
    guarded<unknown>(b, expectedEpoch, "/api/app/profile", { signal }), guarded<unknown>(b, expectedEpoch, "/api/app/preferences", { signal }),
    guarded<unknown>(b, expectedEpoch, "/api/app/workspaces", { signal }), guarded<unknown>(b, expectedEpoch, "/api/app/keys", { signal }),
  ]);
  const profile = object(profileValue), p = object(profile.profile);
  const workspaces = unique(array(object(wsValue).workspaces ?? [], workspace, 50));
  const roles = new Map(workspaces.map(w => [w.id, w.role] as const));
  const allChats: Chat[] = [], metadata = new Map<string, AppMessageMetadata[]>();
  // Keep four slots busy instead of waiting for the slowest request of each
  // batch. Preserve workspace order and validate the complete snapshot before
  // exposing it, including the final cookie-identity check below.
  const pages: { workspace: string; chats: unknown[] }[] = new Array(workspaces.length);
  let nextWorkspace = 0, workspaceReadFailed = false;
  await Promise.all(Array.from({ length: Math.min(4, workspaces.length) }, async () => {
    while (!workspaceReadFailed && nextWorkspace < workspaces.length) {
      const index = nextWorkspace++, w = workspaces[index];
      try {
        const response = await guarded<{ chats: unknown[] | null }>(b, expectedEpoch, `/api/app/workspaces/${encodeURIComponent(w.id)}/chats`, { signal });
        pages[index] = { workspace: w.id, chats: response.chats ?? [] };
      } catch (error) { workspaceReadFailed = true; throw error; }
    }
  }));
  for (const page of pages) for (const raw of page.chats) {
    const c = chat(raw), md = array(object(raw).message_metadata ?? [], messageMetadata, 500);
    if (c.ws !== page.workspace || md.length !== c.messages.length || new Set(md.map(m => m.id)).size !== md.length) invalid("Invalid message ownership metadata");
    allChats.push(c); metadata.set(c.id, md);
  }
  unique(allChats);
  const keys = array(object(keysValue).keys ?? [], raw => {
    const k = object(raw);
    return { ...k, id: positive(k.id), name: text(k.name, 1000), prefix: text(k.prefix, 200), created_at: number(k.created_at),
      revoked: boolean(k.revoked), monthly_allow_limit_micro: keyLimit(k.monthly_allow_limit_micro ?? 0) } as AppKey;
  });
  if (new Set(keys.map(k => k.id)).size !== keys.length) invalid("Duplicate Key ID");
  const state: PreviewState = { ...freshState(), ...preferences(prefValue), profile: { name: text(p.name, 100), avatar: avatar(p.avatar) },
    email: text(profile.email, 10000), joined: b.user.joined_at * 1000,
    workspaces: workspaces.map(({ role: _role, ...w }) => w), current: localCurrent(b, workspaces), chats: allChats,
    keys: keys.filter(k => !k.revoked).map(k => ({ id: String(k.id), name: k.name, prefix: k.prefix, limit: k.monthly_allow_limit_micro === -1 ? -1 : k.monthly_allow_limit_micro / 1e6, created: k.created_at * 1000, last4: "" })),
    // These old display fields have no matching backend product. Never map CNY
    // cash, grants, or USD allowance into the three fictional USD credit buckets.
    credits: { bonus: 0, never: 0, period: 0 } };
  const final = await identity(expectedEpoch, b, signal);
  return { state, bootstrap: final, roles, metadata, keys };
}
function fingerprint(remote: Remote) {
  // Request counters / last-used timestamps may change continuously while a
  // model client is active. They do not make an unrelated profile save stale.
  return JSON.stringify([remote.state, [...remote.roles], [...remote.metadata]]);
}
async function readTargetRemote(expectedEpoch: number, before: Active, chatID: string): Promise<Remote> {
  const old = before.state.chats.find(c => c.id === chatID);
  if (!old) invalid("Unknown conversation");
  const b = await identity(expectedEpoch, before.bootstrap);
  const raw = object((await guarded<{ chat: unknown }>(b, expectedEpoch, `/api/app/chats/${encodeURIComponent(chatID)}`)).chat);
  const latest = chat(raw), metadata = array(raw.message_metadata ?? [], messageMetadata, 500);
  if (latest.id !== chatID || latest.ws !== old.ws || metadata.length !== latest.messages.length || new Set(metadata.map(m => m.id)).size !== metadata.length) invalid("Invalid message ownership metadata");
  const final = await identity(expectedEpoch, b);
  const next: Remote = { ...before, bootstrap: final, state: copy(before.state), metadata: new Map(before.metadata) };
  next.state.chats = next.state.chats.map(c => c.id === chatID ? latest : c); next.metadata.set(chatID, metadata);
  return next;
}
export function readAppChat(expected: AppIdentity, chatID: string): Promise<Snapshot> {
  id(chatID);
  return serial(async () => {
    const before = expectedSession(expected), next = await readTargetRemote(epoch, before, chatID);
    if (expectedSession(expected).snapshot.revision !== before.snapshot.revision) throw new StaleState("Account data changed while loading this conversation");
    return adopt(next);
  });
}
// A confirmed read-authorization rejection must remove cached private history
// immediately. This changes no server record and cannot schedule a DELETE.
export function discardAppChatCache(expected: AppIdentity, chatID: string): Snapshot {
  const before = expectedSession(expected);
  const next: Remote = { ...before, state: copy(before.state), metadata: new Map(before.metadata) };
  next.state.chats = next.state.chats.filter(c => c.id !== chatID); next.metadata.delete(chatID);
  return adopt(next);
}
function adopt(remote: Remote, revision?: number): Snapshot {
  const same = active?.snapshot.session === remote.bootstrap.session_id;
  const nextRevision = revision ?? (same ? active!.snapshot.revision + (fingerprint(active!) === fingerprint(remote) ? 0 : 1) : 0);
  const snapshot = { session: remote.bootstrap.session_id, revision: nextRevision, state: copy(remote.state) };
  active = { ...remote, snapshot };
  return copy(snapshot);
}
export function getAppBootstrap(): AppBootstrap | null { return active ? copy(active.bootstrap) : null; }
export function getAppAccount(): AppAccount | null {
  const b = getAppBootstrap();
  return b ? { user: b.user, wallet: b.wallet, api_allowance: b.api_allowance, agreement: b.agreement, capabilities: b.capabilities } : null;
}
export function getAppKeys(): AppKey[] { return active ? copy(active.keys) : []; }
export function getAppWorkspaceRole(workspaceID: string): AppWorkspaceRole | undefined { return active?.roles.get(workspaceID); }
export function getAppMessageMetadata(chatID: string): AppMessageMetadata[] { return copy(active?.metadata.get(chatID) ?? []); }

export function readApp(options: { signal?: AbortSignal } = {}): Promise<Snapshot | null> {
  const expectedEpoch = epoch;
  return serial(async () => {
    try { return adopt(await readRemote(expectedEpoch, undefined, options.signal)); }
    catch (error) {
      if (isUnauthorized(error)) { if (epoch === expectedEpoch) invalidate(); return null; }
      throw error;
    }
  });
}

// Only the initial, read-only snapshot has a total startup deadline. Never
// apply it to writes, which can have an uncertain committed outcome.
export async function readAppStartup(): Promise<Snapshot | null> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 20_000);
  try { return await readApp({ signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw new APIError(408, "Account loading timed out. Reload the page to try again.", "account_read_timeout");
    throw error;
  } finally { clearTimeout(deadline); }
}
function expectedSession(expected: AppIdentity): Active {
  if (!active || active.snapshot.session !== expected.session) throw new EndedSession("Account session changed");
  return active;
}
function expectedActive(expected: AppIdentity): Active {
  const before = expectedSession(expected);
  if (before.snapshot.revision !== expected.revision) throw new StaleState("Account data changed; reload before saving");
  return before;
}
function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(APP_CHANNEL); channel.postMessage({ source: APP_CHANGE_SOURCE }); } catch { /* Notifications are best effort. */ }
  finally { channel?.close(); }
}
// Only this module's already-adopted writes may skip this page's full reload.
// The notification still reaches other subscribers, including on this page.
export function isOwnAppChange(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).source === APP_CHANGE_SOURCE;
}
type Operation = { path: string; method: string; body?: unknown; expectedStatus?: number; validateResponse?: (value: unknown) => void };
function checkStateShape(state: PreviewState) {
  const allowed = new Set(Object.keys(freshState()));
  for (const key of Object.keys(object(state))) if (!allowed.has(key)) invalid(`Unsupported state field: ${key}`);
  const p = object(state.profile); text(p.name, 100); avatar(p.avatar); preferences(state);
  const workspaces = unique(array(state.workspaces, w => workspace({ ...object(w), role: "owner" }), 50));
  const chats = unique(array(state.chats, chat));
  for (const c of chats) if (!workspaces.some(w => w.id === c.ws)) invalid("Conversation has no workspace");
  if (state.current !== "example" && state.current !== "" && !workspaces.some(w => w.id === state.current)) invalid("Unknown current workspace");
}
function operations(before: Active, state: PreviewState): Operation[] {
  checkStateShape(state);
  const old = before.snapshot.state;
  for (const field of ["email", "joined", "keys", "credits", "budget", "defaultChannel"] as const) {
    if (!equal(state[field], old[field])) invalid(`${field} cannot be saved as application state; use an available server operation`);
  }
  const result: Operation[] = [];
  const profile: Record<string, unknown> = {};
  if (state.profile.name !== old.profile.name) profile.name = state.profile.name;
  if (state.profile.avatar !== old.profile.avatar) {
    if (typeof state.profile.avatar === "string") {
      if (!state.profile.avatar.startsWith("data:image/jpeg;base64,")) invalid("Remote avatar URLs cannot be uploaded");
      result.push({ path: "/api/app/avatar", method: "POST", body: { avatar: state.profile.avatar } });
    } else profile.avatar = state.profile.avatar; // The server removes an uploaded avatar when selecting a builtin.
  }
  if (Object.keys(profile).length) result.push({ path: "/api/app/profile", method: "POST", body: profile });
  const prefs: Record<string, unknown> = {};
  for (const field of ["theme", "prefs", "notifs", "onboarded", "answers", "promoClosed", "sbHidden"] as const) if (!equal(state[field], old[field])) prefs[field] = state[field];
  if (Object.keys(prefs).length) result.push({ path: "/api/app/preferences", method: "POST", body: prefs });
  const oldWs = new Map(old.workspaces.map(w => [w.id, w])), newWs = new Map(state.workspaces.map(w => [w.id, w]));
  const oldChats = new Map(old.chats.map(c => [c.id, c])), newChats = new Map(state.chats.map(c => [c.id, c]));
  for (const w of state.workspaces) {
    const previous = oldWs.get(w.id);
    if (!previous) result.push({ path: "/api/app/workspaces", method: "POST", body: w });
    else {
      if (previous.created !== w.created || previous.region !== w.region) invalid("Workspace creation time and region are immutable");
      if (!equal(previous, w)) {
        if (before.roles.get(w.id) !== "owner") invalid("Only the owner can update a workspace");
        const patch: Record<string, unknown> = {};
        if (previous.name !== w.name) patch.name = w.name;
        if (previous.tz !== w.tz) patch.tz = w.tz;
        result.push({ path: `/api/app/workspaces/${encodeURIComponent(w.id)}`, method: "PATCH", body: patch });
      }
    }
  }
  for (const c of state.chats) {
    const previous = oldChats.get(c.id);
    if (before.roles.get(c.ws) === "viewer") {
      if (!previous || !equal(c, previous)) invalid("This workspace is read only");
    }
    if (!previous) {
      if (c.messages.some(m => m[0] !== "you")) invalid("Only real user messages can be created; history needs explicit import");
      result.push({ path: "/api/app/chats", method: "POST", body: c });
    } else {
      if (c.ws !== previous.ws || c.created !== previous.created) invalid("Conversation workspace and creation time are immutable");
      const patch: Record<string, unknown> = {};
      for (const field of ["title", "agent", "model"] as const) if (c[field] !== previous[field]) patch[field] = c[field];
      if (Object.keys(patch).length) result.push({ path: `/api/app/chats/${encodeURIComponent(c.id)}`, method: "PATCH", body: patch });
      if (c.messages.length < previous.messages.length || !equal(c.messages.slice(0, previous.messages.length), previous.messages)) invalid("Use the message ID operation to edit or delete existing history");
      for (const m of c.messages.slice(previous.messages.length)) {
        if (m[0] !== "you") invalid("Agent execution is unavailable; fabricated replies cannot be saved");
        result.push({ path: `/api/app/chats/${encodeURIComponent(c.id)}/messages`, method: "POST", body: { speaker: "you", body: m[1] } });
      }
    }
  }
  for (const c of old.chats) if (!newChats.has(c.id) && newWs.has(c.ws)) {
    if (before.roles.get(c.ws) === "viewer") invalid("This workspace is read only");
    result.push({ path: `/api/app/chats/${encodeURIComponent(c.id)}`, method: "DELETE" });
  }
  for (const w of old.workspaces) if (!newWs.has(w.id)) {
    if (before.roles.get(w.id) !== "owner") invalid("Only the owner can delete a workspace");
    result.push({ path: `/api/app/workspaces/${encodeURIComponent(w.id)}`, method: "DELETE" });
  }
  return result;
}
async function mutation(expected: AppIdentity, build: (before: Active) => Operation[], selected?: string): Promise<Snapshot> {
  const expectedEpoch = epoch;
  const previous = expectedActive(expected);
  // Validate before any network write. In particular a profile change combined
  // with a fabricated agent reply must not partially save the profile first.
  const ops = build(previous);
  const latest = await readRemote(expectedEpoch, previous.bootstrap);
  if (fingerprint(latest) !== fingerprint(previous)) { adopt(latest); throw new StaleState("Server data changed; reload before saving"); }
  try {
    for (const op of ops) {
      const value = await guarded(previous.bootstrap, expectedEpoch, op.path, { method: op.method, expectedStatus: op.expectedStatus, ...(op.body === undefined ? {} : { body: op.body }) });
      op.validateResponse?.(value);
    }
    const next = await readRemote(expectedEpoch, previous.bootstrap);
    if (selected !== undefined) {
      const current = selected === "example" || next.state.workspaces.some(w => w.id === selected) ? selected : next.state.workspaces[0]?.id ?? "";
      next.state.current = current; storeCurrent(next.bootstrap, current);
    }
    const snapshot = adopt(next, expected.revision + 1);
    announce(); return snapshot;
  } catch (error) {
    // Multiple entity updates are separate server transactions. Never pretend a
    // failed batch rolled back or allow an old snapshot to replay an uncertain POST.
    if (active?.snapshot.session === expected.session) active.snapshot.revision++;
    throw error;
  }
}
export function commitApp(expected: Snapshot, state: PreviewState): Promise<Snapshot> {
  const draft = copy(state);
  return serial(() => mutation(expected, before => operations(before, draft), draft.current));
}
// An ordinary save may wait for this page's confirmed deletes. No other
// revision or field change is eligible for rebasing, including metadata-only
// revisions and edits to a conversation that has just been deleted.
export function rebaseAfterAppChatDeletes(expected: Snapshot, latest: Snapshot, draft: PreviewState, confirmed: ReadonlyMap<number, string>): PreviewState {
  if (expected.session !== latest.session) throw new EndedSession("Account session changed");
  const count = latest.revision - expected.revision, removed = new Set<string>();
  function stale(): never { throw new StaleState("Account data changed; reload before saving"); }
  if (count < 0 || count > confirmed.size) stale();
  for (let revision = expected.revision + 1; revision <= latest.revision; revision++) {
    const chatID = confirmed.get(revision);
    if (!chatID || removed.has(chatID) || !expected.state.chats.some(c => c.id === chatID)) stale();
    removed.add(chatID);
  }
  if (!equal({ ...expected.state, chats: expected.state.chats.filter(c => !removed.has(c.id)) }, latest.state)) stale();
  for (const c of draft.chats) if (removed.has(c.id) && !equal(c, expected.state.chats.find(old => old.id === c.id))) stale();
  return { ...copy(draft), chats: copy(draft.chats.filter(c => !removed.has(c.id))) };
}
export function deleteAppChat(expected: AppIdentity, chatID: string): Promise<Snapshot> {
  const targetID = id(chatID);
  return serial(async () => {
    const previous = expectedActive(expected), expectedEpoch = epoch;
    const target = previous.state.chats.find(c => c.id === targetID);
    if (!target || !["owner", "editor"].includes(previous.roles.get(target.ws) ?? "")) invalid("This conversation is not writable");
    const b = await identity(expectedEpoch, previous.bootstrap);
    const raw = object((await guarded<{ chat: unknown }>(b, expectedEpoch, `/api/app/chats/${encodeURIComponent(targetID)}`)).chat);
    const latest = chat(raw), metadata = array(raw.message_metadata ?? [], messageMetadata, 500);
    if (latest.id !== targetID || latest.ws !== target.ws || metadata.length !== latest.messages.length || new Set(metadata.map(m => m.id)).size !== metadata.length) invalid("Invalid message ownership metadata");
    if (!equal(latest, target) || !equal(metadata, previous.metadata.get(targetID) ?? [])) throw new StaleState("Conversation changed; reload before deleting");
    // Server ACL and in-flight-run checks remain authoritative. A response other
    // than the endpoint's 204, or a failed final identity read, is unconfirmed.
    // Never retry the DELETE or wait on unrelated histories/Keys after its ACK.
    let final: AppBootstrap;
    try {
      await guarded(b, expectedEpoch, `/api/app/chats/${encodeURIComponent(targetID)}`, { method: "DELETE", expectedStatus: 204 });
    } catch (error) {
      if (error instanceof EndedSession || error instanceof APIError && error.status >= 400 && error.status < 500 && error.status !== 408) throw error;
      throw new UnconfirmedChatDeletion(error);
    }
    try { final = await identity(expectedEpoch, b); }
    catch (error) { if (error instanceof EndedSession) throw error; throw new UnconfirmedChatDeletion(error); }
    const next: Remote = { ...previous, bootstrap: final, state: copy(previous.state), metadata: new Map(previous.metadata) };
    next.state.chats = next.state.chats.filter(c => c.id !== targetID);
    next.metadata.delete(targetID);
    const snapshot = adopt(next, expected.revision + 1);
    announce();
    return snapshot;
  });
}
export function endApp(session: string): Promise<void> {
  return serial(async () => {
    if (!active || active.snapshot.session !== session) throw new EndedSession("Account session changed");
    const expectedEpoch = epoch, b = await identity(expectedEpoch, active.bootstrap);
    await guarded(b, expectedEpoch, "/api/app/session", { method: "DELETE" });
    invalidate(); announce();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("fells.session.changed", { detail: { audience: "customer" } }));
    if (typeof BroadcastChannel !== "undefined") {
      let channel: BroadcastChannel | undefined;
      try { channel = new BroadcastChannel("fells.session.changed"); channel.postMessage({ audience: "customer" }); } catch { /* Best effort. */ }
      finally { channel?.close(); }
    }
  });
}

function explicit(expected: AppIdentity, operation: Operation, validate?: (before: Active) => void): Promise<Snapshot> {
  return serial(() => mutation(expected, before => { validate?.(before); return [operation]; }));
}
export function createAppChat(expected: AppIdentity, value: Chat): Promise<Snapshot> {
  const c = chat(value);
  if (c.messages.some(m => m[0] !== "you")) return Promise.reject(new InvalidState("Only user messages can be submitted"));
  return explicit(expected, { path: "/api/app/chats", method: "POST", body: c });
}
export function importAppChat(expected: AppIdentity, value: Chat): Promise<Snapshot> {
  const c = chat(value);
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(c.ws)}/chats/import`, method: "POST", body: c });
}
function chatRequestID(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid("Invalid conversation request ID");
  return value;
}
function chatRun(value: unknown, chatID: string, requestID: string): AppChatRun {
  const v = object(object(value).run);
  if (v.request_id !== requestID || v.chat_id !== undefined && v.chat_id !== chatID || !["pending", "running", "completed", "failed", "unknown"].includes(String(v.status))) invalid("Invalid conversation run receipt");
  const refusal = v.status === "failed" && v.error_code === "model_refused" ? parseChatRefusal(v.stop_details) : undefined;
  return { request_id: requestID, status: v.status as AppChatRunStatus,
    ...(v.id === undefined ? {} : { id: id(v.id) }),
    ...(v.chat_id === undefined ? {} : { chat_id: id(v.chat_id) }),
    ...(v.error_code === undefined ? {} : { error_code: text(v.error_code, 200) }),
    ...(v.created === undefined ? {} : { created: number(v.created, 8.64e15) }),
    ...(v.updated === undefined ? {} : { updated: number(v.updated, 8.64e15) }),
    ...(v.message_id === undefined ? {} : { message_id: id(v.message_id) }),
    ...(v.assistant_message_id === undefined ? {} : { assistant_message_id: id(v.assistant_message_id) }), ...(refusal ? { refusal } : {}) };
}
const pendingChatGenerations = new Map<string, string>();
const observedChatRuns = new Map<string, string>();
async function conversationOperation(expected: AppIdentity, chatID: string, requestID: string, input?: AppChatInput, targetOnly = false): Promise<AppChatResult> {
  id(chatID); chatRequestID(requestID);
  const pendingKey = `${expected.session}:${chatID}`;
  const { before, expectedEpoch } = await serial(async () => {
    // A status GET may follow a background history refresh. Rebase that read
    // within the same session; a paid generation still requires its exact snapshot.
    const before = input ? expectedActive(expected) : expectedSession(expected), expectedEpoch = epoch;
    const conversation = before.state.chats.find(c => c.id === chatID);
    if (!conversation) invalid("Unknown conversation");
    if (input && pendingChatGenerations.has(pendingKey)) invalid("A model response is already pending in this conversation");
    if (input && (before.bootstrap.capabilities.model_chat !== true || before.roles.get(conversation.ws) === "viewer")) invalid("Model conversation is not available in this workspace");
    // Re-read authorization and history before spending. This catches a changed
    // account or shared history without sending a stale paid instruction.
    const latest = input ? await readRemote(expectedEpoch, before.bootstrap) : before;
    if (!input) await identity(expectedEpoch, before.bootstrap);
    if (input && fingerprint(latest) !== fingerprint(before)) { adopt(latest); throw new StaleState("Conversation changed; review the current history before sending"); }
    if (input && (latest.bootstrap.capabilities.model_chat !== true || latest.roles.get(conversation.ws) === "viewer")) invalid("A current account and writable workspace are required");
    if (input && input.billing_mode !== "account_allowance" && !latest.keys.some(key => key.id === input.key_id && conversationKey(key))) invalid("A current personal API key is required for legacy key billing");
    if (input) pendingChatGenerations.set(pendingKey, requestID);
    return { before, expectedEpoch };
  });
  // Model latency must not hold the account's edit/read queue. Only preparation
  // and adoption are serialized; identity-bound inference can run independently.
  try {
    let run: AppChatRun | null = null, error: unknown, refusal: ChatRefusalDetails | undefined;
    try {
      const value = await guarded<unknown>(before.bootstrap, expectedEpoch,
        input ? `/api/app/chats/${encodeURIComponent(chatID)}/generate` : `/api/app/chats/${encodeURIComponent(chatID)}/runs/${encodeURIComponent(requestID)}`,
        input ? { body: input, headers: { Prefer: "respond-async" } } : {}, !!input);
      run = chatRun(value, chatID, requestID);
      refusal = run.refusal;
      if (!refusal && input && run.status === "failed" && run.error_code === "model_refused") refusal = parseChatRefusal((value as Record<string, unknown>).stop_details);
    } catch (caught) {
      if (caught instanceof EndedSession) throw caught;
      error = caught;
      if (caught instanceof APIError && caught.details.run) {
        try {
          run = chatRun(caught.details, chatID, requestID);
          refusal = run.refusal;
          if (!refusal && input && run.status === "failed" && run.error_code === "model_refused") refusal = parseChatRefusal(caught.details.stop_details);
        } catch { /* An invalid run cannot become a completion receipt. */ }
      }
    }
    // An accepted streaming run must reach its authenticated observer before
    // unrelated account reads. The ACK is not a saved assistant-message proof.
    if (input?.stream_updates === true && run) {
      checkEpoch(expectedEpoch); expectedSession(expected);
      return { snapshot: null, run, ...(error === undefined ? {} : { error }), ...(refusal ? { refusal } : {}) };
    }
    return await serial(async () => {
      checkEpoch(expectedEpoch);
      expectedSession(expected);
      try {
        const runKey = `${pendingKey}:${requestID}`, signature = run ? JSON.stringify(run) : "";
        const refreshHistory = !!input || !!run && (run.status === "completed" || run.status === "failed" || observedChatRuns.get(runKey) !== signature);
        if (!refreshHistory) {
          // An unchanged pending run is not a change to the whole account.
          // Recheck the cookie without fetching every workspace and history.
          await identity(expectedEpoch, before.bootstrap);
          expectedSession(expected);
          return { snapshot: null, run, ...(error === undefined ? {} : { error }), ...(refusal ? { refusal } : {}) };
        }
        const current = expectedSession(expected);
        const next = targetOnly ? await readTargetRemote(expectedEpoch, current, chatID) : await readRemote(expectedEpoch, before.bootstrap);
        if (targetOnly && expectedSession(expected).snapshot.revision !== current.snapshot.revision) throw new StaleState("Account data changed while loading this conversation");
        const revision = Math.max(expectedSession(expected).snapshot.revision, before.snapshot.revision) + 1;
        const snapshot = adopt(next, revision);
        if (run) {
          observedChatRuns.set(runKey, signature);
          if (observedChatRuns.size > 100) observedChatRuns.delete(observedChatRuns.keys().next().value!);
        }
        announce(); return { snapshot, run, ...(error === undefined ? {} : { error }), ...(refusal ? { refusal } : {}) };
      } catch (caught) {
        if (caught instanceof EndedSession) throw caught;
        // Do not allow an old snapshot to replay an uncertain paid request.
        if (input && active?.snapshot.session === expected.session) active.snapshot.revision++;
        return { snapshot: null, run, error: error ?? caught, ...(refusal ? { refusal } : {}) };
      }
    });
  } finally {
    if (input && pendingChatGenerations.get(pendingKey) === requestID) pendingChatGenerations.delete(pendingKey);
  }
}
export function generateAppChat(expected: AppIdentity, chatID: string, input: AppChatInput): Promise<AppChatResult> {
  if (input.billing_mode === "account_allowance" && input.key_id !== undefined) invalid("Account conversations cannot select an API key");
  if (input.web_search !== undefined && typeof input.web_search !== "boolean") invalid("Web search must be explicitly enabled or disabled");
  if (input.stream_updates !== undefined && typeof input.stream_updates !== "boolean") invalid("Stream observation must be explicitly enabled or disabled");
  const attachmentIDs = input.attachment_ids === undefined ? undefined : array(input.attachment_ids, value => id(value), 4);
  if (attachmentIDs && new Set(attachmentIDs).size !== attachmentIDs.length) invalid("Duplicate attachment IDs");
  const body: AppChatInput = { request_id: chatRequestID(input.request_id), body: text(input.body, MAX_MESSAGE), model: text(input.model), ...(input.billing_mode === "account_allowance" ? { billing_mode: "account_allowance" as const } : { key_id: positive(input.key_id) }), ...(input.web_search === undefined ? {} : { web_search: input.web_search }), ...(attachmentIDs === undefined ? {} : { attachment_ids: attachmentIDs }), ...(input.stream_updates === undefined ? {} : { stream_updates: input.stream_updates }) };
  if ((!body.body.trim() && !attachmentIDs?.length) || !body.model.trim()) invalid("A message and canonical model are required");
  return conversationOperation(expected, chatID, body.request_id, body);
}
export function readAppChatRun(expected: AppIdentity, chatID: string, requestID: string, options: { targetOnly?: boolean } = {}): Promise<AppChatResult> {
  return conversationOperation(expected, chatID, requestID, undefined, options.targetOnly);
}
export async function observeAppChatRun(expected: AppIdentity, chatID: string, requestID: string, receive: (event: AppChatStreamEvent) => void, options: { signal: AbortSignal; after?: number; runID?: string }): Promise<void> {
  id(chatID); chatRequestID(requestID);
  const before = expectedSession(expected), expectedEpoch = epoch, after = options.after ?? 0;
  if (!before.state.chats.some(c => c.id === chatID) || !Number.isSafeInteger(after) || after < 0 || after > MAX_CHAT_STREAM_SEQ) invalid("Invalid conversation stream cursor");
  if (isBusinessBlocked()) throw new APIError(503, "Service temporarily unavailable", "service_maintenance");
  const controller = new AbortController(), abort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true }); if (options.signal.aborted) abort();
  let timedOut = false, runID = options.runID, idle: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, API_READ_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/app/chats/${encodeURIComponent(chatID)}/runs/${encodeURIComponent(requestID)}/events?after=${after}`, {
      method: "GET", headers: { ...guardHeaders(before.bootstrap), Accept: "text/event-stream" }, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
    });
    clearTimeout(deadline); checkEpoch(expectedEpoch); expectedSession(expected); controller.signal.throwIfAborted();
    if (response.status === 401) { if (epoch === expectedEpoch) invalidate(); throw new EndedSession("Account session ended or changed"); }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw new APIError(response.status, "Conversation stream is unavailable", "stream_unavailable"); }
    const activity = () => { clearTimeout(idle); idle = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000); };
    activity();
    await readChatStream(response, event => {
      checkEpoch(expectedEpoch); expectedSession(expected); controller.signal.throwIfAborted();
      if (event.type === "snapshot" || event.type === "terminal") {
        if (object(event.run).chat_id !== chatID) invalid("Invalid conversation stream binding");
        const run = chatRun({ run: event.run }, chatID, requestID);
        if (!run.id || runID && run.id !== runID || event.type === "terminal" && !["completed", "failed", "unknown"].includes(run.status)) invalid("Invalid conversation stream binding");
        runID = run.id; receive({ ...event, run });
      } else receive(event);
    }, controller.signal, activity);
  } catch (error) {
    if (timedOut) throw new APIError(408, "Conversation stream connection timed out", "stream_unavailable");
    throw error;
  } finally { clearTimeout(deadline); clearTimeout(idle); options.signal.removeEventListener("abort", abort); controller.abort(); }
}
function ownedMessage(before: Active, chatID: string, messageID: string, deleting: boolean) {
  const c = before.snapshot.state.chats.find(c => c.id === chatID), meta = before.metadata.get(chatID)?.find(m => m.id === messageID);
  if (!c || !meta) invalid("Unknown message ID");
  const role = before.roles.get(c.ws);
  if (role === "viewer" || ((!deleting || role !== "owner") && (meta.imported || meta.author_user_id !== before.bootstrap.user.id))) invalid("This message is not editable by the current user");
}
export function updateAppMessage(expected: AppIdentity, chatID: string, messageID: string, body: string): Promise<Snapshot> {
  text(body, MAX_MESSAGE);
  return explicit(expected, { path: `/api/app/chats/${encodeURIComponent(id(chatID))}/messages/${encodeURIComponent(id(messageID))}`, method: "PATCH", body: { body } }, before => ownedMessage(before, chatID, messageID, false));
}
export function deleteAppMessage(expected: AppIdentity, chatID: string, messageID: string): Promise<Snapshot> {
  return explicit(expected, { path: `/api/app/chats/${encodeURIComponent(id(chatID))}/messages/${encodeURIComponent(id(messageID))}`, method: "DELETE" }, before => ownedMessage(before, chatID, messageID, true));
}
function getAppWorkspaceMembers(expected: AppIdentity, workspaceID: string): Promise<AppMember[]> {
  return serial(async () => {
    // This is a read, not an edit to the captured state. A queued account
    // refresh may advance its revision before it runs; the current cookie and
    // server workspace authorization still decide whether members are visible.
    const before = expectedSession(expected), expectedEpoch = epoch;
    const b = await identity(expectedEpoch, before.bootstrap);
    const result = await guarded<{ members: unknown[] | null }>(b, expectedEpoch, `/api/app/workspaces/${encodeURIComponent(id(workspaceID))}/members`);
    await identity(expectedEpoch, b);
    return array(result.members ?? [], raw => {
      const m = object(raw);
      if (!["owner", "editor", "viewer"].includes(String(m.role))) invalid("Invalid member role");
      return { user_id: positive(m.user_id), name: text(m.name, 1000), role: m.role as AppWorkspaceRole };
    }, 32);
  });
}
function removeAppWorkspaceMember(expected: AppIdentity, workspaceID: string, userID: number): Promise<Snapshot> {
  positive(userID);
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(id(workspaceID))}/members/${userID}`, method: "DELETE" });
}

function currentIdentity(): AppIdentity {
  if (!active) throw new EndedSession("Sign in before accessing the workspace");
  return { session: active.snapshot.session, revision: active.snapshot.revision };
}
export function listAppMembers(workspaceID: string): Promise<AppMember[]> {
  return getAppWorkspaceMembers(currentIdentity(), workspaceID);
}
function invitationList<T>(path: string, parse: (value: unknown) => T, max: number): Promise<T[]> {
  const expected = currentIdentity();
  return serial(async () => {
    const before = expectedSession(expected), expectedEpoch = epoch;
    const b = await identity(expectedEpoch, before.bootstrap);
    const result = await guarded<unknown>(b, expectedEpoch, path);
    await identity(expectedEpoch, b);
    return array(object(result).invitations ?? [], parse, max);
  });
}
export function listAppPendingInvitations(workspaceID: string): Promise<AppPendingInvitation[]> {
  const workspace = id(workspaceID);
  if (active?.roles.get(workspace) !== "owner") return Promise.reject(new InvalidState("Only the owner can view pending invitations"));
  return invitationList(`/api/app/workspaces/${encodeURIComponent(workspace)}/invitations`, pendingInvitation, 20);
}
export function listAppReceivedInvitations(): Promise<AppReceivedInvitation[]> {
  return invitationList("/api/app/invitations", receivedInvitation, 50);
}
export function setAppMember(workspaceID: string, member: { user_id?: number; username?: string; role: "editor" | "viewer" }): Promise<Snapshot> {
  const expected = currentIdentity();
  if ((member.user_id === undefined) === (member.username === undefined) || !["editor", "viewer"].includes(member.role)) return Promise.reject(new InvalidState("Choose one member account and role"));
  const body: Record<string, unknown> = { role: member.role };
  if (member.user_id !== undefined) body.user_id = positive(member.user_id);
  else {
    const username = text(member.username, 1000).trim();
    if (!username) return Promise.reject(new InvalidState("Enter an account identifier"));
    body.username = username;
  }
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(id(workspaceID))}/members`, method: "POST", body,
    expectedStatus: 202, validateResponse: value => {
      const response = object(object(value).invitation);
      if (response.status !== "pending" || response.role !== member.role) invalid("Invalid invitation response");
    } }, before => {
    if (before.roles.get(workspaceID) !== "owner") invalid("Only the owner can send an invitation");
  });
}
export function revokeAppInvitation(workspaceID: string, invitationID: string): Promise<Snapshot> {
  const expected = currentIdentity(), workspace = id(workspaceID);
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(workspace)}/invitations/${encodeURIComponent(id(invitationID))}`, method: "DELETE" }, before => {
    if (before.roles.get(workspace) !== "owner") invalid("Only the owner can revoke invitations");
  });
}
export function acceptAppInvitation(invitationID: string): Promise<Snapshot> {
  return explicit(currentIdentity(), { path: `/api/app/invitations/${encodeURIComponent(id(invitationID))}/accept`, method: "POST" });
}
export function declineAppInvitation(invitationID: string): Promise<Snapshot> {
  return explicit(currentIdentity(), { path: `/api/app/invitations/${encodeURIComponent(id(invitationID))}/decline`, method: "POST" });
}
export function leaveAppWorkspace(workspaceID: string): Promise<Snapshot> {
  const expected = currentIdentity(), workspace = id(workspaceID);
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(workspace)}/leave`, method: "POST" }, before => {
    if (!before.roles.has(workspace) || before.roles.get(workspace) === "owner") invalid("The owner cannot leave this workspace");
  });
}
export function updateAppMemberRole(workspaceID: string, memberID: number, role: "editor" | "viewer"): Promise<Snapshot> {
  const expected = currentIdentity();
  positive(memberID);
  if (role !== "editor" && role !== "viewer") return Promise.reject(new InvalidState("Invalid member role"));
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(id(workspaceID))}/members/${memberID}`, method: "PATCH", body: { role } }, before => {
    if (before.roles.get(workspaceID) !== "owner") invalid("Only the owner can change member roles");
  });
}
export function removeAppMember(workspaceID: string, memberID: number): Promise<Snapshot> {
  return removeAppWorkspaceMember(currentIdentity(), workspaceID, memberID);
}

// Session broadcasts only invalidate caches; server cookie validation and the
// two expected-identity headers are the authorization boundary.
if (typeof window !== "undefined") {
  window.addEventListener("fells.session.changed", event => {
    if ((event as CustomEvent).detail?.audience === "customer") invalidate();
  });
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel("fells.session.changed");
      channel.addEventListener("message", event => { if (event.data?.audience === "customer") invalidate(); });
    } catch { /* Private mode may disable notifications. */ }
  }
}
