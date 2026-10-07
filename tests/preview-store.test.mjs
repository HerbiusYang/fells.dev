import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { indexedDB, IDBObjectStore } from "fake-indexeddb";
import { beginPreview, readPreview, commitPreview, endPreview, StaleState, EndedSession } from "../src/lib/preview-store.ts";

globalThis.indexedDB = indexedDB;
globalThis.localStorage = new Map();
localStorage.removeItem = key => localStorage.delete(key);
beforeEach(async () => { localStorage.clear(); await beginPreview("test@example.invalid", 5); });

test("legacy secrets are removed before starting a clean preview", async () => {
  localStorage.set("fells.app.v1", '{"env":{"old":"dummy-secret"}}');
  localStorage.set("fells.email", "old@example.invalid");
  const next = await beginPreview("new@example.invalid", 5);
  assert.equal(localStorage.size, 0);
  assert.equal(next.state.email, "new@example.invalid");
  assert.deepEqual(next.state.workspaces, []);
});

test("concurrent updates are serialized: one wins and the stale writer must retry", async () => {
  const a = await readPreview(), b = structuredClone(a);
  const results = await Promise.allSettled([
    commitPreview(a, { ...a.state, theme: "dark" }),
    commitPreview(b, { ...b.state, profile: { name: "Second", avatar: 0 } }),
  ]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.ok(results.find(x => x.status === "rejected").reason instanceof StaleState);
  const current = await readPreview();
  await commitPreview(current, { ...current.state, profile: { name: "Second", avatar: 0 } });
  assert.equal((await readPreview()).state.profile.name, "Second");
});

test("a stale theme save cannot resurrect a successfully deleted workspace", async () => {
  let a = await readPreview();
  a = await commitPreview(a, { ...a.state, current: "w", workspaces: [{ id: "w", name: "Demo", region: "us-west", tz: "UTC", created: Date.now() }] });
  const stale = structuredClone(a);
  await commitPreview(a, { ...a.state, current: "", workspaces: [] });
  await assert.rejects(commitPreview(stale, { ...stale.state, theme: "dark" }), StaleState);
  assert.deepEqual((await readPreview()).state.workspaces, []);
});

test("logout revokes all old snapshots and cannot clear a later session", async () => {
  const old = await readPreview();
  await endPreview(old.session);
  assert.equal(await readPreview(), null);
  await assert.rejects(commitPreview(old, old.state), EndedSession);
  const next = await beginPreview("next@example.invalid", 5);
  await endPreview(old.session);
  assert.equal((await readPreview()).session, next.session);
  await assert.rejects(commitPreview(old, old.state), EndedSession);
});

test("write failure preserves the last committed state and deletion can be retried", async () => {
  const before = await readPreview();
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = () => { throw new DOMException("Test quota", "QuotaExceededError"); };
    await assert.rejects(commitPreview(before, { ...before.state, theme: "dark" }), { name: "QuotaExceededError" });
    assert.deepEqual(await readPreview(), before);
    // Logout uses record deletion, not an oversized snapshot put.
    await endPreview(before.session);
    assert.equal(await readPreview(), null);
  } finally { IDBObjectStore.prototype.put = put; }
});

test("account switch racing an old write never mixes the two sessions", async () => {
  const old = await readPreview();
  const [next] = await Promise.all([
    beginPreview("other@example.invalid", 5),
    commitPreview(old, { ...old.state, profile: { name: "Old data", avatar: 0 } }).catch(e => assert.ok(e instanceof EndedSession)),
  ]);
  const current = await readPreview();
  assert.equal(current.session, next.session);
  assert.equal(current.state.profile.name, "");
});

test('a blocked notification API cannot turn a committed write into reported failure', async () => {
  const Original = globalThis.BroadcastChannel;
  try {
    globalThis.BroadcastChannel = class { constructor() { throw new Error('Disabled by browser policy'); } };
    const old = await readPreview();
    const next = await commitPreview(old, { ...old.state, theme: 'dark' });
    assert.equal(next.state.theme, 'dark');
    assert.equal((await readPreview()).revision, next.revision);
    await endPreview(next.session);
    assert.equal(await readPreview(), null);
  } finally { globalThis.BroadcastChannel = Original; }
});
