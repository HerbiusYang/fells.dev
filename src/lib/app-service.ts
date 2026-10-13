// Real /app persistence. Preview storage remains available only to the explicit
// preview; financial balances and execution results never enter its state blob.
import { api, APIError, type APIOptions } from "./app-http.ts";
import { freshState, MAX_MESSAGE, InvalidState, type PreviewState, type Ws, type Chat } from "./preview-state.ts";
import { StaleState, EndedSession, type Snapshot } from "./preview-store.ts";
export { StaleState, EndedSession } from "./preview-store.ts";
export type { Snapshot } from "./preview-store.ts";

const APP_CHANNEL = "fells.app.changed.v1";
export type AppIdentity = Pick<Snapshot, "session" | "revision">;
export type AppWorkspaceRole = "owner" | "editor" | "viewer";
type AppWorkspace = Ws & { role: AppWorkspaceRole };
export type AppMessageMetadata = { id: string; created: number; imported: boolean; author_user_id?: number; author_name?: string };
export type AppMember = { user_id: number; name: string; role: AppWorkspaceRole };
export type AppKey = { id: number; name: string; prefix: string; created_at: number; revoked: boolean; monthly_allow_limit_micro: number; [key: string]: unknown };
export type AppBootstrap = {
  schema_version: number; session_id: string;
  user: { id: number; username: string; email: string; name: string; joined_at: number; self_keys: boolean };
  wallet: { currency: "CNY"; cash_micro: number; grant_micro: number; grant_expires_at: number };
  api_allowance: { currency: "USD"; balance: { micro: number; expires_at: number; [key: string]: unknown }; term_months: number; price_cny: number };
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
  if (w.currency !== "CNY" || a.currency !== "USD" || !/^[a-f0-9]{64}$/.test(String(v.session_id))) invalid("Invalid account currency or session");
  for (const enabled of Object.values(caps)) boolean(enabled);
  return { schema_version: number(v.schema_version), session_id: String(v.session_id),
    user: { id: positive(u.id), username: text(u.username, 1000), email: text(u.email, 10000), name: text(u.name, 100), joined_at: number(u.joined_at), self_keys: boolean(u.self_keys) },
    wallet: { currency: "CNY", cash_micro: number(w.cash_micro), grant_micro: number(w.grant_micro), grant_expires_at: number(w.grant_expires_at) },
    api_allowance: { currency: "USD", balance: { ...balance, micro: number(balance.micro), expires_at: number(balance.expires_at) }, term_months: number(a.term_months), price_cny: typeof a.price_cny === "number" && Number.isFinite(a.price_cny) && a.price_cny >= 0 ? a.price_cny : invalid("Invalid allowance price") },
    agreement: object(v.agreement), capabilities: caps as Record<string, boolean> };
}
function guardHeaders(b: AppBootstrap): Record<string, string> {
  return { "X-Fells-Expected-User": String(b.user.id), "X-Fells-Expected-Session": b.session_id };
}
function checkEpoch(expectedEpoch: number) { if (epoch !== expectedEpoch) throw new EndedSession("Account session changed"); }
function invalidate() { epoch++; active = null; }
function isUnauthorized(error: unknown) { return error instanceof APIError && error.status === 401; }
async function guarded<T>(b: AppBootstrap, expectedEpoch: number, path: string, options: APIOptions = {}): Promise<T> {
  checkEpoch(expectedEpoch);
  try {
    const result = await api<T>(path, { ...options, headers: { ...options.headers, ...guardHeaders(b) } });
    checkEpoch(expectedEpoch);
    return result;
  } catch (error) {
    if (isUnauthorized(error)) {
      if (epoch === expectedEpoch) invalidate();
      throw new EndedSession("Account session ended or changed");
    }
    checkEpoch(expectedEpoch);
    throw error;
  }
}
async function identity(expectedEpoch: number, expected?: AppBootstrap): Promise<AppBootstrap> {
  checkEpoch(expectedEpoch);
  let value: unknown;
  try { value = await api("/api/app/bootstrap"); }
  catch (error) {
    checkEpoch(expectedEpoch);
    if (expected && isUnauthorized(error)) {
      invalidate(); throw new EndedSession("Account session ended or changed");
    }
    throw error;
  }
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
async function readRemote(expectedEpoch: number, expected?: AppBootstrap): Promise<Remote> {
  const b = await identity(expectedEpoch, expected);
  const [profileValue, prefValue, wsValue, keysValue] = await Promise.all([
    guarded<unknown>(b, expectedEpoch, "/api/app/profile"), guarded<unknown>(b, expectedEpoch, "/api/app/preferences"),
    guarded<unknown>(b, expectedEpoch, "/api/app/workspaces"), guarded<unknown>(b, expectedEpoch, "/api/app/keys"),
  ]);
  const profile = object(profileValue), p = object(profile.profile);
  const workspaces = unique(array(object(wsValue).workspaces ?? [], workspace, 50));
  const roles = new Map(workspaces.map(w => [w.id, w.role] as const));
  const allChats: Chat[] = [], metadata = new Map<string, AppMessageMetadata[]>();
  // Bound concurrent workspace reads without applying the preview's global
  // 500-chat / 1 MiB cap to the server's per-workspace storage.
  for (let start = 0; start < workspaces.length; start += 4) {
    const pages = await Promise.all(workspaces.slice(start, start + 4).map(async w => {
      const response = await guarded<{ chats: unknown[] | null }>(b, expectedEpoch, `/api/app/workspaces/${encodeURIComponent(w.id)}/chats`);
      return { workspace: w.id, chats: response.chats ?? [] };
    }));
    for (const page of pages) for (const raw of page.chats) {
      const c = chat(raw), md = array(object(raw).message_metadata ?? [], messageMetadata, 500);
      if (c.ws !== page.workspace || md.length !== c.messages.length || new Set(md.map(m => m.id)).size !== md.length) invalid("Invalid message ownership metadata");
      allChats.push(c); metadata.set(c.id, md);
    }
  }
  unique(allChats);
  const keys = array(object(keysValue).keys ?? [], raw => {
    const k = object(raw);
    return { ...k, id: positive(k.id), name: text(k.name, 1000), prefix: text(k.prefix, 200), created_at: number(k.created_at),
      revoked: boolean(k.revoked), monthly_allow_limit_micro: number(k.monthly_allow_limit_micro ?? 0) } as AppKey;
  });
  if (new Set(keys.map(k => k.id)).size !== keys.length) invalid("Duplicate Key ID");
  const state: PreviewState = { ...freshState(), ...preferences(prefValue), profile: { name: text(p.name, 100), avatar: avatar(p.avatar) },
    email: text(profile.email, 10000), joined: b.user.joined_at * 1000,
    workspaces: workspaces.map(({ role: _role, ...w }) => w), current: localCurrent(b, workspaces), chats: allChats,
    keys: keys.filter(k => !k.revoked).map(k => ({ id: String(k.id), name: k.name, prefix: k.prefix, limit: k.monthly_allow_limit_micro / 1e6, created: k.created_at * 1000, last4: "" })),
    // These old display fields have no matching backend product. Never map CNY
    // cash, grants, or USD allowance into the three fictional USD credit buckets.
    credits: { bonus: 0, never: 0, period: 0 } };
  const final = await identity(expectedEpoch, b);
  return { state, bootstrap: final, roles, metadata, keys };
}
function fingerprint(remote: Remote) {
  // Request counters / last-used timestamps may change continuously while a
  // model client is active. They do not make an unrelated profile save stale.
  return JSON.stringify([remote.state, [...remote.roles], [...remote.metadata]]);
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

export function readApp(): Promise<Snapshot | null> {
  const expectedEpoch = epoch;
  return serial(async () => {
    try { return adopt(await readRemote(expectedEpoch)); }
    catch (error) {
      if (isUnauthorized(error)) { if (epoch === expectedEpoch) invalidate(); return null; }
      throw error;
    }
  });
}
function expectedActive(expected: AppIdentity): Active {
  if (!active || active.snapshot.session !== expected.session) throw new EndedSession("Account session changed");
  if (active.snapshot.revision !== expected.revision) throw new StaleState("Account data changed; reload before saving");
  return active;
}
function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(APP_CHANNEL); channel.postMessage("changed"); } catch { /* Notifications are best effort. */ }
  finally { channel?.close(); }
}
type Operation = { path: string; method: string; body?: unknown };
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
    for (const op of ops) await guarded(previous.bootstrap, expectedEpoch, op.path, { method: op.method, ...(op.body === undefined ? {} : { body: op.body }) });
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
    const before = expectedActive(expected), expectedEpoch = epoch;
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
export function setAppMember(workspaceID: string, member: { user_id?: number; username?: string; role: "editor" | "viewer" }): Promise<Snapshot> {
  const expected = currentIdentity();
  if ((member.user_id === undefined) === (member.username === undefined) || !["editor", "viewer"].includes(member.role)) return Promise.reject(new InvalidState("Choose one member account and role"));
  const body: Record<string, unknown> = { role: member.role };
  if (member.user_id !== undefined) body.user_id = positive(member.user_id);
  else {
    const username = text(member.username, 1000).trim();
    if (!username) return Promise.reject(new InvalidState("Enter an existing member account"));
    body.username = username;
  }
  return explicit(expected, { path: `/api/app/workspaces/${encodeURIComponent(id(workspaceID))}/members`, method: "POST", body }, before => {
    if (before.roles.get(workspaceID) !== "owner") invalid("Only the owner can add a member");
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
