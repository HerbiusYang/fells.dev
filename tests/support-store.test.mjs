import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBObjectStore } from "fake-indexeddb";
import { beginPreview, commitPreview, endPreview, readPreview, PREVIEW_DB } from "../src/lib/preview-store.ts";
import {
  beginSupportSession, endSupportSession, readSupportSession, readSupport, ensureUserConversation,
  sendUserMessage, sendAgentMessage, markUserRead, markAgentRead, setConversationStatus, seedSupportDemo,
  validateSupportConversation, validateSupportImage, InvalidSupportData, SupportSessionEnded, SupportStorageFull,
  MAX_SUPPORT_IMAGE_BYTES, MAX_SUPPORT_TEXT, MAX_SUPPORT_MESSAGES, MAX_SUPPORT_RECORD_BYTES, MAX_SUPPORT_CONVERSATIONS, SUPPORT_CHANNEL,
  readUserTyping, setUserTyping, readAgentTyping, setAgentTyping,
  readSupportAvailability, setAgentAvailability,
} from "../src/lib/support-store.ts";
import { png, jpeg, webp, webpLossless, webpExtended } from "./fixtures/support-images.mjs";

globalThis.indexedDB = indexedDB;
globalThis.localStorage = new Map();
localStorage.removeItem = key => localStorage.delete(key);
const image = { name: "sample.png", type: "image/png", dataUrl: `data:image/png;base64,${png.toString("base64")}`, size: png.length };
let snapshot;

async function writeRecord(key, value) {
  const request = indexedDB.open(PREVIEW_DB, 1);
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("preview", "readwrite");
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      tx.objectStore("preview").put(value, key);
    });
  } finally { db.close(); }
}

beforeEach(async () => {
  localStorage.clear();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PREVIEW_DB);
    request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Test database blocked"));
  });
  snapshot = await beginPreview("customer@example.invalid", 5);
});

test("customer conversation uses current preview metadata and strips untrusted fields", async () => {
  const old = snapshot;
  snapshot = await commitPreview(snapshot, { ...snapshot.state, profile: { name: "Customer", avatar: 0 }, credits: { bonus: 5, period: 10, never: 2 } });
  const conversation = await ensureUserConversation({ ...old, state: { ...old.state, email: "forged@example.invalid" } }, "zh-CN");
  assert.equal(conversation.user.name, "Customer");
  assert.equal(conversation.user.email, "customer@example.invalid");
  assert.equal(conversation.user.credits, 17);
  assert.equal(conversation.user.locale, "zh-CN");
  assert.equal(conversation.demo, false);
  const clean = validateSupportConversation({ ...conversation, password: "discard", user: { ...conversation.user, token: "discard" }, messages: [{ id: "m1", sender: "user", text: "hello", created: Date.now(), unsafe: "discard", image: { ...image, html: "discard" } }] });
  assert.equal("password" in clean, false);
  assert.equal("token" in clean.user, false);
  assert.equal("unsafe" in clean.messages[0], false);
  assert.equal("html" in clean.messages[0].image, false);
});

test("a default customer profile receives a useful display name", async () => {
  assert.equal((await ensureUserConversation(snapshot, "en")).user.name, "customer");
  const empty = await beginPreview("", 5);
  assert.equal((await ensureUserConversation(empty, "en")).user.name, "Customer");
});

test("text and raster image messages, agent replies, reads, and resolution persist", async () => {
  let conversation = await ensureUserConversation(snapshot, "en");
  conversation = await sendUserMessage(snapshot.session, "Please help", image);
  assert.equal(conversation.messages[0].sender, "user");
  assert.deepEqual(conversation.messages[0].image, image);
  const agent = await beginSupportSession("Support", "support@example.invalid");
  await markAgentRead(agent.session, conversation.id);
  conversation = await sendAgentMessage(agent.session, conversation.id, "Happy to help");
  await markUserRead(snapshot.session);
  await setConversationStatus(agent.session, conversation.id, "resolved");
  const [saved] = await readSupport();
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].sender, "agent");
  assert.equal(saved.agentReadAt, saved.messages[0].created);
  assert.equal(saved.userReadAt, saved.messages[1].created);
  assert.equal(saved.status, "resolved");
  assert.equal((await sendUserMessage(snapshot.session, "One more thing")).status, "open");
});

