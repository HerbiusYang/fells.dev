import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBObjectStore } from 'fake-indexeddb';
import { freshState, validateState, InvalidState, StateTooLarge, MAX_MESSAGE, MAX_STATE_BYTES } from '../src/lib/preview-state.ts';
import { beginPreview, readPreview, commitPreview, endPreview, PREVIEW_DB } from '../src/lib/preview-store.ts';

const fixture = () => ({ ...freshState(), current: 'w', workspaces: [{ id: 'w', name: 'Demo', region: 'us-west', tz: 'UTC', created: 0 }] });
const chat = messages => ({ id: 'c', ws: 'w', title: 'Demo', agent: 'codex', model: 'Sample', created: 0, messages });
const bytes = value => Buffer.byteLength(JSON.stringify(value));

test('oversized message collections stop before copying and serializing the entire collection', () => {
  const state = fixture();
  let reads = 0;
  const message = ['you'];
  Object.defineProperty(message, 1, { enumerable: true, get: () => { reads++; return 'x'.repeat(MAX_MESSAGE); } });
  state.chats = Array.from({ length: 3 }, (_, i) => ({ ...chat(Array(400).fill(message)), id: `c${i}` }));
  // This logical state exceeds 37 MiB. Counting accesses verifies early
  // rejection without a timing assertion or allocating a giant JSON string.
  assert.throws(() => validateState(state), StateTooLarge);
  assert.ok(reads < 100, `Read ${reads} messages before enforcing the storage limit`);
});

test('the exact existing one-MiB contract still accepts valid data at its boundary', () => {
  const state = fixture();
  state.chats = [chat(Array.from({ length: 32 }, () => ['you', '']))];
  let remaining = MAX_STATE_BYTES - bytes(state);
  for (const message of state.chats[0].messages) {
    const length = Math.min(MAX_MESSAGE, remaining);
    message[1] = 'x'.repeat(length);
    remaining -= length;
  }
  assert.equal(remaining, 0);
  assert.equal(bytes(state), MAX_STATE_BYTES);
  assert.deepEqual(validateState(state), state);
  state.chats[0].messages.at(-1)[1] += 'x';
  assert.throws(() => validateState(state), StateTooLarge);
});

test('UTF-8 and JSON escaping count toward the aggregate limit', () => {
  for (const content of ['界'.repeat(MAX_MESSAGE), '\u0000'.repeat(MAX_MESSAGE)]) {
    const state = fixture();
    state.chats = [chat(Array.from({ length: 12 }, () => ['you', content]))];
    assert.ok(bytes(state) > MAX_STATE_BYTES);
    assert.throws(() => validateState(state), StateTooLarge);
  }
});

test('IndexedDB structured-clone values cannot bypass list or primitive parsers', () => {
  for (const corrupt of [
    state => { state.theme = new String('dark'); },
    state => { state.notifs = Array(4); },
    state => { state.answers = Array(4); },
    state => { state.chats = Array(1); },
  ]) {
    const state = fixture();
    corrupt(state);
    assert.throws(() => validateState(structuredClone(state)), InvalidState);
  }
});

globalThis.indexedDB = indexedDB;
globalThis.localStorage = { removeItem() {} };

async function rawRecord(key, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(PREVIEW_DB, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('preview', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('preview');
      const request = value === undefined ? store.get(key) : store.put(value, key);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

test('a size rejection keeps the committed snapshot and still permits logout', async () => {
  const before = await beginPreview('size@example.invalid', 5);
  const state = fixture();
  state.chats = [chat(Array.from({ length: 40 }, () => ['you', 'x'.repeat(MAX_MESSAGE)]))];
  await assert.rejects(commitPreview(before, state), StateTooLarge);
  assert.deepEqual(await readPreview(), before);
  await endPreview(before.session);
  assert.equal(await readPreview(), null);
});

test('an aborted account switch rolls back deletion and preserves the previous session', async () => {
  const before = await beginPreview('first@example.invalid', 5);
  const support = { marker: 'previous synthetic support record' };
  await rawRecord('support.user', support);
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      request.addEventListener('success', () => this.transaction.abort(), { once: true });
      return request;
    };
    await assert.rejects(beginPreview('second@example.invalid', 5));
  } finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual(await readPreview(), before);
  assert.deepEqual(await rawRecord('support.user'), support);
  await endPreview(before.session);
});
