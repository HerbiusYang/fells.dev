import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readApp, commitApp, endApp, getAppAccount, getAppKeys, getAppBootstrap, getAppMessageMetadata, getAppWorkspaceRole,
  createAppChat, deleteAppChat, rebaseAfterAppChatDeletes, UnconfirmedChatDeletion, isOwnAppChange, importAppChat, updateAppMessage, deleteAppMessage, listAppMembers, setAppMember,
  listAppPendingInvitations, listAppReceivedInvitations, revokeAppInvitation, acceptAppInvitation, declineAppInvitation, leaveAppWorkspace,
  generateAppChat, readAppChatRun,
  StaleState, EndedSession } from "../src/lib/app-service.ts";
import { APIError } from "../src/lib/app-http.ts";
import { InvalidState } from "../src/lib/preview-state.ts";
import { readAppStartup } from "../src/lib/app-service.ts";

const originalFetch = globalThis.fetch;
const clone = value => structuredClone(value);
let server, calls, currentUser, session, hook, failedPath;
const now = 1791520000123;
const hash = char => char.repeat(64);
const prefs = () => ({ theme: "system", prefs: { agent: "", send: 0 }, notifs: [true, true, true, false], onboarded: false, answers: [[], [], [], []], promoClosed: false, sbHidden: false });
function makeServer() {
  return { users: new Map([
    [1, { name: "Alice", email: "alice@example.invalid", avatar: "/api/app/avatar?v=1", prefs: prefs() }],
    [2, { name: "Bob", email: "bob@example.invalid", avatar: 0, prefs: prefs() }],
  ]), workspaces: [{ id: "w1", name: "Shared", region: "us-west", tz: "UTC", created: now, role: "owner" }],
  chats: [{ id: "c1", ws: "w1", title: "History", agent: "codex", model: "GPT", created: now, messages: [["you", "Own"], ["user: Bob", "Other"], ["agent", "Imported"]],
    message_metadata: [{ id: "m1", created: now, imported: false, author_user_id: 1, author_name: "Alice" }, { id: "m2", created: now, imported: false, author_user_id: 2, author_name: "Bob" }, { id: "m3", created: now, imported: true }] }],
  keys: [{ id: 12, name: "Existing Key", prefix: "sk-ap-abc…", created_at: Math.floor(now / 1000), revoked: false, monthly_allow_limit_micro: 5000000 }],
  members: [{ user_id: 1, name: "Alice", role: "owner" }, { user_id: 2, name: "Bob", role: "editor" }],
  pendingInvitations: [], receivedInvitations: [], nextInvitationID: 1 };
}
function response(value, status = 200) { return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function bootstrap() {
  const u = server.users.get(currentUser);
  return { schema_version: 1, session_id: session, user: { id: currentUser, username: u.name.toLowerCase(), name: u.name, email: u.email, joined_at: Math.floor(now / 1000), self_keys: true },
    wallet: { currency: "CNY", cash_micro: 12000000, grant_micro: 2000000, grant_expires_at: 0 },
    api_allowance: { currency: "USD", balance: { ...server.fundingBalanceFields, micro: server.allowanceMicro ?? 34000000, expires_at: 1820000000, ...(server.compensationMicro === undefined ? {} : { comp_micro: server.compensationMicro }) }, term_months: 12, exchange_policy: { source: "ECB", fee_bp: 10, customer_only: true, fee_included: true }, ...(server.legacyPrice === undefined ? {} : { price_cny: server.legacyPrice }) }, agreement: { accepted: true },
    capabilities: { workspace_storage: true, chat_history: true, agent_execution: false, cloud_computer: false, model_chat: server.modelChat === true } };
}
async function mockFetch(path, options) {
  const method = options.method ?? "GET", body = options.body ? JSON.parse(options.body) : undefined;
  const call = { path, method, body, headers: new Headers(options.headers), user: currentUser };
  calls.push(call);
  await hook?.(call);
  if (!currentUser) return response({ error: "signed out" }, 401);
  if (path === "/api/app/bootstrap") return response(bootstrap());
  if (call.headers.get("X-Fells-Expected-User") !== String(currentUser) || call.headers.get("X-Fells-Expected-Session") !== session) return response({ error: "session changed" }, 401);
  if (path === failedPath && method !== "GET") return response({ error: "injected write failure" }, 503);
  const u = server.users.get(currentUser);
  if (path === "/api/app/session" && method === "DELETE") { currentUser = 0; return response(undefined, 204); }
  if (path === "/api/app/profile") {
    if (method !== "GET") { if (body.name !== undefined) u.name = body.name; if (body.avatar !== undefined) u.avatar = body.avatar; }
    return response({ profile: { name: u.name, avatar: u.avatar }, email: u.email });
  }
  if (path === "/api/app/avatar" && method === "POST") { u.avatar = body.avatar; return response({ profile: { name: u.name, avatar: u.avatar }, email: u.email }); }
  if (path === "/api/app/preferences") { if (method !== "GET") Object.assign(u.prefs, body); return response(u.prefs); }
  if (path === "/api/app/keys") return response({ keys: server.keys, self_keys: true });
  if (path === "/api/app/workspaces") {
    if (method === "POST") server.workspaces.push({ ...body, role: "owner" });
    return response(method === "POST" ? { workspace: server.workspaces.at(-1) } : { workspaces: server.workspaces });
  }
  if (path === "/api/app/invitations" && method === "GET") return response({ invitations: server.receivedInvitations });
  const received = path.match(/^\/api\/app\/invitations\/([^/]+)\/(accept|decline)$/);
  if (received) {
    const invitation = server.receivedInvitations.find(item => item.id === received[1]);
    if (!invitation) return response({ error: "not found" }, 404);
    server.receivedInvitations = server.receivedInvitations.filter(item => item !== invitation);
    if (received[2] === "decline") return response(undefined, 204);
    const workspace = { id: invitation.workspace_id, name: invitation.workspace_name, region: "us-west", tz: "UTC", created: now, role: invitation.role };
    server.workspaces.push(workspace);
    return response({ workspace });
  }
  const pending = path.match(/^\/api\/app\/workspaces\/([^/]+)\/invitations(?:\/([^/]+))?$/);
  if (pending) {
    if (method === "DELETE") { server.pendingInvitations = server.pendingInvitations.filter(item => item.id !== pending[2]); return response(undefined, 204); }
    return response({ invitations: server.pendingInvitations.filter(item => item.workspace_id === pending[1]).map(({ workspace_id: _wid, ...item }) => item) });
  }
  const leave = path.match(/^\/api\/app\/workspaces\/([^/]+)\/leave$/);
  if (leave && method === "POST") { server.workspaces = server.workspaces.filter(item => item.id !== leave[1]); return response(undefined, 204); }
  const nested = path.match(/^\/api\/app\/workspaces\/([^/]+)(?:\/(chats(?:\/import)?|members)(?:\/(\d+))?)?$/);
  if (nested) {
    const [, wid, action, memberID] = nested;
    if (action === "chats") return response({ chats: server.chats.filter(c => c.ws === wid) });
    if (action === "chats/import") return addChat({ ...body, ws: wid }, true);
    if (action === "members") {
      if (method === "POST") {
        if (server.inviteStatus) return response(server.inviteResponse ?? { member: { user_id: 2, role: body.role } }, server.inviteStatus);
        const target = String(body.username ?? `#${body.user_id}`);
        server.pendingInvitations.push({ id: `inv-${server.nextInvitationID++}`, workspace_id: wid, label: `${target[0]}***`, role: body.role, created: now, expires: now + 1209600000 });
        return response({ invitation: { status: "pending", role: body.role } }, 202);
      }
      if (method === "DELETE") server.members = server.members.filter(m => m.user_id !== Number(memberID));
      return response({ members: server.members });
    }
    const w = server.workspaces.find(w => w.id === wid);
    if (!w) return response({ error: "not found" }, 404);
    if (method === "PATCH") Object.assign(w, body);
    if (method === "DELETE") { server.workspaces = server.workspaces.filter(w => w.id !== wid); server.chats = server.chats.filter(c => c.ws !== wid); return response(undefined, 204); }
    return response({ workspace: w });
  }
  if (path === "/api/app/chats" && method === "POST") return addChat(body, false);
  const generation = path.match(/^\/api\/app\/chats\/([^/]+)\/(generate|runs\/([^/]+))$/);
  if (generation) {
    const chat = server.chats.find(c => c.id === generation[1]);
    if (!chat) return response({ error: 'not found' }, 404);
    if (method === 'GET') {
      if (server.runUnauthorized) return response({ error: 'Run status unauthorized', run: { request_id: generation[3], status: 'unknown' } }, 401);
      return server.chatRun ? response({ run: server.chatRun }) : response({ error: 'not found' }, 404);
    }
    server.generations = (server.generations ?? 0) + 1;
    chat.model = body.model; chat.messages.push(['you', body.body], ['assistant', 'Server generated response']);
    chat.message_metadata.push({ id: 'generated-user', created: now, imported: false, author_user_id: currentUser, author_name: u.name }, { id: 'generated-assistant', created: now, imported: false });
    server.chatRun = { request_id: body.request_id, status: 'completed', message_id: 'generated-assistant' };
    if (server.generateRefusalDetails !== undefined) {
      chat.messages.pop(); chat.message_metadata.pop();
      server.chatRun = { request_id: body.request_id, status: server.generateRunStatus ?? 'failed', error_code: server.generateErrorCode ?? 'model_refused' };
      return response({ error: 'Synthetic model refusal', run: server.chatRun, stop_details: server.generateRefusalDetails }, 422);
    }
    if (server.generateUnauthorized) {
      chat.messages.pop(); chat.message_metadata.pop();
      server.chatRun = { request_id: body.request_id, status: server.generateRunStatus ?? 'unknown', error_code: 'upstream_unauthorized' };
      if (server.generateIdentity === 'expired') currentUser = 0;
      if (server.generateIdentity === 'replacement') session = hash('b');
      if (server.generateIdentity === 'other-user') { currentUser = 2; session = hash('b'); }
      return response({ error: 'Provider authentication failed', run: server.chatRun }, 401);
    }
    if (server.generateNetworkError) throw new TypeError('Response connection lost');
    if (server.generateAsync) {
      chat.messages.pop(); chat.message_metadata.pop();
      server.chatRun = { request_id: body.request_id, status: 'pending' };
      return response({ run: server.chatRun }, 202);
    }
    return response({ run: server.badRun ? { ...server.chatRun, request_id: 'different-request' } : server.chatRun });
  }
  const route = path.match(/^\/api\/app\/chats\/([^/]+)(?:\/messages(?:\/([^/]+))?)?$/);
  if (route) {
    const [, cid, mid] = route, c = server.chats.find(c => c.id === cid);
    if (!c) return response({ error: "not found" }, 404);
    if (path.endsWith("/messages") && method === "POST") {
      const meta = { id: `m-${calls.length}`, created: now, imported: false, author_user_id: currentUser, author_name: u.name };
      c.messages.push(["you", body.body]); c.message_metadata.push(meta); return response({ message: meta }, 201);
    }
    if (mid) {
      const i = c.message_metadata.findIndex(m => m.id === mid);
      if (method === "PATCH") c.messages[i][1] = body.body;
      if (method === "DELETE") { c.messages.splice(i, 1); c.message_metadata.splice(i, 1); return response(undefined, 204); }
      return response({ message: c.message_metadata[i] });
    }
    if (method === "PATCH") Object.assign(c, body);
    if (method === "DELETE") { server.chats = server.chats.filter(c => c.id !== cid); return response(undefined, 204); }
    return response({ chat: c });
  }
  return response({ error: `unhandled fixture route: ${method} ${path}` }, 404);
}
function addChat(body, imported) {
  const c = { ...body, message_metadata: body.messages.map((_, i) => ({ id: `new-${calls.length}-${i}`, created: body.created, imported, ...(imported ? {} : { author_user_id: currentUser, author_name: server.users.get(currentUser).name }) })) };
  server.chats.push(c); return response({ chat: c, imported }, 201);
}
beforeEach(() => {
  server = makeServer(); calls = []; currentUser = 1; session = hash("a"); hook = undefined; failedPath = undefined;
  const storage = new Map(); globalThis.sessionStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) };
  globalThis.fetch = mockFetch;
});
after(() => { globalThis.fetch = originalFetch; });
const writes = () => calls.filter(c => c.method !== "GET");