test("typing leases are shared by role and page, and never create messages or read receipts", async () => {
  const conversation = await ensureUserConversation(snapshot, "zh");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  await setUserTyping(snapshot.session, true, first);
  await setUserTyping(snapshot.session, true, second);
  assert.equal(await readAgentTyping(operator.session, conversation.id), true);
  assert.equal(await readUserTyping(snapshot.session), false);
  await setUserTyping(snapshot.session, false, first);
  assert.equal(await readAgentTyping(operator.session, conversation.id), true, "another page still has a lease");
  await setUserTyping(snapshot.session, false, second);
  assert.equal(await readAgentTyping(operator.session, conversation.id), false);
  await setAgentTyping(operator.session, conversation.id, true, first);
  assert.equal(await readUserTyping(snapshot.session), true);
  assert.deepEqual(await ensureUserConversation(snapshot, "zh"), conversation);
});

test("typing expires after five seconds and cannot leak into another customer or agent session", async t => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const source = crypto.randomUUID();
  await setUserTyping(snapshot.session, true, source);
  await setAgentTyping(operator.session, conversation.id, true, source);
  clock += 5001;
  assert.equal(await readUserTyping(snapshot.session), false);
  assert.equal(await readAgentTyping(operator.session, conversation.id), false);
  await setAgentTyping(operator.session, conversation.id, true, source);
  const newer = await beginSupportSession("Another", "another@example.invalid");
  assert.equal(await readUserTyping(snapshot.session), false, "a replaced operator's lease is hidden");
  await assert.rejects(setAgentTyping(operator.session, conversation.id, true, source), SupportSessionEnded);
  const nextCustomer = await beginPreview("next@example.invalid", 5);
  const nextConversation = await ensureUserConversation(nextCustomer, "en");
  assert.equal(await readUserTyping(nextCustomer.session), false);
  assert.equal(await readAgentTyping(newer.session, nextConversation.id), false);
  await assert.rejects(setUserTyping(snapshot.session, true, source), SupportSessionEnded);
});

test("sending and resolving atomically clear typing, including a quick reopen", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const source = crypto.randomUUID();
  await setUserTyping(snapshot.session, true, source);
  await assert.rejects(sendUserMessage(snapshot.session, " "), InvalidSupportData);
  assert.equal(await readAgentTyping(operator.session, conversation.id), true, "failed sends retain presence until its lease expires");
  await sendUserMessage(snapshot.session, "Question");
  assert.equal(await readAgentTyping(operator.session, conversation.id), false);
  await setAgentTyping(operator.session, conversation.id, true, source);
  await sendAgentMessage(operator.session, conversation.id, "Reply");
  assert.equal(await readUserTyping(snapshot.session), false);
  await setUserTyping(snapshot.session, true, source);
  await setAgentTyping(operator.session, conversation.id, true, source);
  await setConversationStatus(operator.session, conversation.id, "resolved");
  await setConversationStatus(operator.session, conversation.id, "open");
  assert.equal(await readUserTyping(snapshot.session), false);
  assert.equal(await readAgentTyping(operator.session, conversation.id), false);
});

test("typing validates roles and sources, and excludes other conversations", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const source = crypto.randomUUID();
  await seedSupportDemo(operator.session);
  await setUserTyping(snapshot.session, true, source);
  assert.equal(await readAgentTyping(operator.session, "demo-alex"), false);
  for (const operation of [
    () => setUserTyping(operator.session, true, source),
    () => readUserTyping(operator.session),
    () => setAgentTyping(snapshot.session, conversation.id, true, source),
    () => readAgentTyping(snapshot.session, conversation.id),
  ]) await assert.rejects(operation(), SupportSessionEnded);
  for (const operation of [
    () => setUserTyping(snapshot.session, "true", source),
    () => setUserTyping(snapshot.session, true, "../another"),
    () => setAgentTyping(operator.session, "__proto__", true, source),
  ]) await assert.rejects(async () => operation(), InvalidSupportData);
  assert.equal(await readAgentTyping(operator.session, conversation.id), true);
});

test("typing leases bound the number of pages and reject malformed stored values", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const sources = Array.from({ length: 17 }, () => crypto.randomUUID());
  for (const source of sources.slice(0, 16)) await setUserTyping(snapshot.session, true, source);
  await assert.rejects(setUserTyping(snapshot.session, true, sources[16]), InvalidSupportData);
  await setUserTyping(snapshot.session, false, sources[0]);
  await setUserTyping(snapshot.session, true, sources[16]);
  assert.equal(await readAgentTyping(operator.session, conversation.id), true);
  await writeRecord(`support.typing.user.${conversation.id}`, { session: snapshot.session, sources: [{ id: sources[0], expires: Infinity }] });
  await assert.rejects(readAgentTyping(operator.session, conversation.id), InvalidSupportData);
});

