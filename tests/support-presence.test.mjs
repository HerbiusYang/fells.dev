import test from 'node:test';
import assert from 'node:assert/strict';
import { installSupportPresence } from '../src/lib/support-presence.ts';
import { installSupportAvailabilityReader, installSupportAvailabilityHeartbeat } from '../src/lib/support-availability.ts';

const flush = async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function environment(t) {
  const document = new EventTarget(), window = new EventTarget();
  const text = new EventTarget(); text.value = '';
  document.hidden = false; document.activeElement = text;
  const navigator = { onLine: true };
  const cleanups = [], restores = [];
  t.after(() => { for (const cleanup of cleanups) cleanup(); for (const restore of restores) restore(); });
  for (const [key, value] of Object.entries({ document, navigator, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    restores.push(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  let now = 100000, serial = 0;
  const timers = new Map();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; });
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: now + delay, repeat: delay }); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next; now = timer.at;
      if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
      timer.callback(); await flush();
    }
    now = end; await flush();
  }
  return { document, window, text, navigator, advance, timers, cleanups };
}

test('slow typing transport does not replay paused drafts or leak presence into a different conversation', async t => {
  const env = environment(t), pending = deferred(), calls = [];
  let context = { session: 'session', conversationId: 'first' };
  const presence = installSupportPresence({ text: env.text, indicator: { hidden: true }, getContext: () => context, canType: () => true,
    read: async () => false, publish: async (context, typing) => { calls.push([context.conversationId, typing]); if (calls.length === 1) await pending.promise; },
  });
  env.cleanups.push(() => presence.dispose());
  env.text.value = 'private draft'; env.text.dispatchEvent(new Event('input')); await flush();
  await env.advance(1500); env.text.dispatchEvent(new Event('input')); await flush();
  await env.advance(1500); env.text.dispatchEvent(new Event('input')); await flush();
  presence.clear(); context = { ...context, conversationId: 'second' };
  env.text.value = 'new conversation'; env.text.dispatchEvent(new Event('input')); await flush();
  pending.resolve(); await flush();
  assert.deepEqual(calls, [['first', true], ['first', false], ['second', true]]);
  await env.advance(2000);
  assert.deepEqual(calls.at(-1), ['second', false]);
});

test('late typing reads cannot reveal a previous customer or reopen a disposed indicator', async t => {
  const env = environment(t), pending = deferred(), indicator = { hidden: true };
  let context = { session: 'first' };
  const presence = installSupportPresence({ text: env.text, indicator, getContext: () => context, canType: () => true,
    read: () => pending.promise, publish: async () => {},
  });
  context = { session: 'second' }; await presence.refresh();
  pending.resolve(true); await flush();
  assert.equal(indicator.hidden, true);
  presence.dispose(); await env.advance(10000);
  assert.equal(indicator.hidden, true); assert.equal(env.timers.size, 0);
});

test('availability has an explicit unknown state on offline and failed reads, then recovers without changing drafts', async t => {
  const env = environment(t), states = [];
  env.text.value = 'keep this draft';
  let result = false;
  const reader = installSupportAvailabilityReader({ read: async () => { if (result === 'error') throw new Error('Disconnected'); return result; }, changed: state => states.push(state), onError: () => {} });
  env.cleanups.push(() => reader.dispose()); await flush();
  assert.deepEqual(states, ['unknown', 'offline']);
  result = true; await env.advance(5000); assert.equal(states.at(-1), 'online');
  env.navigator.onLine = false; env.window.dispatchEvent(new Event('offline')); assert.equal(states.at(-1), 'unknown');
  env.navigator.onLine = true; result = 'error'; env.window.dispatchEvent(new Event('online')); await flush(); assert.equal(states.at(-1), 'unknown');
  result = true; await env.advance(5000); assert.equal(states.at(-1), 'online');
  assert.equal(env.text.value, 'keep this draft');
});

test('an offline or disposed availability reader ignores a late online response and removes its timers', async t => {
  const env = environment(t), pending = deferred(), states = [];
  const reader = installSupportAvailabilityReader({ read: () => pending.promise, changed: state => states.push(state), onError: () => {} });
  env.navigator.onLine = false; env.window.dispatchEvent(new Event('offline'));
  pending.resolve(true); await flush(); assert.equal(states.at(-1), 'unknown');
  reader.dispose(); await env.advance(15000); assert.equal(env.timers.size, 0);
  assert.ok(!states.includes('online'));
});

test('availability heartbeat bounds concurrent requests and serializes logout after a slow heartbeat', async t => {
  const env = environment(t), pending = deferred(), calls = [], states = [];
  const heartbeat = installSupportAvailabilityHeartbeat({ publish: async (online, sourceId) => { calls.push({ online, sourceId }); if (online) await pending.promise; }, changed: state => states.push(state), onError: () => {} });
  await flush(); await env.advance(30000);
  assert.equal(calls.length, 1, 'in-flight heartbeats do not form a request backlog');
  heartbeat.dispose(); await flush(); assert.equal(calls.length, 1);
  pending.resolve(); await flush();
  assert.deepEqual(calls.map(call => call.online), [true, false]);
  assert.equal(calls[0].sourceId, calls[1].sourceId); assert.match(calls[0].sourceId, /^[\da-f-]{36}$/);
  assert.ok(!states.includes('online'), 'the stopped desk cannot announce online after a late response');
  assert.equal(env.timers.size, 0);
});