test("scoped conversation deletion validates only its target and preserves unrelated snapshot data", async () => {
  const other = clone(server.chats[0]); other.id = "c2"; other.title = "Preserved conversation";
  other.message_metadata = other.message_metadata.map(m => ({ ...m, id: `other-${m.id}` }));
  server.chats.push(other);
  const old = await readApp(), oldMetadata = getAppMessageMetadata("c2"); calls = [];
  hook = call => {
    if (call.method === "GET" && !["/api/app/bootstrap", "/api/app/chats/c1"].includes(call.path)) throw new Error("Unrelated GET must not enter the deletion critical path");
  };
  const next = await deleteAppChat(old, "c1");
  assert.deepEqual(calls.map(c => [c.method, c.path]), [["GET", "/api/app/bootstrap"], ["GET", "/api/app/chats/c1"], ["DELETE", "/api/app/chats/c1"], ["GET", "/api/app/bootstrap"]]);
  assert.deepEqual(next.state, { ...old.state, chats: old.state.chats.filter(c => c.id !== "c1") });
  assert.equal(next.revision, old.revision + 1);
  assert.deepEqual(getAppMessageMetadata("c1"), []); assert.deepEqual(getAppMessageMetadata("c2"), oldMetadata);
  assert.equal(getAppWorkspaceRole("w1"), "owner"); assert.equal(getAppKeys().length, 1);
  for (const call of calls.filter(c => c.path !== "/api/app/bootstrap")) {
    assert.equal(call.headers.get("X-Fells-Expected-User"), "1");
    assert.equal(call.headers.get("X-Fells-Expected-Session"), old.session);
  }
  assert.deepEqual(writes().map(c => c.method), ["DELETE"]);
});

for (const [label, change, ErrorType] of [
  ["title", c => { c.title = "Changed elsewhere"; }, StaleState],
  ["message", c => { c.messages[0][1] = "Changed elsewhere"; }, StaleState],
  ["provenance", c => { c.message_metadata[0].author_user_id = 2; }, StaleState],
  ["workspace", c => { c.ws = "other-workspace"; }, InvalidState],
  ["missing metadata", c => { delete c.message_metadata; }, InvalidState],
]) test(`scoped deletion refuses a changed target ${label} before DELETE`, async () => {
  const old = await readApp(); change(server.chats[0]);
  await assert.rejects(deleteAppChat(old, "c1"), ErrorType);
  assert.equal(writes().length, 0); assert.equal(server.chats.length, 1);
});

test("scoped deletion retains the existing serial boundary for an already active full read", { timeout: 5000 }, async () => {
  const old = await readApp();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  hook = async call => { if (call.path === "/api/app/profile") { entered(); await gate; } };
  const reading = readApp(); await started;
  const deleting = deleteAppChat(old, "c1");
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(writes().length, 0, "no new mutation lane bypasses the active read"); }
  finally { release(); }
  await reading; await deleting;
  assert.deepEqual(writes().map(c => c.method), ["DELETE"]);
});

test("scoped deletion does not adopt the ACK until the final identity check completes", { timeout: 5000 }, async () => {
  const old = await readApp(); let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  hook = async call => { if (call.path === "/api/app/bootstrap" && writes().length) { entered(); await gate; } };
  const deleting = deleteAppChat(old, "c1"); await started;
  try {
    assert.equal(server.chats.length, 0, "the endpoint already committed its DELETE");
    assert.equal(getAppMessageMetadata("c1").length, 3, "unverified ACK has not been adopted");
  } finally { release(); }
  assert.equal((await deleting).state.chats.length, 0);
});

test("scoped deletion keeps stale snapshots, viewer ACL and replacement sessions closed", async () => {
  const old = await readApp(); server.users.get(1).name = "New profile"; await readApp(); calls = [];
  await assert.rejects(deleteAppChat(old, "c1"), StaleState); assert.equal(calls.length, 0);
  server.workspaces[0].role = "viewer"; const viewer = await readApp(); calls = [];
  await assert.rejects(deleteAppChat(viewer, "c1"), InvalidState); assert.equal(calls.length, 0);
  server.workspaces[0].role = "owner"; const owner = await readApp(); session = hash("b");
  await assert.rejects(deleteAppChat(owner, "c1"), EndedSession);
  assert.equal(writes().length, 0);
});

for (const status of [403, 409]) test(`scoped deletion preserves server ACL/run rejection ${status} without retry`, async () => {
  const old = await readApp();
  globalThis.fetch = (path, options) => path === "/api/app/chats/c1" && options.method === "DELETE"
    ? (calls.push({ path, method: "DELETE" }), response({ error: "Deletion rejected" }, status)) : mockFetch(path, options);
  await assert.rejects(deleteAppChat(old, "c1"), error => error instanceof APIError && error.status === status);
  assert.equal(server.chats.length, 1); assert.equal(getAppMessageMetadata("c1").length, 3);
  assert.equal(writes().length, 1);
});