test("support availability requires an operator heartbeat and works before a customer opens chat", async () => {
  assert.equal(await readSupportAvailability(snapshot.session), false);
  const operator = await beginSupportSession("Support", "support@example.invalid");
  assert.equal(await readSupportAvailability(snapshot.session), false, "a login alone does not imply an open desk");
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  await setAgentAvailability(operator.session, true, first);
  assert.equal(await readSupportAvailability(snapshot.session), true);
  await setAgentAvailability(operator.session, true, second);
  await setAgentAvailability(operator.session, false, first);
  assert.equal(await readSupportAvailability(snapshot.session), true, "closing one desk does not remove another desk's heartbeat");
  await setAgentAvailability(operator.session, false, second);
  assert.equal(await readSupportAvailability(snapshot.session), false);
  assert.equal((await ensureUserConversation(snapshot, "en")).messages.length, 0);
});

test("availability expires at forty-five seconds and renewals preserve chat and read state", async t => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid"), source = crypto.randomUUID();
  await setAgentAvailability(operator.session, true, source);
  clock += 44_999;
  assert.equal(await readSupportAvailability(snapshot.session), true);
  await setAgentAvailability(operator.session, true, source);
  clock += 44_999;
  assert.equal(await readSupportAvailability(snapshot.session), true);
  clock++;
  assert.equal(await readSupportAvailability(snapshot.session), false);
  assert.deepEqual(await ensureUserConversation(snapshot, "en"), conversation);
});

test("customer logout does not end operator availability; stale operator logouts cannot clear the new desk", async () => {
  const old = await beginSupportSession("Support", "support@example.invalid"), source = crypto.randomUUID();
  await setAgentAvailability(old.session, true, source);
  await endPreview(snapshot.session);
  await assert.rejects(readSupportAvailability(snapshot.session), SupportSessionEnded);
  const nextCustomer = await beginPreview("next@example.invalid", 5);
  assert.equal(await readSupportAvailability(nextCustomer.session), true);
  const current = await beginSupportSession("Next support", "next-support@example.invalid");
  assert.equal(await readSupportAvailability(nextCustomer.session), false, "operator replacement removes the old heartbeat");
  await setAgentAvailability(current.session, true, source);
  await endSupportSession(old.session);
  assert.equal(await readSupportAvailability(nextCustomer.session), true);
  await assert.rejects(setAgentAvailability(old.session, true, source), SupportSessionEnded);
  await assert.rejects(setAgentAvailability(old.session, false, source), SupportSessionEnded);
  await endSupportSession(current.session);
  assert.equal(await readSupportAvailability(nextCustomer.session), false);
});

test("availability rejects wrong-role sessions and untrusted online/source values without changing the valid lease", async () => {
  const operator = await beginSupportSession("Support", "support@example.invalid"), source = crypto.randomUUID();
  await setAgentAvailability(operator.session, true, source);
  for (const operation of [
    () => readSupportAvailability(operator.session),
    () => readSupportAvailability(crypto.randomUUID()),
    () => setAgentAvailability(snapshot.session, true, source),
    () => setAgentAvailability(crypto.randomUUID(), true, source),
  ]) await assert.rejects(operation(), SupportSessionEnded);
  for (const [online, id] of [["true", source], [1, source], [{ role: "agent" }, source], [true, "../another"], [false, "__proto__"]]) {
    await assert.rejects(async () => setAgentAvailability(operator.session, online, id), InvalidSupportData);
  }
  assert.equal(await readSupportAvailability(snapshot.session), true);
});

