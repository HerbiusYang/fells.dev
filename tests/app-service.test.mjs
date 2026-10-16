import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readApp, commitApp, endApp, getAppAccount, getAppKeys, getAppMessageMetadata, getAppWorkspaceRole,
  createAppChat, importAppChat, updateAppMessage, deleteAppMessage, listAppMembers, inviteAppMember, updateAppMemberRole, removeAppMember,
  listAppInvitations, acceptAppInvitation, declineAppInvitation, leaveAppWorkspace, listAppPendingInvitations, cancelAppInvitation,
  StaleState, EndedSession } from "../src/lib/app-service.ts";
import { APIError } from "../src/lib/app-http.ts";
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
  // Invitations addressed to the signed-in user, and the owner's outstanding ones.
  inbox: [], pending: [], inviteStatus: 202, joinable: new Map() };
}
function response(value, status = 200) { return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }
function bootstrap() {
  const u = server.users.get(currentUser);
  return { schema_version: 1, session_id: session, user: { id: currentUser, username: u.name.toLowerCase(), name: u.name, email: u.email, joined_at: Math.floor(now / 1000), self_keys: true },
    wallet: { currency: "CNY", cash_micro: 12000000, grant_micro: 2000000, grant_expires_at: 0 },
    api_allowance: { currency: "USD", balance: { micro: 34000000, expires_at: 1820000000 }, term_months: 12, price_cny: 1.3 }, agreement: { accepted: true },
    capabilities: { workspace_storage: true, chat_history: true, agent_execution: false, cloud_computer: false } };
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
  if (path === "/api/app/invitations") return response({ invitations: server.inbox });
  const inviteRoute = path.match(/^\/api\/app\/invitations\/([^/]+)\/(accept|decline)$/);
  if (inviteRoute && method === "POST") {
    const inv = server.inbox.find(i => i.id === inviteRoute[1]);
    if (!inv) return response({ error: "workspace or conversation not found" }, 404);
    server.inbox = server.inbox.filter(i => i !== inv);
    if (inviteRoute[2] === "decline") return response(undefined, 204);
    if (server.inviteStatus === 413) { server.inbox.push(inv); return response({ error: "workspace storage limit reached" }, 413); }
    const ws = { ...server.joinable.get(inv.workspace_id), role: inv.role };
    server.workspaces.push(ws);
    return response({ workspace: ws });
  }
  const pendingRoute = path.match(/^\/api\/app\/workspaces\/([^/]+)\/invitations(?:\/([^/]+))?$/);
  if (pendingRoute) {
    if (method === "DELETE") { const before = server.pending.length; server.pending = server.pending.filter(p => p.id !== pendingRoute[2]); return before === server.pending.length ? response({ error: "workspace or conversation not found" }, 404) : response(undefined, 204); }
    return response({ invitations: server.pending });
  }
  const leaveRoute = path.match(/^\/api\/app\/workspaces\/([^/]+)\/leave$/);
  if (leaveRoute && method === "POST") {
    const w = server.workspaces.find(w => w.id === leaveRoute[1]);
    if (!w) return response({ error: "workspace or conversation not found" }, 404);
    if (w.role === "owner") return response({ error: "owner membership cannot be changed" }, 400);
    server.workspaces = server.workspaces.filter(x => x !== w); server.chats = server.chats.filter(c => c.ws !== w.id);
    return response(undefined, 204);
  }
  const nested = path.match(/^\/api\/app\/workspaces\/([^/]+)(?:\/(chats(?:\/import)?|members)(?:\/(\d+))?)?$/);
  if (nested) {
    const [, wid, action, memberID] = nested;
    if (action === "chats") return response({ chats: server.chats.filter(c => c.ws === wid) });
    if (action === "chats/import") return addChat({ ...body, ws: wid }, true);
    if (action === "members") {
      if (method === "POST") {
        // Consent-based: the same 202 for any identifier; nobody joins here.
        if (server.inviteStatus === 429) return response({ error: "too many pending invitations" }, 429);
        server.pending.push({ id: `00000000-0000-4000-8000-00000000000${server.pending.length + 1}`, label: body.username ? body.username[0] + "***" : `#${body.user_id}`, role: body.role, created: now, expires: now + 14 * 864e5 });
        return response({ invitation: server.inviteBody ?? { status: "pending", role: body.role } }, 202);
      }
      if (method === "PATCH") {
        const m = server.members.find(m => m.user_id === Number(memberID));
        if (!m) return response({ error: "workspace or conversation not found" }, 404);
        m.role = body.role; return response({ member: { user_id: m.user_id, role: m.role } });
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

test("member invitations are consent based: 202 pending for any identifier, nobody is added, nonowners cannot invite",async()=>{
  await readApp(); assert.deepEqual((await listAppMembers("w1")).map(m=>m.name),["Alice","Bob"]);
  const membersBefore=structuredClone(server.members);
  for (const username of ["bob","nobody-at-all","someone@example.invalid"]) {
    assert.deepEqual(await inviteAppMember("w1",{username,role:"viewer"}),{status:"pending",role:"viewer"});
    assert.deepEqual(writes().at(-1).body,{username,role:"viewer"});
  }
  assert.deepEqual(await inviteAppMember("w1",{user_id:9,role:"editor"}),{status:"pending",role:"editor"});
  assert.deepEqual(writes().at(-1).body,{user_id:9,role:"editor"});
  assert.deepEqual(server.members,membersBefore,"an invitation never adds a member");
  assert.deepEqual((await listAppMembers("w1")).map(m=>[m.user_id,m.role]),[[1,"owner"],[2,"editor"]]);
  const count=writes().length;
  for (const bad of [{role:"viewer"},{username:"x",user_id:2,role:"viewer"},{username:"  ",role:"viewer"},{username:"x",role:"owner"},{user_id:0,role:"viewer"},{username:"a".repeat(255),role:"viewer"}])
    await assert.rejects(inviteAppMember("w1",bad),InvalidState);
  assert.equal(writes().length,count);
  server.workspaces[0].role="viewer";await readApp();
  await assert.rejects(inviteAppMember("w1",{username:"missing",role:"editor"}),InvalidState);
  await assert.rejects(listAppPendingInvitations("w1"),InvalidState);
  await assert.rejects(cancelAppInvitation("w1","00000000-0000-4000-8000-000000000001"),InvalidState);
  assert.equal(writes().length,count);
});

test("invite limits surface as 429 and a non-pending invite response is rejected",async()=>{
  await readApp();
  server.inviteStatus=429;
  await assert.rejects(inviteAppMember("w1",{username:"carol",role:"editor"}),e=>e instanceof APIError&&e.status===429&&/too many pending/.test(e.message));
  server.inviteStatus=202;server.inviteBody={status:"pending",role:"editor"};
  await assert.rejects(inviteAppMember("w1",{username:"carol",role:"viewer"}),InvalidState);
  server.inviteBody={member:{user_id:2}};
  await assert.rejects(inviteAppMember("w1",{username:"carol",role:"viewer"}),InvalidState,"the removed 200 {member} shape is not treated as success");
});

test("owner pending list shows only masked labels and cancel removes one invitation",async()=>{
  await readApp();
  await inviteAppMember("w1",{username:"secret@example.invalid",role:"viewer"});
  await inviteAppMember("w1",{user_id:7,role:"editor"});
  const pending=await listAppPendingInvitations("w1");
  assert.deepEqual(pending.map(p=>[p.label,p.role]),[["s***","viewer"],["#7","editor"]]);
  assert.ok(pending.every(p=>!JSON.stringify(p).includes("secret@")));
  await cancelAppInvitation("w1",pending[0].id);
  assert.deepEqual(writes().at(-1),{...writes().at(-1),method:"DELETE",path:`/api/app/workspaces/w1/invitations/${pending[0].id}`});
  assert.deepEqual((await listAppPendingInvitations("w1")).map(p=>p.label),["#7"]);
  await assert.rejects(cancelAppInvitation("w1",pending[0].id),e=>e instanceof APIError&&e.status===404);
  await assert.rejects(cancelAppInvitation("w1","../members/2"),InvalidState);
  server.pending=[{id:"p1",label:"x",role:"owner",created:now,expires:now}];
  await assert.rejects(listAppPendingInvitations("w1"),InvalidState);
});

const invite=(over={})=>({id:"11111111-1111-4111-8111-111111111111",workspace_id:"w9",workspace_name:"Team <b>docs</b>",role:"editor",inviter_name:"Member #7",created:now,expires:now+864e5,...over});

test("invitee inbox parses DTOs, accept joins and selects the workspace, decline removes the invitation",async()=>{
  server.joinable.set("w9",{id:"w9",name:"Team <b>docs</b>",region:"ap",tz:"UTC",created:now});
  server.inbox=[invite(),invite({id:"22222222-2222-4222-8222-222222222222",workspace_id:"w8",workspace_name:"Other",role:"viewer",inviter_name:"Dana"})];
  let snapshot=await readApp();
  const inbox=await listAppInvitations();
  assert.deepEqual(inbox.map(i=>[i.workspace_name,i.role,i.inviter_name]),[["Team <b>docs</b>","editor","Member #7"],["Other","viewer","Dana"]]);
  assert.equal(getAppWorkspaceRole("w9"),undefined,"a pending invitation grants nothing");
  snapshot=await acceptAppInvitation(inbox[0].id);
  assert.ok(snapshot.state.workspaces.some(w=>w.id==="w9"));
  assert.equal(snapshot.state.current,"w9");assert.equal(getAppWorkspaceRole("w9"),"editor");
  assert.equal((await readApp()).state.current,"w9","the joined workspace stays selected after a fresh read");
  await declineAppInvitation(inbox[1].id);
  assert.deepEqual(writes().at(-1).path,`/api/app/invitations/${inbox[1].id}/decline`);
  assert.deepEqual(await listAppInvitations(),[]);
  assert.ok(!snapshot.state.workspaces.some(w=>w.id==="w8"));
  await assert.rejects(declineAppInvitation(inbox[1].id),e=>e instanceof APIError&&e.status===404);
  await assert.rejects(acceptAppInvitation("bad/id"),InvalidState);
});

test("accepting at a membership limit reports 413 and keeps the invitation",async()=>{
  server.inbox=[invite()];server.inviteStatus=413;
  const snapshot=await readApp();
  await assert.rejects(acceptAppInvitation(invite().id),e=>e instanceof APIError&&e.status===413);
  assert.equal((await listAppInvitations()).length,1);
  assert.equal((await readApp()).state.workspaces.length,snapshot.state.workspaces.length);
});

test("malformed inbox entries are rejected rather than rendered",async()=>{
  await readApp();
  for (const bad of [invite({role:"owner"}),invite({id:"constructor"}),invite({workspace_name:7}),invite({expires:-1}),"x"]) {
    server.inbox=[bad];
    await assert.rejects(listAppInvitations(),InvalidState);
  }
  server.inbox=[invite(),invite()];
  await assert.rejects(listAppInvitations(),InvalidState,"duplicate invitation IDs");
});

test("a member leaves a shared workspace; the owner cannot and nothing is written",async()=>{
  server.workspaces.push({id:"w2",name:"Joined",region:"ap",tz:"UTC",created:now,role:"viewer"});
  let snapshot=await readApp();
  snapshot=await commitApp(snapshot,{...snapshot.state,current:"w2"});
  assert.equal(snapshot.state.current,"w2");
  snapshot=await leaveAppWorkspace("w2");
  assert.deepEqual(writes().at(-1).path,"/api/app/workspaces/w2/leave");
  assert.ok(!snapshot.state.workspaces.some(w=>w.id==="w2"));
  assert.equal(snapshot.state.current,"w1","selection falls back to a remaining workspace");
  assert.equal(getAppWorkspaceRole("w2"),undefined);
  const count=writes().length;
  await assert.rejects(leaveAppWorkspace("w1"),InvalidState);
  await assert.rejects(leaveAppWorkspace("w2"),InvalidState);
  assert.equal(writes().length,count);
});

test("member role change and removal stay owner operations on existing members",async()=>{
  await readApp();
  await updateAppMemberRole("w1",2,"viewer");
  assert.deepEqual(writes().at(-1).body,{role:"viewer"});
  await assert.rejects(updateAppMemberRole("w1",99,"viewer"),e=>e instanceof APIError&&e.status===404,"PATCH never invites a non-member");
  await removeAppMember("w1",2);
  assert.deepEqual((await listAppMembers("w1")).map(m=>m.user_id),[1]);
  server.workspaces[0].role="editor";await readApp();
  const count=writes().length;
  await assert.rejects(updateAppMemberRole("w1",1,"viewer"),InvalidState);
  assert.equal(writes().length,count);
});

test("neutral member labels are kept verbatim as text",async()=>{
  server.members=[{user_id:1,name:"Alice",role:"owner"},{user_id:7,name:"Member #7",role:"viewer"},{user_id:8,name:"<img src=x onerror=1>",role:"editor"}];
  await readApp();
  assert.deepEqual((await listAppMembers("w1")).map(m=>m.name),["Alice","Member #7","<img src=x onerror=1>"]);
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