test("a lost committed DELETE response stays unconfirmed and an explicit retry reads 404 without resending", async () => {
  const old = await readApp();
  globalThis.fetch = async (path, options) => {
    const result = await mockFetch(path, options);
    if (options.method === "DELETE") throw new TypeError("Synthetic lost response");
    return result;
  };
  await assert.rejects(deleteAppChat(old, "c1"), error => error instanceof UnconfirmedChatDeletion && error.cause instanceof TypeError);
  assert.equal(server.chats.length, 0); assert.equal(getAppMessageMetadata("c1").length, 3);
  await assert.rejects(deleteAppChat(old, "c1"), error => error instanceof APIError && error.status === 404);
  assert.equal(writes().length, 1, "only the user-confirmed first DELETE was sent");
  await assert.rejects(commitApp(old, { ...old.state, theme: "dark" }), StaleState);
  assert.equal(server.users.get(1).prefs.theme, "system");
  assert.equal(writes().length, 1, "the old full snapshot cannot recreate deleted history or replay another write");
});

for (const failure of ["non-204", "post-identity-network", "post-identity-replacement"]) test(`scoped deletion keeps ${failure} unconfirmed`, async () => {
  const old = await readApp();
  globalThis.fetch = async (path, options) => {
    if (path === "/api/app/bootstrap" && writes().length) {
      if (failure === "post-identity-network") throw new TypeError("Synthetic identity read failure");
      if (failure === "post-identity-replacement") session = hash("c");
    }
    const result = await mockFetch(path, options);
    return failure === "non-204" && options.method === "DELETE" ? response({ ok: true }) : result;
  };
  await assert.rejects(deleteAppChat(old, "c1"), error => failure === "non-204" ? error instanceof UnconfirmedChatDeletion && error.cause instanceof APIError && error.cause.code === "unexpected_response" : failure === "post-identity-replacement" ? error instanceof EndedSession : error instanceof UnconfirmedChatDeletion && error.cause instanceof TypeError);
  assert.equal(writes().length, 1); assert.equal(server.chats.length, 0);
  if (failure === "post-identity-replacement") assert.equal(getAppAccount(), null);
  else assert.equal(getAppMessageMetadata("c1").length, 3);
});

test("local source notifications remain observable while legacy and other-page sources still require refresh", async () => {
  const OriginalChannel = globalThis.BroadcastChannel, messages = [];
  globalThis.BroadcastChannel = class { postMessage(value) { messages.push(value); } close() {} };
  try {
    const old = await readApp(); await deleteAppChat(old, "c1");
    assert.equal(messages.length, 1); assert.equal(isOwnAppChange(messages[0]), true);
    assert.deepEqual(Object.keys(messages[0]), ["source"], "notification contains no private snapshot or conversation text");
    for (const value of ["changed", null, {}, { source: "different-page" }]) assert.equal(isOwnAppChange(value), false);
  } finally { globalThis.BroadcastChannel = OriginalChannel; }
});

test("a pre-dispatch read failure is not described as an unconfirmed DELETE", async () => {
  const old = await readApp();
  hook = call => { if (call.path === "/api/app/chats/c1") throw new TypeError("Synthetic failed target read"); };
  await assert.rejects(deleteAppChat(old, "c1"), error => error instanceof TypeError && !(error instanceof UnconfirmedChatDeletion));
  assert.equal(writes().length, 0);
});

test("a waiting ordinary save may rebase only over this page's acknowledged deletion and never resurrect it", async () => {
  const old = await readApp(), draft = clone(old.state);
  draft.profile.name = "Intent retained while waiting"; draft.current = "example";
  const next = await deleteAppChat(old, "c1");
  const adjusted = rebaseAfterAppChatDeletes(old, next, draft, new Map([[next.revision, "c1"]]));
  assert.equal(adjusted.profile.name, draft.profile.name); assert.equal(adjusted.current, "example"); assert.equal(adjusted.chats.length, 0);
  const saved = await commitApp(next, adjusted);
  assert.equal(saved.state.profile.name, draft.profile.name); assert.equal(saved.state.current, "example");
  assert.equal(server.chats.length, 0);
  assert.deepEqual(writes().map(c => [c.method, c.path]), [["DELETE", "/api/app/chats/c1"], ["POST", "/api/app/profile"]]);
  assert.equal(draft.chats.length, 1, "the captured original draft is not mutated");
});

for (const kind of ["unconfirmed ID", "foreign revision", "other profile", "other workspace", "edited deleted chat"]) test(`waiting saves refuse deletion rebase across ${kind}`, async () => {
  const old = await readApp(), draft = clone(old.state), next = await deleteAppChat(old, "c1");
  const confirmed = new Map([[next.revision, "c1"]]);
  if (kind === "unconfirmed ID") confirmed.clear();
  if (kind === "foreign revision") next.revision++;
  if (kind === "other profile") next.state.profile.name = "External change";
  if (kind === "other workspace") next.state.current = "example";
  if (kind === "edited deleted chat") draft.chats[0].title = "Do not silently discard this edit";
  await assert.rejects(async () => rebaseAfterAppChatDeletes(old, next, draft, confirmed), StaleState);
  assert.equal(writes().length, 1, "no waiting save was dispatched");
});

test("waiting saves cannot rebase a deletion receipt into a replacement session", async () => {
  const old = await readApp(), next = await deleteAppChat(old, "c1");
  next.session = hash("b");
  assert.throws(() => rebaseAfterAppChatDeletes(old, next, old.state, new Map([[next.revision, "c1"]])), EndedSession);
  assert.equal(writes().length, 1);
});

test("blocked optional storage preserves this session's selected workspace but never crosses replacement logins", async () => {
  globalThis.sessionStorage = { getItem() { throw new DOMException("Blocked", "SecurityError"); }, setItem() { throw new DOMException("Blocked", "SecurityError"); } };
  let snapshot = await readApp();
  const state = clone(snapshot.state);
  state.workspaces.push({ id: "storage-w2", name: "New workspace", region: "ap", tz: "UTC", created: now }); state.current = "storage-w2";
  snapshot = await commitApp(snapshot, state);
  assert.equal((await readApp()).state.current, "storage-w2");
  snapshot = await readApp();
  await createAppChat(snapshot, { id: "storage-c2", ws: "storage-w2", title: "Real instruction", agent: "codex", model: "GPT", created: now, messages: [["you", "Saved without browser storage"]] });
  assert.equal((await readApp()).state.current, "storage-w2");
  assert.deepEqual(server.chats.find(c => c.id === "storage-c2").messages, [["you", "Saved without browser storage"]]);
  session = hash("c");
  assert.equal((await readApp()).state.current, "w1", "same user replacement cookie resets in-memory selection");
  snapshot = await readApp(); await commitApp(snapshot, { ...snapshot.state, current: "example" });
  currentUser = 2; session = hash("d");
  assert.equal((await readApp()).state.current, "w1", "different user's cookie resets in-memory selection");
});

test("remote state keeps currencies separate, truthful Key prefixes, message provenance and private avatars", async () => {
  const snapshot = await readApp();
  assert.equal(snapshot.session, hash("a"));
  assert.deepEqual(snapshot.state.credits, { bonus: 0, never: 0, period: 0 });
  assert.equal(getAppAccount().wallet.currency, "CNY"); assert.equal(getAppAccount().api_allowance.currency, "USD");
  assert.equal(getAppAccount().wallet.cash_micro, 12000000); assert.equal(getAppAccount().api_allowance.balance.micro, 34000000);
  assert.equal(snapshot.state.profile.avatar, "/api/app/avatar?v=1");
  assert.equal(snapshot.state.keys[0].last4, ""); assert.equal(snapshot.state.keys[0].prefix, "sk-ap-abc…"); assert.equal(getAppKeys()[0].prefix, "sk-ap-abc…");
  assert.equal(snapshot.state.keys[0].created, Math.floor(now / 1000) * 1000);
  assert.deepEqual(getAppMessageMetadata("c1").map(m => [m.id, m.imported, m.author_user_id]), [["m1",false,1],["m2",false,2],["m3",true,undefined]]);
  assert.equal(getAppWorkspaceRole("w1"), "owner");
  for (const c of calls.filter(c => c.path !== "/api/app/bootstrap")) assert.equal(c.headers.get("X-Fells-Expected-Session"), hash("a"));
});