test("availability bounds desk pages, permits a full lease renewal, and rejects malformed stored leases", async () => {
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const sources = Array.from({ length: 17 }, () => crypto.randomUUID());
  for (const source of sources.slice(0, 16)) await setAgentAvailability(operator.session, true, source);
  await setAgentAvailability(operator.session, true, sources[0]);
  await assert.rejects(setAgentAvailability(operator.session, true, sources[16]), InvalidSupportData);
  await setAgentAvailability(operator.session, false, sources[0]);
  await setAgentAvailability(operator.session, true, sources[16]);
  assert.equal(await readSupportAvailability(snapshot.session), true);
  for (const invalid of [
    { session: operator.session, sources: new Array(1) },
    { session: operator.session, sources: [{ id: sources[0], expires: Infinity }] },
    { session: operator.session, sources: Array.from({ length: 2 }, () => ({ id: sources[0], expires: Date.now() + 1000 })) },
    { session: "constructor", sources: [] },
    { session: operator.session, sources: "true" },
  ]) {
    await writeRecord("support.availability.agent", invalid);
    await assert.rejects(readSupportAvailability(snapshot.session), InvalidSupportData);
    await assert.rejects(setAgentAvailability(operator.session, true, sources[0]), InvalidSupportData);
  }
  const next = await beginSupportSession("Recovered", "recovered@example.invalid");
  assert.equal(await readSupportAvailability(snapshot.session), false, "a new login can recover from a corrupt lease");
  await setAgentAvailability(next.session, true, sources[0]);
  assert.equal(await readSupportAvailability(snapshot.session), true);
});

test("availability quota failure preserves the previous heartbeat and operator logout needs no put", async () => {
  const operator = await beginSupportSession("Support", "support@example.invalid"), source = crypto.randomUUID();
  await setAgentAvailability(operator.session, true, source);
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = () => { throw new DOMException("Test quota", "QuotaExceededError"); };
    await assert.rejects(setAgentAvailability(operator.session, true, crypto.randomUUID()), SupportStorageFull);
    assert.equal(await readSupportAvailability(snapshot.session), true);
    await endSupportSession(operator.session);
    assert.equal(await readSupportAvailability(snapshot.session), false);
  } finally { IDBObjectStore.prototype.put = put; }
});

test("corrupt sparse message, demo and typing arrays fail at the storage boundary", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  await writeRecord("support.user", { ...conversation, messages: new Array(1) });
  await assert.rejects(ensureUserConversation(snapshot, "en"), InvalidSupportData);
  await assert.rejects(sendAgentMessage(operator.session, conversation.id, "Reply to invalid history"), InvalidSupportData);
  await writeRecord("support.user", conversation);
  await writeRecord("support.demo", new Array(1));
  await assert.rejects(readSupport(operator.session), InvalidSupportData);
  await writeRecord("support.demo", []);
  await writeRecord(`support.typing.user.${conversation.id}`, { session: snapshot.session, sources: new Array(1) });
  await assert.rejects(readAgentTyping(operator.session, conversation.id), InvalidSupportData);
  assert.deepEqual(await ensureUserConversation(snapshot, "en"), conversation);
});

test("out-of-order history and forged future read cursors cannot bypass receipt validation", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const first = { id: "first", sender: "agent", text: "First", created: 100 };
  const second = { id: "second", sender: "agent", text: "Second", created: 101 };
  const valid = { ...conversation, messages: [first, second], userReadAt: first.created };
  assert.deepEqual(validateSupportConversation(valid), valid);
  for (const invalid of [
    { ...valid, messages: [second, first] },
    { ...valid, messages: [first, { ...second, created: first.created }] },
    { ...valid, userReadAt: second.created + 1 },
    { ...valid, agentReadAt: 8.64e15 },
    { ...conversation, userReadAt: 1 },
  ]) {
    assert.throws(() => validateSupportConversation(invalid), InvalidSupportData);
    await writeRecord("support.user", invalid);
    await assert.rejects(markUserRead(snapshot.session), InvalidSupportData);
    await assert.rejects(sendUserMessage(snapshot.session, "New message cannot legitimize the invalid record"), InvalidSupportData);
  }
  await writeRecord("support.user", valid);
  await markUserRead(snapshot.session, first.created);
  assert.equal((await ensureUserConversation(snapshot, "en")).userReadAt, first.created);
});

test("the board conversation cap includes the live customer as well as demo records", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const demos = Array.from({ length: MAX_SUPPORT_CONVERSATIONS }, (_, index) => ({ ...conversation, id: `demo-${index}`, user: { ...conversation.user, id: `demo-${index}` }, demo: true }));
  await writeRecord("support.demo", demos.slice(0, -1));
  assert.equal((await readSupport(operator.session)).length, MAX_SUPPORT_CONVERSATIONS);
  await writeRecord("support.demo", demos);
  await assert.rejects(readSupport(operator.session), SupportStorageFull);
  await assert.rejects(sendUserMessage(snapshot.session, "Past capacity"), SupportStorageFull);
  await writeRecord("support.demo", demos.slice(0, -1));
  assert.equal((await ensureUserConversation(snapshot, "en")).messages.length, 0);
});

