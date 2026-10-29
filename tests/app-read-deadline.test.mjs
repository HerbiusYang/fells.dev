import test from 'node:test';
import assert from 'node:assert/strict';
import { api, APIError, API_READ_TIMEOUT_MS } from '../src/lib/app-http.ts';
import { readTimeoutMessage } from '../src/i18n/read-timeout.ts';

for (const phase of ['headers', 'body']) test(`read deadline cancels stalled ${phase} without retrying`, async t => {
  const previous = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { globalThis.fetch = previous; t.mock.timers.reset(); });
  let entered, signal, calls = 0;
  const began = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (_path, options) => {
    calls++; signal = options.signal;
    if (phase === 'body') return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }); entered();
    } }), { headers: { 'content-type': 'application/json' } });
    return new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); entered(); });
  };
  const pending = api('/api/app/invoices');
  const failed = assert.rejects(pending, error => error instanceof APIError && error.status === 408 && error.code === 'api_read_timeout');
  await began;
  t.mock.timers.tick(API_READ_TIMEOUT_MS - 1); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await failed;
  assert.equal(signal.aborted, true); assert.equal(calls, 1);
});

for (const when of ['before dispatch', 'while pending']) test(`caller cancellation remains authoritative ${when}`, async t => {
  const previous = globalThis.fetch, parent = new AbortController(), reason = new Error('The view was closed');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { globalThis.fetch = previous; t.mock.timers.reset(); });
  if (when === 'before dispatch') parent.abort(reason);
  let received;
  globalThis.fetch = async (_path, options) => {
    received = options.signal;
    if (received.aborted) throw received.reason;
    return new Promise((_, reject) => received.addEventListener('abort', () => reject(received.reason), { once: true }));
  };
  const pending = api('/api/app/catalog', { signal: parent.signal });
  const failed = assert.rejects(pending, error => error === reason);
  if (when === 'while pending') parent.abort(reason);
  await failed; t.mock.timers.tick(API_READ_TIMEOUT_MS * 2);
  assert.equal(received.aborted, true); assert.equal(received.reason, reason);
});

test('completed reads remove their deadline and parent cancellation listener', async t => {
  const previous = globalThis.fetch, parent = new AbortController(); let signal;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { globalThis.fetch = previous; t.mock.timers.reset(); });
  globalThis.fetch = async (_path, options) => { signal = options.signal; return Response.json({ loaded: true }); };
  assert.deepEqual(await api('/api/app/catalog', { signal: parent.signal }), { loaded: true });
  parent.abort(); t.mock.timers.tick(API_READ_TIMEOUT_MS * 2);
  assert.equal(signal.aborted, false, 'completed reads retain no late abort callbacks');
});

test('a delayed paid write receives no automatic read timeout or replay', async t => {
  const previous = globalThis.fetch; let release, signal, calls = 0, completed = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { globalThis.fetch = previous; t.mock.timers.reset(); });
  globalThis.fetch = async (_path, options) => { calls++; signal = options.signal; return new Promise(resolve => { release = () => resolve(Response.json({ accepted: true })); }); };
  const pending = api('/api/app/chats/synthetic/generate', { body: { request_id: 'synthetic-once' } }).then(value => { completed = true; return value; });
  t.mock.timers.tick(API_READ_TIMEOUT_MS * 4); await Promise.resolve();
  assert.equal(signal, undefined); assert.equal(completed, false); assert.equal(calls, 1);
  release(); assert.deepEqual(await pending, { accepted: true }); assert.equal(calls, 1);
});

test('read timeout messages match every supported UI language', () => {
  for (const language of ['en', 'zh-CN', 'zh-TW', 'zh-hant', 'ja', 'ko', 'es']) assert.ok(readTimeoutMessage(language).length > 4);
  assert.match(readTimeoutMessage('zh-Hant-TW'), /讀取/);
  assert.match(readTimeoutMessage('zh-CN'), /读取/);
  assert.equal(readTimeoutMessage('fr'), readTimeoutMessage('en'));
  assert.equal(readTimeoutMessage('en-US'), readTimeoutMessage('en'));
});
