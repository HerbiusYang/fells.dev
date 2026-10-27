import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaintenanceClient, parseMaintenanceStatus, getMaintenanceStatus, isBusinessBlocked, observeMaintenanceResponse, readMaintenanceStatus, subscribeMaintenance, installMaintenanceMonitor } from '../src/lib/maintenance.ts';
import { maintenanceCopy } from '../src/i18n/maintenance.ts';
import { api, APIError } from '../src/lib/app-http.ts';
import { createSupportHttpService } from '../src/lib/support-http.ts';
import { SupportSessionEnded } from '../src/lib/support-store.ts';

const status = (mode = 'maintenance', revision = 1) => ({ version: 1, revision, mode, incident_id: 'patch-20261026', title: 'Maintenance', message: 'Patching the host', starts_at: '2026-10-26T22:00:00Z', expected_end_at: null, next_update_at: '2026-10-26T22:30:00.000Z', updated_at: '2026-10-26T22:01:00Z', retry_after_seconds: 60, status_url: 'https://status.fells.dev/' });
const response = (value, code = 200, marked = false) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json', ...(marked ? { 'X-Fells-Maintenance': '1' } : {}) } });
const envelope = state => ({ error: { code: state.mode === 'incident' ? 'service_unavailable' : 'service_maintenance', message: state.message }, maintenance: state });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('maintenance schema accepts the complete protocol and rejects malformed data and unsafe links', () => {
  for (const mode of ['normal', 'scheduled', 'maintenance', 'incident', 'recovering']) assert.equal(parseMaintenanceStatus(status(mode)).mode, mode);
  const allNull = { ...status(), starts_at: null, next_update_at: null, status_url: '' };
  assert.deepEqual(parseMaintenanceStatus(allNull), allNull);
  for (const value of [null, [], 'maintenance', {}, { ...status(), version: 2 }, { ...status(), revision: -1 }, { ...status(), revision: 0.5 }, { ...status(), mode: 'unknown' }, { ...status(), mode: {} }, { ...status(), title: 3 }, { ...status(), title: 'x'.repeat(201) }, { ...status(), message: 'x'.repeat(8001) }, { ...status(), incident_id: 'x'.repeat(129) }, { ...status(), status_url: 'x'.repeat(2049) }, { ...status(), updated_at: 'yesterday' }, { ...status(), starts_at: undefined }, { ...status(), next_update_at: '2026-99-26T22:30:00Z' }, { ...status(), retry_after_seconds: 0 }, { ...status(), retry_after_seconds: 3601 }, { ...status(), retry_after_seconds: 1.5 }, { ...status(), status_url: 'http://status.fells.dev' }, { ...status(), status_url: 'javascript:alert(1)' }, { ...status(), status_url: 'https://user:password@status.fells.dev' }, { ...status(), status_url: 'not a url' }]) assert.equal(parseMaintenanceStatus(value), null, JSON.stringify(value));
  assert.equal(Object.isFrozen(parseMaintenanceStatus(status())), true);
});