test("reject empty, oversized, malformed, mismatched, and SVG messages", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  await assert.rejects(sendUserMessage(snapshot.session, " "), InvalidSupportData);
  await assert.rejects(sendUserMessage(snapshot.session, "x".repeat(MAX_SUPPORT_TEXT + 1)), InvalidSupportData);
  const invalidImages = [
    { ...image, type: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    { ...image, type: "image/jpeg" },
    { ...image, size: image.size + 1 },
    { ...image, size: MAX_SUPPORT_IMAGE_BYTES + 1 },
    { ...image, dataUrl: "data:image/png;base64,not base64" },
    { ...image, dataUrl: "data:image/png;base64,PHN2Zz48L3N2Zz4=", size: 11 },
    { ...image, name: "bad\u0000.png" },
  ];
  for (const invalid of invalidImages) await assert.rejects(sendUserMessage(snapshot.session, "", invalid), InvalidSupportData);
  for (const invalid of [{ ...conversation, id: "__proto__" }, { ...conversation, user: { ...conversation.user, id: "constructor" } }, { ...conversation, status: "evil" }, { ...conversation, userReadAt: Infinity }]) {
    assert.throws(() => validateSupportConversation(invalid), InvalidSupportData);
  }
  assert.equal((await ensureUserConversation(snapshot, "en")).messages.length, 0);
});

test("real JPEG and WebP images are allowed; noncanonical base64 is rejected", () => {
  for (const [type, data] of [["image/jpeg", jpeg], ["image/webp", webp], ["image/webp", webpLossless], ["image/webp", webpExtended]]) {
    assert.equal(validateSupportImage({ name: "image", type, dataUrl: `data:${type};base64,${data.toString("base64")}`, size: data.length }).type, type);
  }
  assert.throws(() => validateSupportImage({ ...image, dataUrl: image.dataUrl + "=" }), InvalidSupportData);
});

test("image metadata preflight protects writes and stored reads from truncated or huge headers", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const zero = Buffer.from(png), huge = Buffer.from(png), wrongType = Buffer.from(jpeg);
  zero.writeUInt32BE(0, 16);
  huge.writeUInt32BE(6000, 16); huge.writeUInt32BE(6000, 20);
  for (const data of [png.subarray(0, 8), zero, huge, wrongType]) {
    const invalid = { ...image, size: data.length, dataUrl: `data:image/png;base64,${data.toString("base64")}` };
    assert.throws(() => validateSupportImage(invalid), InvalidSupportData);
    await assert.rejects(sendUserMessage(snapshot.session, "", invalid), InvalidSupportData);
    const poisoned = { ...conversation, messages: [{ id: "bad-image", sender: "user", text: "", image: invalid, created: 1 }] };
    await writeRecord("support.user", poisoned);
    await assert.rejects(ensureUserConversation(snapshot, "en"), InvalidSupportData);
    await writeRecord("support.user", conversation);
  }
  assert.deepEqual(await ensureUserConversation(snapshot, "en"), conversation);
});

test("atomic concurrent appends retain all customer and agent messages", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const agent = await beginSupportSession("Support", "support@example.invalid");
  await Promise.all(Array.from({ length: 30 }, (_, n) => n % 2
    ? sendAgentMessage(agent.session, conversation.id, `Agent ${n}`)
    : sendUserMessage(snapshot.session, `Customer ${n}`)));
  const [saved] = await readSupport();
  assert.equal(saved.messages.length, 30);
  assert.equal(new Set(saved.messages.map(m => m.id)).size, 30);
  assert.equal(new Set(saved.messages.map(m => m.text)).size, 30);
  assert.ok(saved.messages.every((m, n) => !n || m.created > saved.messages[n - 1].created));
});

test("forged and wrong-role sessions cannot act on customer or other conversations", async () => {
  const mine = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  await seedSupportDemo(operator.session);
  const before = await readSupport(operator.session);
  const other = before.find(conversation => conversation.demo);
  const forged = "00000000-0000-4000-8000-000000000000";
  for (const action of [
    () => sendUserMessage(forged, "Forged customer session"),
    () => sendUserMessage(operator.session, "Agent token used as customer"),
    () => ensureUserConversation({ ...snapshot, session: operator.session, role: "user" }, "en"),
    () => sendAgentMessage(snapshot.session, mine.id, "Customer impersonating an agent"),
    () => sendAgentMessage(snapshot.session, other.id, "Customer targeting another conversation"),
    () => setConversationStatus(snapshot.session, other.id, "resolved"),
    () => readSupport(snapshot.session),
    () => sendAgentMessage(forged, mine.id, "Forged agent session"),
    () => sendAgentMessage({ session: operator.session, role: "agent" }, mine.id, "Object claiming a role"),
  ]) await assert.rejects(action(), SupportSessionEnded);
  assert.deepEqual(await readSupport(operator.session), before);
});

