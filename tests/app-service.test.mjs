import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readApp, commitApp, endApp, getAppAccount, getAppKeys, getAppBootstrap, getAppMessageMetadata, getAppWorkspaceRole,
  createAppChat, importAppChat, updateAppMessage, deleteAppMessage, listAppMembers, setAppMember,
  listAppPendingInvitations, listAppReceivedInvitations, revokeAppInvitation, acceptAppInvitation, declineAppInvitation, leaveAppWorkspace,
  generateAppChat, readAppChatRun,
  StaleState, EndedSession } from "../src/lib/app-service.ts";
import { InvalidState } from "../src/lib/preview-state.ts";

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
    api_allowance: { currency: "USD", balance: { micro: server.allowanceMicro ?? 34000000, expires_at: 1820000000 }, term_months: 12, exchange_policy: { source: "ECB", fee_bp: 10, customer_only: true, fee_included: true }, ...(server.legacyPrice === undefined ? {} : { price_cny: server.legacyPrice }) }, agreement: { accepted: true },
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
    if (server.generateUnauthorized) {
      chat.messages.pop(); chat.message_metadata.pop();
      server.chatRun = { request_id: body.request_id, status: server.generateRunStatus ?? 'unknown', error_code: 'upstream_unauthorized' };
      if (server.generateIdentity === 'expired') currentUser = 0;
      if (server.generateIdentity === 'replacement') session = hash('b');
      if (server.generateIdentity === 'other-user') { currentUser = 2; session = hash('b'); }
      return response({ error: 'Provider authentication failed', run: server.chatRun }, 401);
    }
    if (server.generateNetworkError) throw new TypeError('Response connection lost');
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
  await assert.rejects(setAppMember("w1", { username: "bob", role: "viewer" }), /unexpected response/);
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

for (const legacyPrice of [undefined, 0]) test(`quote-only bootstrap with legacy price ${legacyPrice} keeps balances readable`, async () => {
  server.legacyPrice=legacyPrice;
  const snapshot=await readApp();assert.ok(snapshot);assert.equal(getAppBootstrap().api_allowance.balance.micro,34000000);assert.equal(getAppBootstrap().api_allowance.price_cny,legacyPrice);
});
for (const legacyPrice of [-1, '7.2', null]) test(`an invalid supplied legacy price ${legacyPrice} cannot masquerade as a quote`, async () => {
  server.legacyPrice=legacyPrice;await assert.rejects(readApp(),/Invalid allowance price/);
});

const modelRequest = { request_id: 'b1b404cc-0539-4bb8-a875-a500a63b3a13', body: 'A real model instruction', model: 'scope/text-v2', key_id: 12 };
function enableModelChat() { server.modelChat = true; Object.assign(server.keys[0], { kind: 'user', expires_at: 0 }); }
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
for (const condition of ['disabled', 'viewer', 'cli-key', 'expired-key']) test('generation rejects before spending when ' + condition, async () => {
  enableModelChat();
  if (condition === 'disabled') server.modelChat = false;
  if (condition === 'viewer') server.workspaces[0].role = 'viewer';
  if (condition === 'cli-key') server.keys[0].kind = 'cli';
  if (condition === 'expired-key') server.keys[0].expires_at = 1;
  const snapshot = await readApp(); await assert.rejects(generateAppChat(snapshot, 'c1', modelRequest), InvalidState);
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