test('frontend schema matches the edge and origin UTC, text and fixed-field contract', () => {
  for (const fraction of ['', '.1', '.12', '.123']) assert.ok(parseMaintenanceStatus({ ...status(), updated_at: `2026-10-26T22:01:00${fraction}Z` }));
  for (const updated_at of ['2026-10-26T22:01:00+00:00', '2026-10-26T22:01:00.1234Z', '2026-02-31T22:01:00Z', '2026-10-26T24:01:00Z']) assert.equal(parseMaintenanceStatus({ ...status(), updated_at }), null);
  for (const field of ['incident_id', 'title', 'message', 'status_url']) for (const character of ['\0', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\u007f', '\u0085', '\u009f']) assert.equal(parseMaintenanceStatus({ ...status(), [field]: 'https://status.fells.dev/' + character }), null);
  assert.ok(parseMaintenanceStatus({ ...status(), message: 'Lines\nwith\tspacing\rand returns' }));
  for (const mode of ['maintenance', 'incident', 'recovering']) for (const incident_id of ['', ' \t\n']) assert.equal(parseMaintenanceStatus({ ...status(mode), incident_id }), null);
  for (const mode of ['normal', 'scheduled']) assert.ok(parseMaintenanceStatus({ ...status(mode), incident_id: '' }));
  for (const status_url of ['https://status.fells.dev/#anchor', 'https://status.fells.dev/#']) assert.equal(parseMaintenanceStatus({ ...status(), status_url }), null);
  assert.ok(parseMaintenanceStatus({ ...status(), status_url: 'https://status.fells.dev/%23path' }));
  for (const [field, limit] of [['incident_id', 128], ['title', 200], ['message', 4000], ['status_url', 2048]]) {
    const prefix = field === 'status_url' ? 'https://status.fells.dev/' : '';
    const value = prefix + 'x'.repeat(limit - prefix.length);
    assert.ok(parseMaintenanceStatus({ ...status(), [field]: value }));
    assert.equal(parseMaintenanceStatus({ ...status(), [field]: value + 'x' }), null);
  }
  assert.ok(parseMaintenanceStatus({ ...status(), title: '😀'.repeat(100) }));
  assert.equal(parseMaintenanceStatus({ ...status(), title: '😀'.repeat(101) }), null);
  const input = { ...status(), internal: { secret: 'never public' }, origin_probe_url: 'https://internal.invalid' };
  assert.deepEqual(Object.keys(parseMaintenanceStatus(input)), Object.keys(status()));
});

test('revision ordering prevents a late normal response from clearing a newer incident', () => {
  const client = createMaintenanceClient(), seen = [];
  const unsubscribe = client.subscribe(value => seen.push(value.mode));
  assert.equal(client.get(), null); assert.equal(client.blocked(), false);
  assert.equal(client.accept({}), false);
  assert.equal(client.accept(status('scheduled', 0)), true); assert.equal(client.blocked(), false);
  assert.equal(client.accept(status('incident', 2)), true); assert.equal(client.blocked(), true);
  assert.equal(client.accept(status('normal', 1)), false);
  assert.equal(client.accept(status('normal', 2)), false);
  assert.equal(client.accept(status('recovering', 3)), true); assert.equal(client.blocked(), true);
  assert.equal(client.accept(status('normal', 4)), true); assert.equal(client.blocked(), false);
  unsubscribe(); assert.equal(client.accept(status('maintenance', 5)), true);
  assert.deepEqual(seen, ['scheduled', 'incident', 'recovering', 'normal']);
});

test('only an explicitly marked 503 with a valid blocking maintenance envelope changes state', () => {
  const client = createMaintenanceClient(), value = envelope(status());
  for (const [reply, body] of [[response(value, 502, true), value], [response(value, 503), value], [response(null, 503, true), null], [response([], 503, true), []], [response({}, 503, true), {}], [response(value, 503, true), { ...value, error: { code: 'overloaded' } }], [response(value, 503, true), envelope(status('normal'))], [response(value, 503, true), envelope(status('scheduled'))], [response(value, 503, true), { ...value, maintenance: {} }]]) assert.equal(client.observe(reply, body), false);
  assert.equal(client.get(), null);
  assert.equal(client.observe(response(value, 503, true), value), true);
  const incident = envelope(status('incident', 2));
  assert.equal(client.observe(response(incident, 503, true), incident), true);
  assert.equal(client.get().mode, 'incident');
});

test('status reads are deduplicated and transport failures or an absent edge never claim recovery', async () => {
  let resolve, calls = 0, reply = new Promise(done => { resolve = done; });
  const client = createMaintenanceClient(async (path, options) => {
    calls++; assert.equal(path, '/__maintenance/status'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return await reply;
  });
  const first = client.read(); assert.equal(client.read(), first); assert.equal(calls, 1);
  resolve(response(null, 404)); assert.equal(await first, null); assert.equal(client.blocked(), false);
  reply = Promise.resolve(response(status('maintenance', 3))); assert.equal((await client.read()).revision, 3);
  reply = Promise.resolve(response(null, 404)); assert.equal((await client.read()).mode, 'maintenance');
  reply = Promise.resolve(response(status('normal', 2))); assert.equal((await client.read()).mode, 'maintenance');
  reply = Promise.resolve(new Response('invalid json')); assert.equal((await client.read()).mode, 'maintenance');
  reply = Promise.reject(new Error('network down')); assert.equal((await client.read()).mode, 'maintenance');
  reply = Promise.resolve(response(status('normal', 4))); assert.equal((await client.read()).mode, 'normal');
});

test('transient origin and edge outages overlay the durable revision and an older normal read cannot clear them', async () => {
  for (const incident_id of ['origin-status-unavailable', 'edge-status-unavailable']) {
    let resolve, reply = Promise.resolve(response(status('normal', 5)));
    const client = createMaintenanceClient(async () => await reply), seen = [];
    client.subscribe(value => seen.push(value.mode));
    await client.read(); assert.equal(client.get().revision, 5); assert.equal(client.blocked(), false);
    reply = new Promise(done => { resolve = done; });
    const delayedNormal = client.read();
    const fallback = { ...status('incident', 0), incident_id };
    const marked = envelope(fallback);
    assert.equal(client.observe(response(marked, 503, true), marked), true);
    assert.equal(client.get().incident_id, incident_id); assert.equal(client.blocked(), true);
    resolve(response(status('normal', 5))); await delayedNormal;
    assert.equal(client.get().incident_id, incident_id); assert.equal(client.blocked(), true, 'the earlier read cannot erase the new outage');
    reply = Promise.resolve(response(status('normal', 5))); await client.read();
    assert.equal(client.get().revision, 5); assert.equal(client.get().mode, 'normal'); assert.equal(client.blocked(), false);
    client.accept(status('maintenance', 6));
    reply = Promise.resolve(response(status('normal', 5))); await client.read();
    assert.equal(client.get().mode, 'maintenance'); assert.equal(client.get().revision, 6); assert.equal(client.blocked(), true);
    assert.deepEqual(seen, ['normal', 'incident', 'normal', 'maintenance']);
  }
});

test('a delayed higher normal revision cannot clear a transient outage, while a fresh read and confirmed maintenance can', async () => {
  let resolve, reply = Promise.resolve(response(status('normal', 5)));
  const client = createMaintenanceClient(async () => await reply); await client.read();
  reply = new Promise(done => { resolve = done; }); const delayed = client.read();
  const fallback = { ...status('incident', 0), incident_id: 'edge-status-unavailable' };
  client.accept(fallback); resolve(response(status('normal', 6))); await delayed;
  assert.equal(client.get().incident_id, 'edge-status-unavailable'); assert.equal(client.blocked(), true);
  reply = Promise.resolve(response(status('normal', 6))); await client.read(); assert.equal(client.blocked(), false);
  // A status endpoint fallback is also transient and keeps the durable base.
  reply = Promise.resolve(response(fallback)); await client.read(); assert.equal(client.blocked(), true);
  assert.equal(client.accept(status('maintenance', 7)), true); assert.equal(client.get().revision, 7);
  client.accept(fallback); reply = Promise.resolve(response(null, 404)); await client.read(); assert.equal(client.blocked(), true);
  reply = Promise.resolve(response(status('maintenance', 7))); await client.read(); assert.equal(client.get().mode, 'maintenance');
});

test('browser monitoring only reads while visible and online and disposes every listener', async t => {
  const document = new EventTarget(), window = new EventTarget(); document.hidden = false;
  const navigator = { onLine: true }, restores = [], timers = new Map(); let reads = 0;
  for (const [key, value] of Object.entries({ document, navigator, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { value, configurable: true });
    restores.push(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  t.after(() => restores.forEach(restore => restore()));
  t.mock.method(globalThis, 'fetch', async () => { reads++; return response(null, 404); });
  t.mock.method(globalThis, 'setInterval', callback => { timers.set(1, callback); return 1; });
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  const stop = installMaintenanceMonitor(); await flush(); assert.equal(reads, 1);
  document.hidden = true; timers.get(1)(); window.dispatchEvent(new Event('focus')); await flush(); assert.equal(reads, 1);
  document.hidden = false; navigator.onLine = false; document.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(reads, 1);
  navigator.onLine = true; window.dispatchEvent(new Event('online')); await flush(); assert.equal(reads, 2);
  timers.get(1)(); await flush(); assert.equal(reads, 3);
  stop(); assert.equal(timers.size, 0); window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(reads, 3);
});

test('API pause preserves an in-flight real 401, blocks subsequent business requests, and resumes on confirmed normal', async t => {
  let resolve, calls = 0, current = status('normal', 100);
  t.mock.method(globalThis, 'fetch', async path => { calls++; return path === '/__maintenance/status' ? response(current) : await new Promise(done => { resolve = done; }); });
  await readMaintenanceStatus(); assert.equal(isBusinessBlocked(), false);
  const pending = api('/api/app/bootstrap');
  const changes = [], unsubscribe = subscribeMaintenance(value => changes.push(value.mode));
  const paused = status('maintenance', 101), value = envelope(paused);
  assert.equal(observeMaintenanceResponse(response(value, 503, true), value), true);
  resolve(response({ error: { code: 'unauthorized', message: 'Session ended' } }, 401));
  await assert.rejects(pending, error => error instanceof APIError && error.status === 401);
  const before = calls;
  await assert.rejects(api('/api/app/keys', { body: { label: 'never sent' } }), error => error.status === 503 && error.code === 'service_maintenance' && error.retryAfter === 60);
  assert.equal(calls, before); assert.equal(getMaintenanceStatus().revision, 101);
  current = status('normal', 102); await readMaintenanceStatus(); assert.equal(isBusinessBlocked(), false);
  unsubscribe(); assert.deepEqual(changes, ['maintenance', 'normal']);
  t.mock.method(globalThis, 'fetch', async () => response({ error: { code: 'overloaded', message: 'Try later' } }, 503));
  await assert.rejects(api('/api/app/bootstrap'), error => error.status === 503 && error.code === 'overloaded');
  assert.equal(isBusinessBlocked(), false);
  const marked = envelope(status('incident', 103));
  t.mock.method(globalThis, 'fetch', async () => response(marked, 503, true));
  await assert.rejects(api('/api/app/bootstrap'), error => error.status === 503 && error.code === 'service_unavailable');
  assert.equal(isBusinessBlocked(), true);
  t.mock.method(globalThis, 'fetch', async () => response(status('normal', 104)));
  await readMaintenanceStatus(); assert.equal(isBusinessBlocked(), false);
});

test('support retains an open SSE, pauses failed connections, and verifies the same identity before recovery', async t => {
  let current = status('normal', 200), denied = false, reads = 0;
  t.mock.method(globalThis, 'fetch', async () => response(current)); await readMaintenanceStatus();
  const streams = [], events = [];
  const service = createSupportHttpService({ notify: () => {}, request: async () => {
    reads++; if (denied) throw new APIError(401, 'Session revoked');
    return { session_id: 'b'.repeat(64), user: { id: '42', username: 'customer' } };
  }, eventSource: url => {
    const stream = { url, readyState: 1, onerror: null, closed: false, addEventListener() {}, close() { this.closed = true; this.readyState = 2; } };
    streams.push(stream); return stream;
  } });
  const user = await service.readCustomerSession();
  const connection = service.openSupportEvents('customer', user.session, event => events.push(event));
  current = status('maintenance', 201); await readMaintenanceStatus();
  assert.equal(streams[0].closed, false, 'maintenance never cuts an open event stream');
  const before = reads; streams[0].readyState = 2; streams[0].onerror();
  assert.equal(streams[0].closed, true); assert.equal(reads, before); assert.equal(streams.length, 1);
  current = status('normal', 202); await readMaintenanceStatus(); await flush();
  assert.equal(reads, before + 1); assert.equal(streams.length, 2);
  streams[1].readyState = 0;
  current = status('incident', 203); await readMaintenanceStatus(); assert.equal(streams[1].closed, true);
  denied = true; current = status('normal', 204); await readMaintenanceStatus(); await flush();
  assert.equal(streams.length, 2); assert.equal(events.at(-1).type, 'session.expired');
  await assert.rejects(service.ensureUserConversation(user, 'en'), SupportSessionEnded);
  connection.close();
});

test('maintenance labels cover all six existing locales and their account-language aliases', () => {
  for (const locale of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) assert.equal(Object.values(maintenanceCopy(locale)).every(value => typeof value === 'string' && value.length > 0), true);
  assert.deepEqual(maintenanceCopy('zh-CN'), maintenanceCopy('zh')); assert.deepEqual(maintenanceCopy('zh-TW'), maintenanceCopy('zh-hant'));
  assert.deepEqual(maintenanceCopy('unknown'), maintenanceCopy('en'));
});