test("message commands and prototype fields cannot override sender, recipient, or persisted fields", async () => {
  const mine = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  await seedSupportDemo(operator.session);
  const other = (await readSupport(operator.session)).find(conversation => conversation.demo);
  const injected = JSON.parse('{"__proto__":{"polluted":"chat-attack"},"constructor":{"prototype":{"polluted":"chat-attack"}},"role":"agent","sender":"agent","conversationId":"other-user"}');
  await assert.rejects(sendUserMessage(snapshot.session, { ...injected, text: "Object message" }), InvalidSupportData);
  const saved = await sendUserMessage(snapshot.session, JSON.stringify({ ...injected, conversationId: other.id }), { ...image, ...injected }, { ...injected, conversationId: other.id });
  assert.equal(saved.id, mine.id);
  assert.equal(saved.messages[0].sender, "user");
  assert.deepEqual(saved.messages[0].image, image);
  assert.equal((await readSupport(operator.session)).find(conversation => conversation.id === other.id).messages.length, other.messages.length);
  const clean = validateSupportConversation({ ...saved, ...injected, user: { ...saved.user, ...injected }, messages: [{ ...saved.messages[0], ...injected, sender: "user" }] });
  for (const value of [clean, clean.user, clean.messages[0], clean.messages[0].image]) {
    for (const key of ["__proto__", "constructor", "role", "conversationId", "polluted"]) assert.equal(Object.hasOwn(value, key), false);
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test("malicious and duplicate message identifiers are rejected at the chat data boundary", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const valid = { id: "message-one", sender: "user", text: "Message", created: Date.now() };
  for (const malicious of ["__proto__", "constructor", "prototype", "../another", "<svg>", "message-one\n", "", "m".repeat(65)]) {
    assert.throws(() => validateSupportConversation({ ...conversation, messages: [{ ...valid, id: malicious }] }), InvalidSupportData, `Reject message ID ${JSON.stringify(malicious)}`);
  }
  assert.throws(() => validateSupportConversation({ ...conversation, messages: [valid, { ...valid, text: "Duplicate identifier" }] }), InvalidSupportData);
  assert.deepEqual((await ensureUserConversation(snapshot, "en")).messages, []);
});

test("concurrent message flooding stops at 200 messages and preserves committed history", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const operator = await beginSupportSession("Support", "support@example.invalid");
  const anchor = (await sendUserMessage(snapshot.session, "Committed before the flood")).messages[0];
  const attempts = await Promise.allSettled(Array.from({ length: MAX_SUPPORT_MESSAGES + 24 }, (_, index) => index % 2
    ? sendAgentMessage(operator.session, conversation.id, `Flood agent ${index}`)
    : sendUserMessage(snapshot.session, `Flood customer ${index}`)));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, MAX_SUPPORT_MESSAGES - 1);
  const refused = attempts.filter(result => result.status === "rejected");
  assert.equal(refused.length, 25);
  assert.ok(refused.every(result => result.reason instanceof SupportStorageFull));
  const [full] = await readSupport(operator.session);
  assert.equal(full.messages.length, MAX_SUPPORT_MESSAGES);
  assert.deepEqual(full.messages[0], anchor);
  assert.equal(new Set(full.messages.map(message => message.id)).size, MAX_SUPPORT_MESSAGES);
  assert.equal(new Set(full.messages.map(message => message.text)).size, MAX_SUPPORT_MESSAGES);
  assert.ok(full.messages.every((message, index) => !index || message.created > full.messages[index - 1].created));
  await assert.rejects(sendUserMessage(snapshot.session, "Overflow after flood", image), SupportStorageFull);
  await assert.rejects(sendAgentMessage(operator.session, conversation.id, "Overflow reply after flood"), SupportStorageFull);
  assert.deepEqual((await readSupport(operator.session))[0], full);
});