test("a slow workspace does not hold the next batch while reads stay bounded and ordered", { timeout: 5000 }, async () => {
  server.workspaces = Array.from({ length: 9 }, (_, index) => ({ ...server.workspaces[0], id: `w${index + 1}`, name: `Workspace ${index + 1}` }));
  server.chats = server.workspaces.map((workspace, index) => ({ ...clone(server.chats[0]), id: `c${index + 1}`, ws: workspace.id }));
  let releaseSlow, startedFifth, activeReads = 0, peakReads = 0;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const fifth = new Promise(resolve => { startedFifth = resolve; });
  hook = async call => {
    if (!/^\/api\/app\/workspaces\/w\d+\/chats$/.test(call.path)) return;
    activeReads++; peakReads = Math.max(peakReads, activeReads);
    try {
      if (call.path === '/api/app/workspaces/w1/chats') await slow;
      if (call.path === '/api/app/workspaces/w5/chats') startedFifth();
      await Promise.resolve();
    } finally { activeReads--; }
  };
  const pending = readApp();
  let timer;
  try {
    await Promise.race([fifth, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('A free workspace-read slot was blocked by a slower request')), 2000); })]);
    assert.ok(activeReads >= 1, 'the first workspace remains pending while a later one starts');
    assert.ok(peakReads <= 4, 'workspace reads retain the existing concurrency ceiling');
  } finally { clearTimeout(timer); releaseSlow(); }
  const snapshot = await pending;
  assert.deepEqual(snapshot.state.chats.map(chat => chat.ws), server.workspaces.map(workspace => workspace.id));
  assert.equal(calls.filter(call => call.path === '/api/app/bootstrap').length, 2, 'identity is checked before and after the complete private snapshot');
  assert.equal(writes().length, 0);
});

for (const phase of ['initial identity', 'profile', 'workspace history', 'final identity', 'JSON body']) {
  test(`the startup deadline cancels ${phase} without publishing partial state or issuing writes`, { timeout: 5000 }, async t => {
    await readApp();
    const before = getAppBootstrap();
    let entered, aborted = false, bootstrapReads = 0;
    const blocked = new Promise(resolve => { entered = resolve; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => { t.mock.timers.reset(); globalThis.fetch = mockFetch; });
    globalThis.fetch = async (path, options) => {
      if (path === '/api/app/bootstrap') bootstrapReads++;
      const shouldBlock = phase === 'profile' ? path === '/api/app/profile'
        : phase === 'workspace history' ? path === '/api/app/workspaces/w1/chats'
          : phase === 'final identity' ? path === '/api/app/bootstrap' && bootstrapReads === 2
            : path === '/api/app/bootstrap';
      if (!shouldBlock) return mockFetch(path, options);
      assert.ok(options.signal, 'the same startup deadline reaches every private read');
      if (phase === 'JSON body') {
        return new Response(new ReadableStream({ start(controller) {
          options.signal.addEventListener('abort', () => { aborted = true; controller.error(options.signal.reason); }, { once: true });
          entered();
        } }), { headers: { 'content-type': 'application/json' } });
      }
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => { aborted = true; reject(options.signal.reason); }, { once: true });
        entered();
      });
    };
    const pending = readAppStartup();
    const rejected = assert.rejects(pending, error => error.status === 408 && error.code === 'account_read_timeout');
    await blocked;
    t.mock.timers.tick(20_000);
    await rejected;
    assert.equal(aborted, true, 'an unfinished response is cancelled, including its JSON body');
    assert.deepEqual(getAppBootstrap(), before, 'no partial startup snapshot is adopted');
    assert.equal(writes().length, 0, 'startup timeout cannot dispatch or retry a mutation');
    globalThis.fetch = mockFetch;
    t.mock.timers.reset();
    assert.ok(await readApp(), 'the serialization queue remains usable after cancellation');
  });
}

test("workspace create rename delete and ordinary user chat messages persist on fresh reads", async () => {
  let snapshot = await readApp();
  let state = clone(snapshot.state); state.workspaces.push({ id: "w2", name: "Actual", region: "ap", tz: "Asia/Shanghai", created: now }); state.current = "w2";
  snapshot = await commitApp(snapshot, state);
  state = clone(snapshot.state); state.workspaces.find(w => w.id === "w2").name = "Renamed";
  state.chats.push({ id: "c2", ws: "w2", title: "Task", agent: "codex", model: "GPT", created: now, messages: [["you", "Inspect code"]] });
  snapshot = await commitApp(snapshot, state);
  state = clone(snapshot.state); state.chats.find(c => c.id === "c2").messages.push(["you", "Continue"]);
  snapshot = await commitApp(snapshot, state);
  const refreshed = await readApp();
  assert.equal(refreshed.state.current, "w2"); assert.equal(refreshed.state.workspaces.find(w => w.id === "w2").name, "Renamed");
  assert.deepEqual(refreshed.state.chats.find(c => c.id === "c2").messages, [["you","Inspect code"],["you","Continue"]]);
  assert.ok(getAppMessageMetadata("c2").every(m => !m.imported && m.author_user_id === 1));
  assert.ok(writes().some(c => c.path === "/api/app/chats/c2/messages" && c.body.speaker === "you"));
  state = clone(snapshot.state); state.workspaces = state.workspaces.filter(w => w.id !== "w2"); state.chats = state.chats.filter(c => c.ws !== "w2"); state.current = "w1";
  await commitApp(snapshot, state);
  assert.ok(!(await readApp()).state.chats.some(c => c.id === "c2"));
});

test("unsupported state and fabricated Agent replies reject before any entity writes", async () => {
  const snapshot = await readApp();
  for (const change of [
    s => { s.budget.limit = 20; }, s => { s.defaultChannel = "another"; }, s => { s.credits.never = 10; },
    s => { s.installed = ["fake-plugin"]; }, s => { s.files = [{ id:"f",name:"fake" }]; },
    s => { s.env = { w1: [["TOKEN", "dummy-secret"]] }; }, s => { s.schedules = [{ id:"job",prompt:"Run an agent" }]; },
    s => { s.chats[0].messages.push(["agent", "Completed"]); },
    s => { s.chats.push({ id:"fake",ws:"w1",title:"Fake",agent:"codex",model:"GPT",created:now,messages:[["sys","success"]] }); },
  ]) {
    const state = clone(snapshot.state); state.profile.name = "Must not partially save"; change(state);
    await assert.rejects(commitApp(snapshot,state), InvalidState);
  }
  assert.equal(writes().length,0); assert.equal(server.users.get(1).name,"Alice");
});

test("history import is explicit and imported or other-author messages cannot be edited", async () => {
  let snapshot = await readApp();
  await assert.rejects(updateAppMessage(snapshot,"c1","m2","Stolen"),InvalidState);
  await assert.rejects(updateAppMessage(snapshot,"c1","m3","Rewritten"),InvalidState);
  snapshot = await updateAppMessage(snapshot,"c1","m1","Edited own instruction");
  assert.equal(snapshot.state.chats[0].messages[0][1],"Edited own instruction");
  // Owner moderation may delete other messages, but edit rights never expand.
  snapshot = await deleteAppMessage(snapshot,"c1","m2");
  assert.ok(!getAppMessageMetadata("c1").some(m=>m.id==="m2"));
  const history = { id:"imported",ws:"w1",title:"Imported",agent:"claude",model:"Claude",created:now,messages:[["you","Old"],["claude","Old reply"]] };
  await assert.rejects(createAppChat(snapshot,history),InvalidState);
  snapshot = await importAppChat(snapshot,history);
  assert.ok(getAppMessageMetadata("imported").every(m=>m.imported));
  assert.ok(writes().some(c=>c.path==="/api/app/workspaces/w1/chats/import"));
  assert.deepEqual((await readApp()).state.chats.find(c=>c.id==="imported").messages,history.messages);
});

test("current workspace is scoped to real user and read-only examples never create server records", async () => {
  let snapshot = await readApp();
  snapshot = await commitApp(snapshot,{ ...snapshot.state,current:"example" });
  assert.equal((await readApp()).state.current,"example"); assert.equal(writes().length,0);
  currentUser=2; session=hash("b");
  const next=await readApp(); assert.equal(next.state.current,"w1"); assert.notEqual(next.session,snapshot.session);
  await assert.rejects(commitApp(snapshot,snapshot.state),EndedSession);
});

test("cookie switch during private reads rejects late old-user data", async () => {
  const old=await readApp();
  hook=call=>{ if(call.path==="/api/app/profile") { currentUser=2;session=hash("b");hook=undefined; } };
  await assert.rejects(readApp(),EndedSession);
  assert.equal(getAppAccount(),null);
  const next=await readApp(); assert.equal(next.state.profile.name,"Bob");
  await assert.rejects(commitApp(old,{...old.state,theme:"dark"}),EndedSession);
  assert.equal(server.users.get(2).prefs.theme,"system");
});

test("same-user replacement Cookie makes old writes and stale logout fail safely", async () => {
  const old=await readApp(); session=hash("c");
  await assert.rejects(commitApp(old,{...old.state,theme:"dark"}),EndedSession);
  assert.equal(writes().length,0);
  await readApp();
  await assert.rejects(endApp(old.session),EndedSession);
  assert.equal(currentUser,1); assert.ok(!writes().some(c=>c.path==="/api/app/session"));
});

test("resource changes are detected before a stale save can replace newer history", async () => {
  const old=await readApp(); server.chats[0].title="Edited in another tab";
  await assert.rejects(commitApp(old,{...old.state,theme:"dark"}),StaleState);
  assert.equal(writes().length,0);
  assert.equal((await readApp()).state.chats[0].title,"Edited in another tab");
});