test("read receipts acknowledge rendered messages and leave later arrivals unread", async () => {
  let conversation = await ensureUserConversation(snapshot, "en");
  const agent = await beginSupportSession("Support", "support@example.invalid");
  conversation = await sendUserMessage(snapshot.session, "Rendered customer message");
  const renderedUserTime = conversation.messages.at(-1).created;
  conversation = await sendUserMessage(snapshot.session, "Customer message arriving afterward");
  await markAgentRead(agent.session, conversation.id, renderedUserTime);
  assert.equal((await readSupport())[0].agentReadAt, renderedUserTime);
  conversation = await sendAgentMessage(agent.session, conversation.id, "Rendered agent message");
  const renderedAgentTime = conversation.messages.at(-1).created;
  await sendAgentMessage(agent.session, conversation.id, "Agent message arriving afterward");
  await markUserRead(snapshot.session, renderedAgentTime);
  const current = (await readSupport())[0];
  assert.equal(current.userReadAt, renderedAgentTime);
  assert.ok(current.messages.at(-1).created > current.userReadAt);
  await assert.rejects(markUserRead(snapshot.session, Infinity), InvalidSupportData);
  await assert.rejects(markAgentRead(agent.session, conversation.id, -1), InvalidSupportData);
});

test("logout and account switch revoke customer writes and remove private customer data", async () => {
  const old = snapshot, agent = await beginSupportSession("Support", "support@example.invalid");
  const conversation = await ensureUserConversation(old, "en");
  await sendUserMessage(old.session, "Private previous customer text", image);
  await seedSupportDemo(agent.session);
  await endPreview(old.session);
  await assert.rejects(sendUserMessage(old.session, "stale"), SupportSessionEnded);
  await assert.rejects(markUserRead(old.session), SupportSessionEnded);
  await assert.rejects(ensureUserConversation(old, "en"), SupportSessionEnded);
  await assert.rejects(sendAgentMessage(agent.session, conversation.id, "stale reply"), InvalidSupportData);
  assert.ok((await readSupport()).every(c => c.demo));
  const next = await beginPreview("next@example.invalid", 5);
  await ensureUserConversation(next, "en");
  await endPreview(old.session);
  await assert.rejects(sendUserMessage(old.session, "old tab"), SupportSessionEnded);
  const board = await readSupport();
  assert.equal(board.filter(c => !c.demo).length, 1);
  assert.equal(board.find(c => !c.demo).user.email, "next@example.invalid");
  assert.equal(JSON.stringify(board).includes("Private previous customer"), false);
  assert.equal((await readPreview()).session, next.session);
});

test("account switch racing customer send cannot mix the sessions", async () => {
  const old = snapshot;
  await ensureUserConversation(old, "en");
  const [next] = await Promise.all([
    beginPreview("next@example.invalid", 5),
    sendUserMessage(old.session, "old message").catch(error => assert.ok(error instanceof SupportSessionEnded)),
  ]);
  const current = await ensureUserConversation(next, "en");
  assert.equal(current.user.email, "next@example.invalid");
  assert.deepEqual(current.messages, []);
});

test("support logout and session replacement revoke every old agent mutation", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const old = await beginSupportSession("First", "first@example.invalid");
  await endSupportSession(old.session);
  assert.equal(await readSupportSession(), null);
  assert.deepEqual(await readSupport(), []);
  const next = await beginSupportSession("Second", "second@example.invalid");
  await endSupportSession(old.session);
  assert.equal((await readSupportSession()).session, next.session);
  for (const action of [
    () => sendAgentMessage(old.session, conversation.id, "revoked"),
    () => markAgentRead(old.session, conversation.id),
    () => setConversationStatus(old.session, conversation.id, "resolved"),
    () => seedSupportDemo(old.session),
  ]) await assert.rejects(action(), SupportSessionEnded);
  assert.equal((await readSupport())[0].messages.length, 0);
});

test("support session switch racing an old reply never authorizes a stale agent", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const old = await beginSupportSession("First", "first@example.invalid");
  const [next] = await Promise.all([
    beginSupportSession("Second", "second@example.invalid"),
    sendAgentMessage(old.session, conversation.id, "old reply").catch(error => assert.ok(error instanceof SupportSessionEnded)),
  ]);
  assert.equal((await readSupportSession()).session, next.session);
  await assert.rejects(sendAgentMessage(old.session, conversation.id, "stale"), SupportSessionEnded);
});

test("board read checks the displayed agent session in the same read transaction", async () => {
  await ensureUserConversation(snapshot, "en");
  const old = await beginSupportSession("First", "first@example.invalid");
  assert.equal((await readSupport(old.session)).length, 1);
  const [next, staleRead] = await Promise.all([
    beginSupportSession("Second", "second@example.invalid"),
    readSupport(old.session).catch(error => error),
  ]);
  assert.ok(staleRead instanceof SupportSessionEnded);
  assert.equal((await readSupport(next.session)).length, 1);
  await endSupportSession(next.session);
  await assert.rejects(readSupport(next.session), SupportSessionEnded);
});

test("quota failure preserves committed messages and customer logout does not use puts", async () => {
  await ensureUserConversation(snapshot, "en");
  const before = await sendUserMessage(snapshot.session, "Committed");
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = () => { throw new DOMException("Test quota", "QuotaExceededError"); };
    await assert.rejects(sendUserMessage(snapshot.session, "Not committed", image), SupportStorageFull);
    assert.deepEqual(await ensureUserConversation(snapshot, "en"), before);
    await endPreview(snapshot.session);
    assert.equal(await readPreview(), null);
  } finally { IDBObjectStore.prototype.put = put; }
});

test("failed account switch rolls back customer cleanup together with preview replacement", async () => {
  await ensureUserConversation(snapshot, "en");
  const before = await sendUserMessage(snapshot.session, "Retained if switch fails");
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = () => { throw new DOMException("Test quota", "QuotaExceededError"); };
    await assert.rejects(beginPreview("next@example.invalid", 5), { name: "QuotaExceededError" });
    assert.equal((await readPreview()).session, snapshot.session);
    assert.deepEqual(await ensureUserConversation(snapshot, "en"), before);
  } finally { IDBObjectStore.prototype.put = put; }
});

test("message and byte limits reject additions without corrupting persisted data", async () => {
  const conversation = await ensureUserConversation(snapshot, "en");
  const full = { ...conversation, messages: Array.from({ length: MAX_SUPPORT_MESSAGES }, (_, n) => ({ id: `m-${n}`, sender: "user", text: "Message", created: n + 1 })) };
  await writeRecord("support.user", full);
  await assert.rejects(sendUserMessage(snapshot.session, "Too many"), SupportStorageFull);
  assert.equal((await ensureUserConversation(snapshot, "en")).messages.length, MAX_SUPPORT_MESSAGES);
  const largeData = Buffer.alloc(MAX_SUPPORT_IMAGE_BYTES);
  png.copy(largeData);
  const largeImage = { ...image, size: largeData.length, dataUrl: `data:image/png;base64,${largeData.toString("base64")}` };
  assert.ok(new TextEncoder().encode(JSON.stringify(largeImage)).byteLength < MAX_SUPPORT_RECORD_BYTES);
  const oversized = { ...conversation, messages: Array.from({ length: 4 }, (_, n) => ({ id: `large-${n}`, sender: "user", text: "", image: largeImage, created: n + 1 })) };
  assert.throws(() => validateSupportConversation(oversized), SupportStorageFull);
});

test("refresh and repeated read receipts do not emit unnecessary notifications", async () => {
  const original = globalThis.BroadcastChannel;
  const notifications = [];
  try {
    globalThis.BroadcastChannel = class { constructor(name) { this.name = name; } postMessage(value) { notifications.push([this.name, value]); } close() {} };
    const conversation = await ensureUserConversation(snapshot, "en");
    const agent = await beginSupportSession("Support", "support@example.invalid");
    await sendUserMessage(snapshot.session, "hello");
    await markAgentRead(agent.session, conversation.id);
    await sendAgentMessage(agent.session, conversation.id, "reply");
    await markUserRead(snapshot.session);
    const count = notifications.filter(([name]) => name === SUPPORT_CHANNEL).length;
    await ensureUserConversation(snapshot, "en");
    await markUserRead(snapshot.session);
    await markAgentRead(agent.session, conversation.id);
    await setConversationStatus(agent.session, conversation.id, "open");
    await readSupport();
    assert.equal(notifications.filter(([name]) => name === SUPPORT_CHANNEL).length, count);
  } finally { globalThis.BroadcastChannel = original; }
});

test("blocked notifications cannot turn a committed support send into a failure", async () => {
  const original = globalThis.BroadcastChannel;
  try {
    globalThis.BroadcastChannel = class { constructor() { throw new Error("Disabled"); } };
    await ensureUserConversation(snapshot, "en");
    await sendUserMessage(snapshot.session, "Saved despite blocked channel");
    assert.equal((await ensureUserConversation(snapshot, "en")).messages[0].text, "Saved despite blocked channel");
  } finally { globalThis.BroadcastChannel = original; }
});