test("partial multi-entity failure is reported and old snapshot cannot replay a POST", async () => {
  const old=await readApp(); failedPath="/api/app/preferences";
  await assert.rejects(commitApp(old,{...old.state,profile:{name:"Saved first",avatar:old.state.profile.avatar},theme:"dark"}),/injected write failure/);
  assert.equal(server.users.get(1).name,"Saved first");
  await assert.rejects(commitApp(old,old.state),StaleState);
  const actual=await readApp(); assert.equal(actual.state.profile.name,"Saved first");assert.equal(actual.state.theme,"system");
});

test("server history uses per-workspace limits and legacy emails retain authentic identity",async()=>{
  server.users.get(1).email="a".repeat(300)+"@example.invalid";
  server.workspaces.push({id:"w2",name:"More",region:"ap",tz:"UTC",created:now,role:"viewer"});
  server.chats=Array.from({length:600},(_,i)=>({id:`chat${i}`,ws:i<300?"w1":"w2",title:"Stored",agent:"codex",model:"GPT",created:now,messages:[],message_metadata:[]}));
  const snapshot=await readApp();assert.equal(snapshot.state.chats.length,600);assert.equal(snapshot.state.email,server.users.get(1).email);
  const draft=clone(snapshot.state);draft.chats.find(c=>c.ws==="w2").title="No write";
  await assert.rejects(commitApp(snapshot,draft),InvalidState);assert.equal(writes().length,0);
});

test("invitations remain pending until acceptance and nonowners cannot issue them",async()=>{
  await readApp(); assert.deepEqual((await listAppMembers("w1")).map(m=>m.name),["Alice","Bob"]);
  const updated=await setAppMember("w1",{username:"bob",role:"viewer"});
  assert.equal(updated.session,hash("a"));assert.equal((await listAppMembers("w1")).find(m=>m.user_id===2).role,"editor");
  assert.deepEqual((await listAppPendingInvitations("w1")).map(inv => inv.role), ["viewer"]);
  assert.deepEqual(writes().at(-1).body,{username:"bob",role:"viewer"});
  await revokeAppInvitation("w1", server.pendingInvitations[0].id);
  assert.deepEqual(await listAppPendingInvitations("w1"), []);
  server.workspaces[0].role="viewer";await readApp();const count=writes().length;
  await assert.rejects(setAppMember("w1",{username:"missing",role:"editor"}),InvalidState);
  assert.equal(writes().length,count);
});

test("recipient can accept, decline and leave without claiming owner access", async () => {
  server.workspaces = [];
  server.chats = [];
  server.receivedInvitations = [
    { id: "inv-accept", workspace_id: "shared-2", workspace_name: "Invited room", role: "viewer", inviter_name: "Member #7", created: now, expires: now + 1209600000 },
    { id: "inv-decline", workspace_id: "shared-3", workspace_name: "Other room", role: "editor", inviter_name: "Member #8", created: now, expires: now + 1209600000 },
  ];
  await readApp();
  assert.deepEqual((await listAppReceivedInvitations()).map(inv => inv.workspace_name), ["Invited room", "Other room"]);
  const joined = await acceptAppInvitation("inv-accept");
  assert.equal(joined.state.workspaces.find(w => w.id === "shared-2")?.name, "Invited room");
  await declineAppInvitation("inv-decline");
  assert.deepEqual(await listAppReceivedInvitations(), []);
  await leaveAppWorkspace("shared-2");
  assert.deepEqual((await readApp()).state.workspaces, []);
});

test("invitation adapters reject legacy success, corrupt records and forbidden owner actions", async () => {
  await readApp();
  server.inviteStatus = 200;
  await assert.rejects(setAppMember("w1", { username: "bob", role: "viewer" }), error => error instanceof APIError && error.code === "unexpected_response" && error.status === 200);
  assert.equal(server.members.find(m => m.user_id === 2).role, "editor", "a legacy success cannot be represented as a pending invitation");
  await readApp();
  server.inviteStatus = 202;
  server.inviteResponse = { invitation: { status: "accepted", role: "viewer" } };
  await assert.rejects(setAppMember("w1", { username: "bob", role: "viewer" }), InvalidState);
  server.inviteStatus = undefined;
  await readApp();
  await assert.rejects(setAppMember("w1", { username: " ", role: "viewer" }), InvalidState);
  await assert.rejects(setAppMember("w1", { username: "bob", role: "owner" }), InvalidState);
  await assert.rejects(leaveAppWorkspace("w1"), InvalidState);
  server.pendingInvitations.push({ id: "bad/path", workspace_id: "w1", label: "b***", role: "viewer", created: now, expires: now + 1209600000 });
  await assert.rejects(listAppPendingInvitations("w1"), InvalidState);
  server.pendingInvitations = [];
  server.receivedInvitations.push({ id: "inv-3", workspace_id: "w2", workspace_name: "Other", role: "owner", inviter_name: "Member #3", created: now, expires: now + 1209600000 });
  await assert.rejects(listAppReceivedInvitations(), InvalidState);
  server.receivedInvitations = [];
  server.workspaces[0].role = "viewer";
  await readApp();
  await assert.rejects(listAppPendingInvitations("w1"), InvalidState);
  await assert.rejects(revokeAppInvitation("w1", "inv-1"), InvalidState);
});

test("real logout validates identity, sends expected session and clears server session",async()=>{
  const old=await readApp();await endApp(old.session);assert.equal(currentUser,0);assert.equal(getAppAccount(),null);
  assert.equal(writes().at(-1).headers.get("X-Fells-Expected-Session"),hash("a"));
  assert.equal(await readApp(),null);
});

test("expired real session makes mutations throw EndedSession before any write",async()=>{
  const old=await readApp();currentUser=0;
  await assert.rejects(commitApp(old,{...old.state,theme:"dark"}),EndedSession);
  assert.equal(writes().length,0);assert.equal(getAppAccount(),null);
});

test("ongoing API Key activity does not prevent unrelated profile persistence",async()=>{
  const old=await readApp();server.keys[0].request_count=123;server.keys[0].last_used_at=1791520100;
  const saved=await commitApp(old,{...old.state,profile:{...old.state.profile,name:"Updated while API is active"}});
  assert.equal(saved.state.profile.name,"Updated while API is active");assert.equal(getAppKeys()[0].request_count,123);
});

test("queued account refresh does not turn readonly member and invitation lists into stale writes",async()=>{
  const old=await readApp();
  server.keys[0].name="Renamed in another tab";
  const refreshing=readApp();
  const reads=Promise.all([listAppMembers("w1"),listAppReceivedInvitations(),listAppPendingInvitations("w1")]);
  const latest=await refreshing;
  assert.ok(latest.revision>old.revision,"the queued refresh advances real account state");
  const [members,received,pending]=await reads;
  assert.deepEqual(members.map(member=>member.name),["Alice","Bob"]);
  assert.deepEqual(received,[]);assert.deepEqual(pending,[]);
  assert.equal(writes().length,0,"read-only recovery sends no mutation");
  await assert.rejects(commitApp(old,{...old.state,theme:"dark"}),StaleState);
  assert.equal(writes().length,0,"a stale write still requires review of the newer snapshot");
});

test("queued readonly account lists still reject a replacement login",async()=>{
  await readApp();
  session=hash("b");
  const refreshing=readApp();
  const reads=Promise.allSettled([listAppMembers("w1"),listAppReceivedInvitations(),listAppPendingInvitations("w1")]);
  await refreshing;
  for(const result of await reads){
    assert.equal(result.status,"rejected");assert.ok(result.reason instanceof EndedSession);
  }
  assert.equal(writes().length,0);
});

test('signed allowance and operator-unlimited keys preserve their distinct business domains', async () => {
  server.allowanceMicro = -100001;
  server.keys = [-1, 0, 1234567].map((limit, index) => ({ ...server.keys[0], id: index + 1, monthly_allow_limit_micro: limit }));
  server.keys.push({ ...server.keys[0], id: 4, revoked: true });
  const snapshot = await readApp();
  assert.equal(getAppAccount().api_allowance.balance.micro, -100001);
  assert.deepEqual(snapshot.state.keys.map(key => key.limit), [-1, 0, 1.234567]);
  assert.equal(getAppKeys().at(-1).monthly_allow_limit_micro, -1);
  const saved = await commitApp(snapshot, { ...snapshot.state, profile: { ...snapshot.state.profile, name: 'Still editable' } });
  assert.equal(saved.state.profile.name, 'Still editable');
});
for (const value of [-2, -0.5, Number.MAX_SAFE_INTEGER + 1]) test(`invalid key cap ${value} remains rejected`, async () => {
  server.keys[0].monthly_allow_limit_micro = value;
  await assert.rejects(readApp(), InvalidState);
});
test('signed balance validation still rejects fractions and unrelated negative IDs', async () => {
  server.allowanceMicro = -0.5;
  await assert.rejects(readApp(), InvalidState);
  server.allowanceMicro = -1;
  server.keys[0].id = -1;
  await assert.rejects(readApp(), InvalidState);
});

test('compensation is validated before being used in the conversation funding breakdown', async () => {
  server.compensationMicro = 3000000;
  await readApp();
  assert.equal(getAppBootstrap().api_allowance.balance.comp_micro, 3000000);
  for (const invalid of [-1, 0.5, '3000000', null]) {
    server.compensationMicro = invalid;
    await assert.rejects(readApp(), InvalidState);
  }
});

for (const legacyPrice of [undefined, 0]) test(`quote-only bootstrap with legacy price ${legacyPrice} keeps balances readable`, async () => {
  server.legacyPrice=legacyPrice;
  const snapshot=await readApp();assert.ok(snapshot);assert.equal(getAppBootstrap().api_allowance.balance.micro,34000000);assert.equal(getAppBootstrap().api_allowance.price_cny,legacyPrice);
});
for (const legacyPrice of [-1, '7.2', null]) test(`an invalid supplied legacy price ${legacyPrice} cannot masquerade as a quote`, async () => {
  server.legacyPrice=legacyPrice;await assert.rejects(readApp(),/Invalid allowance price/);
});

const modelRequest = { request_id: 'b1b404cc-0539-4bb8-a875-a500a63b3a13', body: 'A real model instruction', model: 'scope/text-v2', billing_mode: 'account_allowance' };
const legacyModelRequest = { request_id: modelRequest.request_id, body: modelRequest.body, model: modelRequest.model, key_id: 12 };
function enableModelChat() { server.modelChat = true; Object.assign(server.keys[0], { kind: 'user', expires_at: 0 }); }
test('a pending model response leaves account reads, run checks and unrelated profile writes available', async () => {
  enableModelChat(); const snapshot = await readApp();
  let release, started, settled = false;
  const waiting = new Promise(resolve => { release = resolve; });
  const dispatched = new Promise(resolve => { started = resolve; });
  hook = async call => {
    if (call.path.endsWith('/generate')) {
      server.chatRun = { request_id: modelRequest.request_id, status: 'running' };
      started(); await waiting;
    }
  };
  const generation = generateAppChat(snapshot, 'c1', modelRequest);
  void generation.then(() => { settled = true; }, () => { settled = true; });
  let latest;
  try {
    await dispatched;
    const independent = (async () => {
      const refreshed = await readApp();
      assert.deepEqual((await listAppMembers('w1')).map(member => member.name), ['Alice', 'Bob']);
      const checked = await readAppChatRun(refreshed, 'c1', modelRequest.request_id);
      assert.equal(checked.run.status, 'running');
      const state = clone(checked.snapshot.state); state.profile.name = 'Edited during model response';
      latest = await commitApp(checked.snapshot, state);
      assert.equal(latest.state.profile.name, 'Edited during model response');
    })();
    let timeout;
    try { await Promise.race([independent, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Model latency blocked the account queue')), 1000); })]); }
    finally { clearTimeout(timeout); }
    assert.equal(settled, false, 'independent operations complete before the model response');
    await assert.rejects(generateAppChat(latest, 'c1', { ...modelRequest, request_id: 'c1b404cc-0539-4bb8-a875-a500a63b3a13' }), /already pending/);
    assert.equal(writes().filter(call => call.path.endsWith('/generate')).length, 1, 'a second pending instruction is not dispatched');
  } finally { release(); }
  const result = await generation;
  assert.equal(result.error, undefined);
  assert.equal(result.snapshot.state.profile.name, 'Edited during model response', 'late history adoption preserves the completed profile write');
  assert.ok(result.snapshot.revision > latest.revision, 'late history adoption never lowers the active revision');
  assert.equal(server.generations, 1);
});

test('different conversations may generate concurrently without sharing an inference queue', async () => {
  enableModelChat();
  server.chats.push({ ...clone(server.chats[0]), id: 'c2', messages: [], message_metadata: [] });
  const snapshot = await readApp();
  let release, bothStarted;
  const waiting = new Promise(resolve => { release = resolve; });
  const dispatched = new Promise(resolve => { bothStarted = resolve; });
  let pending = 0;
  hook = async call => { if (call.path.endsWith('/generate')) { if (++pending === 2) bothStarted(); await waiting; } };
  const one = generateAppChat(snapshot, 'c1', modelRequest);
  const two = generateAppChat(snapshot, 'c2', { ...modelRequest, request_id: 'c1b404cc-0539-4bb8-a875-a500a63b3a13' });
  let timeout;
  try { await Promise.race([dispatched, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Separate conversations were serialized behind inference')), 1000); })]); }
  finally { clearTimeout(timeout); release(); }
  const results = await Promise.all([one, two]);
  assert.equal(results.every(result => result.run.status === 'completed'), true);
  assert.equal(server.generations, 2);
  assert.equal(getAppBootstrap().session_id, snapshot.session);
  assert.ok(results[1].snapshot.revision > results[0].snapshot.revision);
});

test('signing out completes while generation is pending and rejects its late response', async () => {
  enableModelChat(); const snapshot = await readApp();
  let release, started;
  const waiting = new Promise(resolve => { release = resolve; });
  const dispatched = new Promise(resolve => { started = resolve; });
  hook = async call => { if (call.path.endsWith('/generate')) { started(); await waiting; } };
  const generation = generateAppChat(snapshot, 'c1', modelRequest);
  await dispatched;
  let timeout;
  try { await Promise.race([endApp(snapshot.session), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Pending inference blocked sign out')), 1000); })]); }
  finally { clearTimeout(timeout); release(); }
  await assert.rejects(generation, EndedSession);
  assert.equal(getAppBootstrap(), null);
  assert.equal(currentUser, 0);
});

test('model generation is an identity-bound operation and adopts only authoritative generated history', async () => {
  enableModelChat(); const snapshot = await readApp();
  const result = await generateAppChat(snapshot, 'c1', modelRequest);
  assert.equal(result.error, undefined); assert.equal(result.run.status, 'completed');
  assert.deepEqual(result.snapshot.state.chats[0].messages.slice(-2), [['you', modelRequest.body], ['assistant', 'Server generated response']]);
  assert.equal(getAppMessageMetadata('c1').at(-1).author_user_id, undefined);
  assert.equal(getAppMessageMetadata('c1')[1].author_user_id, 2, 'shared authors remain intact');
  assert.equal(getAppMessageMetadata('c1')[2].imported, true, 'imported history remains labelled');
  const paid = writes().filter(call => call.path.endsWith('/generate'));
  assert.equal(paid.length, 1); assert.deepEqual(paid[0].body, modelRequest);
  assert.equal(paid[0].headers.get('X-Fells-Expected-User'), '1'); assert.equal(paid[0].headers.get('X-Fells-Expected-Session'), hash('a'));
  assert.equal(writes().some(call => call.path.endsWith('/messages')), false);
  await assert.rejects(updateAppMessage(result.snapshot, 'c1', 'generated-assistant', 'Forged edit'), /not editable/);
  const fake = clone(result.snapshot.state); fake.chats[0].messages.push(['assistant', 'Fabricated reply']);
  await assert.rejects(commitApp(result.snapshot, fake), /fabricated replies/);
});

test('web search is an explicit boolean opt-in on the single identity-bound generation request', async () => {
  enableModelChat(); const snapshot = await readApp();
  assert.throws(() => generateAppChat(snapshot, 'c1', { ...modelRequest, web_search: 'yes' }), InvalidState);
  const result = await generateAppChat(snapshot, 'c1', { ...modelRequest, web_search: true });
  assert.equal(result.run.status, 'completed');
  const paid = writes().filter(call => call.path.endsWith('/generate'));
  assert.equal(paid.length, 1);
  assert.equal(paid[0].body.web_search, true);
  assert.equal(paid[0].headers.get('X-Fells-Expected-Session'), hash('a'));
});

for (const scenario of ['refused', 'malformed', 'unknown', 'other-failure']) test(`immediate refusal diagnostics require a matching known model-refused receipt: ${scenario}`, async () => {
  enableModelChat();
  server.generateRefusalDetails = { type: 'refusal', category: 'future_category', explanation: 'Synthetic bounded explanation', thinking: 'private partial' };
  if (scenario === 'malformed') server.generateRefusalDetails.explanation = 'x'.repeat(4097);
  if (scenario === 'unknown') server.generateRunStatus = 'unknown';
  if (scenario === 'other-failure') server.generateErrorCode = 'gateway_error';
  const result = await generateAppChat(await readApp(), 'c1', modelRequest);
  assert.equal(result.run.status, scenario === 'unknown' ? 'unknown' : 'failed');
  assert.deepEqual(result.refusal, scenario === 'refused' ? { type: 'refusal', category: 'future_category', explanation: 'Synthetic bounded explanation' } : undefined);
  assert.equal(result.snapshot.state.chats[0].messages.at(-1)[0], 'you');
  assert.equal(writes().filter(call => call.path.endsWith('/generate')).length, 1, 'a refusal never triggers an automatic paid retry');
  const checked = await readAppChatRun(result.snapshot, 'c1', modelRequest.request_id);
  assert.equal(checked.refusal, undefined, 'a later status read does not invent historical diagnostics');
});
test('ordered attachment manifests are validated before the single generation dispatch', async () => {
  enableModelChat(); const snapshot = await readApp();
  for (const attachment_ids of [['a','a'], ['../a'], ['a','b','c','d','e'], 'a']) assert.throws(() => generateAppChat(snapshot, 'c1', { ...modelRequest, attachment_ids }), InvalidState);
  const result = await generateAppChat(snapshot, 'c1', { ...modelRequest, attachment_ids: ['second','first'] });
  assert.equal(result.run.status, 'completed');
  const paid = writes().filter(call => call.path.endsWith('/generate'));
  assert.equal(paid.length, 1); assert.deepEqual(paid[0].body.attachment_ids, ['second','first']);
});
test('account generation works with zero keys and never creates or selects a hidden key', async () => {
  enableModelChat(); server.keys = [];
  const result = await generateAppChat(await readApp(), 'c1', modelRequest);
  assert.equal(result.run.status, 'completed');
  assert.equal(server.generations, 1);
  const paid = writes().filter(call => call.path.endsWith('/generate'));
  assert.deepEqual(paid[0].body, modelRequest);
  assert.equal(Object.hasOwn(paid[0].body, 'key_id'), false);
  assert.equal(writes().some(call => call.path === '/api/app/keys'), false);
  assert.deepEqual(server.keys, []);
});
test('account billing rejects a supplied key rather than silently spending from it', async () => {
  enableModelChat(); const snapshot = await readApp();
  assert.throws(() => generateAppChat(snapshot, 'c1', { ...modelRequest, key_id: 12 }), InvalidState);
  assert.equal(writes().filter(call => call.path.endsWith('/generate')).length, 0);
});
test('legacy explicit key generation remains compatible for active personal keys', async () => {
  enableModelChat();
  const result = await generateAppChat(await readApp(), 'c1', legacyModelRequest);
  assert.equal(result.run.status, 'completed');
  assert.deepEqual(writes().find(call => call.path.endsWith('/generate')).body, legacyModelRequest);
});
for (const condition of ['disabled', 'viewer']) test('account generation rejects before spending when ' + condition, async () => {
  enableModelChat();
  if (condition === 'disabled') server.modelChat = false;
  if (condition === 'viewer') server.workspaces[0].role = 'viewer';
  const snapshot = await readApp(); await assert.rejects(generateAppChat(snapshot, 'c1', modelRequest), InvalidState);
  assert.equal(writes().filter(call => call.path.endsWith('/generate')).length, 0);
});
for (const condition of ['cli-key', 'expired-key', 'revoked-key']) test('legacy key generation rejects before spending when ' + condition, async () => {
  enableModelChat();
  if (condition === 'cli-key') server.keys[0].kind = 'cli';
  if (condition === 'expired-key') server.keys[0].expires_at = 1;
  if (condition === 'revoked-key') server.keys[0].revoked = true;
  await assert.rejects(generateAppChat(await readApp(), 'c1', legacyModelRequest), InvalidState);
  assert.equal(writes().filter(call => call.path.endsWith('/generate')).length, 0);
});
test('a lost generation response refreshes history and a subsequent status check is GET only', async () => {
  enableModelChat(); server.generateNetworkError = true;
  const result = await generateAppChat(await readApp(), 'c1', modelRequest);
  assert.equal(result.run, null); assert.match(result.error.message, /connection lost/);
  assert.equal(result.snapshot.state.chats[0].messages.at(-1)[1], 'Server generated response');
  const checked = await readAppChatRun(result.snapshot, 'c1', modelRequest.request_id);
  assert.equal(checked.run.status, 'completed'); assert.equal(server.generations, 1);
  assert.equal(calls.filter(call => call.path.includes('/runs/')).every(call => call.method === 'GET'), true);
});
test('a mismatched run receipt never authorizes fabricated completion', async () => {
  enableModelChat(); server.badRun = true;
  const result = await generateAppChat(await readApp(), 'c1', modelRequest);
  assert.equal(result.run, null); assert.match(result.error.message, /Invalid conversation run/); assert.equal(server.generations, 1);
});
test('run receipts preserve the exact server run, chat and both message bindings', async () => {
  enableModelChat(); const snapshot = await readApp();
  server.chatRun = { id: 'bound-run', chat_id: 'c1', request_id: modelRequest.request_id, status: 'completed', message_id: 'm1', assistant_message_id: 'saved-assistant' };
  const result = await readAppChatRun(snapshot, 'c1', modelRequest.request_id);
  assert.deepEqual(result.run, server.chatRun);
  assert.equal(calls.filter(call => call.path.includes('/runs/')).every(call => call.method === 'GET'), true);
  assert.equal(server.generations ?? 0, 0);
});
for (const invalidBinding of [{ chat_id: 'c2' }, { chat_id: null }, { id: 42 }, { id: '../run' }, { assistant_message_id: null }, { assistant_message_id: ['saved-assistant'] }, { assistant_message_id: '../message' }]) test(`run receipt binding fields are strict: ${JSON.stringify(invalidBinding)}`, async () => {
  enableModelChat(); const snapshot = await readApp();
  server.chatRun = { id: 'bound-run', chat_id: 'c1', request_id: modelRequest.request_id, status: 'completed', message_id: 'm1', assistant_message_id: 'saved-assistant', ...invalidBinding };
  const result = await readAppChatRun(snapshot, 'c1', modelRequest.request_id);
  assert.equal(result.run, null); assert.ok(result.error instanceof InvalidState);
  assert.equal(server.generations ?? 0, 0);
});
test('status reads rebase a stale view within the same session while paid generations stay strict', async () => {
  enableModelChat(); const stale = await readApp();
  server.chats[0].title = 'History updated during the initial background refresh';
  server.chatRun = { request_id: modelRequest.request_id, status: 'completed' };
  const latest = await readApp(); assert.ok(latest.revision > stale.revision);
  await assert.rejects(generateAppChat(stale, 'c1', modelRequest), StaleState);
  const result = await readAppChatRun(stale, 'c1', modelRequest.request_id);
  assert.equal(result.run.status, 'completed'); assert.equal(result.snapshot.session, stale.session);
  assert.ok(result.snapshot.revision > latest.revision, 'a read never lowers the active revision');
  assert.equal(result.snapshot.state.chats[0].title, server.chats[0].title);
  const reads = calls.filter(call => call.path.includes('/runs/'));
  assert.equal(reads.length, 1); assert.equal(reads[0].method, 'GET');
  assert.equal(reads[0].headers.get('X-Fells-Expected-Session'), stale.session);
  assert.equal(server.generations, undefined);
});
test('status reads cannot rebase into a replacement session or regain removed workspace access', async () => {
  enableModelChat(); const stale = await readApp();
  server.workspaces = []; await readApp();
  await assert.rejects(readAppChatRun(stale, 'c1', modelRequest.request_id), /Unknown conversation/);
  currentUser = 2; session = hash('b'); await readApp();
  await assert.rejects(readAppChatRun(stale, 'c1', modelRequest.request_id), EndedSession);
  assert.equal(calls.filter(call => call.path.includes('/runs/')).length, 0);
  assert.equal(server.generations, undefined);
});
test('run reads retain optional authoritative millisecond timestamps without inventing missing metadata', async () => {
  enableModelChat(); const snapshot = await readApp();
  const requestID = 'd1b404cc-0539-4bb8-a875-a500a63b3a13';
  server.chatRun = { request_id: requestID, status: 'unknown', created: now, updated: now + 65_000, deadline: now + 300_000 };
  const result = await readAppChatRun(snapshot, 'c1', requestID);
  assert.deepEqual(result.run, { request_id: requestID, status: 'unknown', created: now, updated: now + 65_000 });
  server.chatRun = { request_id: requestID, status: 'unknown' };
  const legacy = await readAppChatRun(result.snapshot, 'c1', requestID);
  assert.deepEqual(legacy.run, { request_id: requestID, status: 'unknown' });
  assert.equal(writes().length, 0, 'timing inspection makes no generation request');
});

for (const metadata of [{ created: '1791520000123', updated: now + 65_000 }, { created: now, updated: null }, { created: -1, updated: now }, { created: now, updated: 8.64e15 + 1 }, { created: now + 0.5, updated: now + 65_000 }]) {
  test('malformed run timestamps cannot become a receipt: ' + JSON.stringify(metadata), async () => {
    enableModelChat(); const snapshot = await readApp();
    const requestID = 'd1b404cc-0539-4bb8-a875-a500a63b3a13';
    server.chatRun = { request_id: requestID, status: 'unknown', ...metadata };
    const result = await readAppChatRun(snapshot, 'c1', requestID);
    assert.equal(result.run, null);
    assert.ok(result.error instanceof InvalidState);
    assert.equal(writes().length, 0);
  });
}

test('unchanged nonterminal run polls verify identity without refetching every account resource', async () => {
  enableModelChat(); const snapshot = await readApp();
  const requestID = 'd1b404cc-0539-4bb8-a875-a500a63b3a13';
  server.chatRun = { request_id: requestID, status: 'running' };
  const initial = await readAppChatRun(snapshot, 'c1', requestID);
  assert.ok(initial.snapshot, 'the first observed state loads authoritative history');
  calls = [];
  const unchanged = await readAppChatRun(initial.snapshot, 'c1', requestID);
  assert.equal(unchanged.snapshot, null); assert.equal(unchanged.run.status, 'running');
  assert.deepEqual(calls.map(call => call.path), ['/api/app/bootstrap', `/api/app/chats/c1/runs/${requestID}`, '/api/app/bootstrap']);
  assert.equal(writes().length, 0);
  const draft = clone(initial.snapshot.state); draft.profile.name = 'No poll-induced conflict';
  const saved = await commitApp(initial.snapshot, draft);
  assert.equal(saved.state.profile.name, 'No poll-induced conflict', 'an unchanged read does not invalidate a writable snapshot');
  server.chatRun.status = 'unknown';
  const changed = await readAppChatRun(saved, 'c1', requestID);
  assert.ok(changed.snapshot, 'a changed state gets a history reconciliation');
  calls = [];
  assert.equal((await readAppChatRun(changed.snapshot, 'c1', requestID)).snapshot, null);
  assert.equal(calls.some(call => call.path.includes('/workspaces')), false, 'unchanged unknown is also a short read');
  for (const status of ['completed', 'failed']) {
    server.chatRun.status = status; calls = [];
    const terminal = await readAppChatRun(changed.snapshot, 'c1', requestID);
    assert.ok(terminal.snapshot, 'terminal receipts include authoritative history');
    assert.equal(calls.some(call => call.path === '/api/app/workspaces/w1/chats'), true);
  }
});
test('the short unchanged-run path rejects a cookie replacement after receiving its receipt', async () => {
  enableModelChat(); const snapshot = await readApp();
  const requestID = 'e1b404cc-0539-4bb8-a875-a500a63b3a13';
  server.chatRun = { request_id: requestID, status: 'pending' };
  const first = await readAppChatRun(snapshot, 'c1', requestID);
  let received = false;
  hook = call => {
    if (call.path.includes('/runs/')) received = true;
    else if (received && call.path === '/api/app/bootstrap') { currentUser = 2; session = hash('b'); }
  };
  await assert.rejects(readAppChatRun(first.snapshot, 'c1', requestID), EndedSession);
  assert.equal(getAppBootstrap(), null);
});
test('a replacement session cannot receive or perform a queued paid generation', async () => {
  enableModelChat(); const snapshot = await readApp();
  hook = call => { if (call.path.endsWith('/generate')) { currentUser = 2; session = hash('b'); } };
  await assert.rejects(generateAppChat(snapshot, 'c1', modelRequest), EndedSession);
  assert.equal(server.generations, undefined);
});

for (const status of ['unknown', 'failed']) test(`an upstream 401 preserves a ${status} run only after fresh cookie identity verification`, async () => {
  enableModelChat(); server.generateUnauthorized = true; server.generateRunStatus = status;
  const snapshot = await readApp(), result = await generateAppChat(snapshot, 'c1', modelRequest);
  assert.equal(result.run.status, status); assert.equal(result.error.status, 401);
  assert.equal(result.error.details.run.request_id, modelRequest.request_id);
  assert.equal(result.snapshot.session, snapshot.session); assert.equal(getAppBootstrap().user.id, 1);
  assert.equal(result.snapshot.state.chats[0].messages.at(-1)[1], modelRequest.body);
  const sent = calls.findIndex(call => call.path.endsWith('/generate'));
  assert.equal(calls[sent + 1].path, '/api/app/bootstrap', '401 is followed by an independent fresh identity read');
  assert.equal(calls[sent + 1].headers.has('X-Fells-Expected-User'), false);
  const checked = await readAppChatRun(result.snapshot, 'c1', modelRequest.request_id);
  assert.equal(checked.run.status, status); assert.equal(server.generations, 1);
});
for (const identity of ['expired', 'replacement', 'other-user']) test(`an upstream-looking 401 still ends a ${identity} cookie session`, async () => {
  enableModelChat(); server.generateUnauthorized = true; server.generateIdentity = identity;
  const snapshot = await readApp();
  await assert.rejects(generateAppChat(snapshot, 'c1', modelRequest), EndedSession);
  assert.equal(server.generations, 1); assert.equal(getAppBootstrap(), null);
});
test('a run status GET returning 401 remains a strict session failure', async () => {
  enableModelChat(); const snapshot = await readApp();
  server.runUnauthorized = true;
  await assert.rejects(readAppChatRun(snapshot, 'c1', modelRequest.request_id), EndedSession);
  assert.equal(calls.some(call => call.path.includes('/runs/')), true);
  assert.equal(currentUser, 1, 'status reads do not acquire the generation-only provider-401 exception');
  assert.equal(getAppBootstrap(), null); assert.equal(server.generations, undefined);
});
test('an unverifiable cookie after a generation 401 cannot authorize its supplied run receipt', async () => {
  enableModelChat(); server.generateUnauthorized = true; server.generateRunStatus = 'failed';
  const snapshot = await readApp(); let sent = false;
  hook = call => {
    if (call.path.endsWith('/generate')) sent = true;
    else if (sent && call.path === '/api/app/bootstrap') { sent = false; throw new TypeError('Identity confirmation unavailable'); }
  };
  const result = await generateAppChat(snapshot, 'c1', modelRequest);
  assert.equal(result.run, null); assert.match(result.error.message, /Identity confirmation unavailable/);
  assert.equal(result.snapshot.session, snapshot.session); assert.equal(getAppBootstrap().user.id, 1);
  assert.equal(server.generations, 1);
});


test('bootstrap adopts availability atomically and preserves explicit zero and debt', async () => {
  server.fundingBalanceFields = { available_micro: 0, available_plan_micro: 0, available_comp_micro: 0, reserved_micro: 30000000, pending_micro: 4000000 };
  await readApp();
  assert.deepEqual(Object.fromEntries(Object.keys(server.fundingBalanceFields).map(field => [field, getAppBootstrap().api_allowance.balance[field]])), server.fundingBalanceFields);
  server.fundingBalanceFields.available_micro = -150001; await readApp();
  assert.equal(getAppBootstrap().api_allowance.balance.available_micro, -150001);
  for (const fields of [{ available_micro: 0 }, { available_micro: 0, available_plan_micro: 0, available_comp_micro: '0' }]) {
    server.fundingBalanceFields = fields; await readApp();
    const balance = getAppBootstrap().api_allowance.balance;
    assert.equal(balance.micro, 34000000);
    for (const field of ['available_micro', 'available_plan_micro', 'available_comp_micro']) assert.equal(Object.hasOwn(balance, field), false);
  }
  for (const invalid of [-1, 0.5, '10', null]) {
    server.fundingBalanceFields = { reserved_micro: invalid }; await assert.rejects(readApp(), InvalidState);
  }
});


test('asynchronous acceptance returns immediately and authoritative polling preserves a stored refusal', async () => {
  enableModelChat(); server.generateAsync = true;
  const accepted = await generateAppChat(await readApp(), 'c1', modelRequest);
  assert.equal(accepted.run.status, 'pending');
  assert.equal(accepted.snapshot.state.chats[0].messages.at(-1)[0], 'you');
  const sent = writes().filter(call => call.path.endsWith('/generate'));
  assert.equal(sent.length, 1); assert.equal(sent[0].headers.get('Prefer'), 'respond-async');
  server.chatRun = { request_id: modelRequest.request_id, status: 'failed', error_code: 'model_refused', stop_details: { type: 'refusal', category: 'synthetic', explanation: 'Stored provider diagnostic', thinking: 'must not be copied' } };
  const checked = await readAppChatRun(accepted.snapshot, 'c1', modelRequest.request_id);
  assert.deepEqual(checked.refusal, { type: 'refusal', category: 'synthetic', explanation: 'Stored provider diagnostic' });
  server.chatRun.status = 'unknown';
  assert.equal((await readAppChatRun(checked.snapshot, 'c1', modelRequest.request_id)).refusal, undefined);
  assert.equal(writes().filter(call => call.path.endsWith('/generate')).length, 1, 'status reads cannot dispatch another paid request');
});
