import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handleFetch, probeConfiguration, readState, runProbe } from '../edge/maintenance/worker.mjs';
import { MaintenanceState, authorized, errorResponse, normalState, publicState, readSmallJSON, unavailableState, validState, validStatusURL } from '../edge/maintenance/state.mjs';
import { localeFor, renderPage } from '../edge/maintenance/templates/page.mjs';

const TOKEN = 'test-maintenance-control-secret-0123456789';
const PROBE_TOKEN = 'test-origin-probe-secret-0123456789';
const NOW = '2026-10-26T12:00:00Z';
const state = (mode = 'maintenance', changes = {}) => ({
  version: 1, revision: 0, mode, incident_id: 'patch-test', title: 'Maintenance', message: 'Updating the service.',
  starts_at: NOW, expected_end_at: null, next_update_at: null, updated_at: NOW,
  retry_after_seconds: 60, status_url: 'https://status.example.test/', ...changes,
});

function environment(initial) {
  const values = new Map();
  if (initial) values.set('state', { status: initial, owner: 'manual', failures: 0, successes: 0 });
  let lock = Promise.resolve();
  const storage = {
    async get(key) { return structuredClone(values.get(key)); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    transaction(callback) {
      const current = lock.then(() => callback(storage));
      lock = current.catch(() => {});
      return current;
    },
  };
  const env = {
    PUBLIC_HOSTS: 'example.test,www.example.test,api.example.test', OPERATOR_HOSTS: 'console.example.test',
    STATUS_HOST: 'status.example.test', CONTROL_HOST: 'ops.example.test', STATUS_URL: 'https://status.example.test/',
    MAINTENANCE_CONTROL_TOKEN: TOKEN, CONTACT_TEXT: 'help@example.test', ORIGIN_PROBE_URL: '',
  };
  const object = new MaintenanceState({ storage }, env);
  env.MAINTENANCE = { idFromName(name) { assert.equal(name, 'global'); return name; }, get() { return object; } };
  return { env, object, values, storage };
}

const request = (path = '/', options = {}, host = 'example.test') => new Request(`https://${host}${path}`, options);
const control = (env, next, revision = 0, options = {}) => handleFetch(request('/__maintenance/control', {
  method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expected_revision: revision, state: next }), ...options,
}, 'ops.example.test'), env);
const sample = async (object, healthy) => {
  const before = await object.fetch(new Request('https://internal/state'));
  const status = await before.json();
  return object.fetch(new Request('https://internal/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ healthy, expected_revision: status.revision }) }));
};

test('maintenance schema is strict and copies only public fields', () => {
  assert.equal(validState(state()), true);
  assert.equal(validState(null), false);
  assert.equal(validState([]), false);
  for (const change of [
    { version: 2 }, { revision: -1 }, { revision: 1.5 }, { revision: Infinity }, { mode: 'healthy' },
    { incident_id: 1 }, { incident_id: 'x'.repeat(129) }, { title: 'x'.repeat(201) }, { message: 'x'.repeat(4001) },
    { message: 'hidden\u0000text' }, { updated_at: '2026-10-26' }, { updated_at: 'invalid' }, { updated_at: '2026-02-31T12:00:00Z' }, { starts_at: undefined },
    { expected_end_at: 10 }, { next_update_at: 'invalid' }, { retry_after_seconds: 0 }, { retry_after_seconds: 3601 },
    { retry_after_seconds: 2.5 }, { status_url: 'http://status.example.test/' },
  ]) assert.equal(validState(state('normal', change)), false, JSON.stringify(change));
  assert.deepEqual(publicState({ ...state(), control_token: TOKEN, probe: 'private' }), state());
  assert.throws(() => publicState({}), /Invalid maintenance state/);
  assert.equal(validState(state('scheduled', { starts_at: '2026-10-26T14:30:00.123Z', next_update_at: NOW, expected_end_at: NOW })), true);
  assert.equal(validState(state('maintenance', { incident_id: '' })), false);
  assert.equal(validState(state('incident', { incident_id: ' \t\n' })), false);
  assert.equal(validState(state('normal', { incident_id: '' })), true);
  for (const character of ['\u007f', '\u0085', '\u009f']) assert.equal(validState(state('normal', { message: `text${character}` })), false);
  assert.equal(validState(state('maintenance', { message: 'line\nline\r\ttab' })), true);
  assert.equal(validState(state('maintenance', { message: '😀'.repeat(2000) })), true);
  assert.equal(validState(state('maintenance', { message: '😀'.repeat(2001) })), false);
});

test('status links accept only credential-free HTTPS and bounded strings', () => {
  assert.equal(validStatusURL(''), true);
  assert.equal(validStatusURL('https://status.example.test/'), true);
  for (const value of [null, 1, 'invalid', 'javascript:alert(1)', 'https://user:pass@example.test/', 'https://status.example.test/#fragment', 'https://status.example.test/#', 'https://status.example.test/\u0085', 'x'.repeat(2049)]) assert.equal(validStatusURL(value), false);
  assert.equal(validStatusURL('https://status.example.test/%23path'), true);
  assert.equal(normalState(new Date(NOW), 'javascript:bad').status_url, '');
  assert.equal(normalState(new Date(NOW)).updated_at, '2026-10-26T12:00:00.000Z');
  assert.equal(unavailableState(new Date(NOW)).mode, 'incident');
});

test('admin bearer comparison rejects weak configuration, bad schemes and credentials', async () => {
  assert.equal(await authorized(request(), undefined), false);
  assert.equal(await authorized(request(), 'short'), false);
  for (const header of ['', 'Basic abc', `Bearer ${TOKEN}bad`, `Bearer ${'x'.repeat(4097)}`]) assert.equal(await authorized(request('/', { headers: { Authorization: header } }), TOKEN), false);
  assert.equal(await authorized(request('/', { headers: { Authorization: `Bearer ${TOKEN}` } }), TOKEN), true);
});

test('bounded JSON parser rejects excess length, excess streamed bytes, bad encoding and non-JSON', async () => {
  await assert.rejects(readSmallJSON(request('/', { method: 'POST', body: '{}' })), /JSON required/);
  await assert.rejects(readSmallJSON(request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' } })), /JSON required/);
  for (const length of ['99999', 'bad']) await assert.rejects(readSmallJSON(request('/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': length }, body: '{}' })), /Request too large/);
  await assert.rejects(readSmallJSON(request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(65537) })), /Request too large/);
  await assert.rejects(readSmallJSON(request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([255]) })));
  await assert.rejects(readSmallJSON(request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'invalid' })));
  assert.deepEqual(await readSmallJSON(request('/', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{}' })), {});
});

test('DO initializes a durable normal record and survives a new object instance', async () => {
  const { env, object, storage } = environment();
  const first = await readState(env);
  assert.equal(first.mode, 'normal');
  assert.equal(first.revision, 0);
  assert.equal(first.status_url, env.STATUS_URL);
  const restarted = new MaintenanceState({ storage }, env);
  assert.deepEqual(await (await restarted.fetch(new Request('https://internal/state'))).json(), first);
  assert.equal((await object.fetch(new Request('https://internal/unknown'))).status, 404);
  assert.equal((await object.fetch(new Request('https://internal/control'))).status, 404);
  assert.equal((await object.fetch(new Request('https://internal/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'bad' }))).status, 400);
});

test('control updates use atomic revision checks and ignore private extra fields', async () => {
  const { env } = environment();
  const results = await Promise.all([control(env, { ...state(), secret: TOKEN }), control(env, state('incident'))]);
  assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
  const current = await readState(env);
  assert.equal(current.revision, 1);
  assert.equal(Object.hasOwn(current, 'secret'), false);
  assert.notEqual(current.updated_at, NOW);
  const conflict = await control(env, state('normal'), 0);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).state.revision, 1);
  const cleared = await control(env, state('normal'), 1);
  assert.equal(cleared.status, 200);
  assert.equal((await cleared.json()).revision, 2);
});

test('a 4000-character non-ASCII announcement crosses the full control transport safely', async () => {
  const { env } = environment();
  const notice = state('maintenance', { title: '维护公告', message: '维'.repeat(4000) });
  // Cover Python-style ASCII JSON as well as normal UTF-8 transport. The
  // escaped document exceeds the previous 16 KiB transport ceiling.
  const body = JSON.stringify({ expected_revision: 0, state: notice }).replace(/[^\x00-\x7f]/g, value => `\\u${value.charCodeAt(0).toString(16).padStart(4, '0')}`);
  assert.ok(new TextEncoder().encode(body).byteLength > 16384);
  assert.ok(new TextEncoder().encode(body).byteLength <= 65536);
  const response = await control(env, notice, 0, { body });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, notice.message);
  assert.equal((await readState(env)).message, notice.message);
});

test('control cannot be written from a public hostname, unauthenticated request or wrong method', async () => {
  const { env } = environment();
  assert.equal((await handleFetch(request('/__maintenance/control', { method: 'POST' }), env)).status, 404);
  assert.equal((await handleFetch(request('/__maintenance/control', {}, 'ops.example.test'), env)).status, 405);
  assert.equal((await control(env, state(), 0, { headers: { 'Content-Type': 'application/json' } })).status, 401);
  assert.equal((await control(env, state(), 0, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal((await control(env, { ...state(), mode: 'bad' })).status, 400);
  assert.equal((await control(env, state(), -1)).status, 400);
  assert.equal((await handleFetch(request('/', {}, 'ops.example.test'), env)).status, 404);
  assert.equal((await handleFetch(request('/', {}, 'unknown.example.test'), env)).status, 421);
});

test('admin failure is bounded and does not disclose credentials or storage exceptions', async () => {
  const { env } = environment();
  env.MAINTENANCE.get = () => ({ fetch() { throw new Error(`private ${TOKEN}`); } });
  const response = await control(env, state());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes(TOKEN), false);
});

test('DO rejects malformed input, corrupted storage and revision exhaustion without reopening', async () => {
  const { env, values, object } = environment(state());
  assert.equal((await control(env, {})).status, 400);
  values.set('state', { status: { bad: true } });
  assert.equal((await control(env, state())).status, 503);
  const publicResponse = await handleFetch(request('/__maintenance/status'), env);
  assert.equal(publicResponse.status, 200);
  assert.equal((await publicResponse.json()).mode, 'incident');
  values.set('state', { status: state('normal', { revision: Number.MAX_SAFE_INTEGER }), owner: 'manual', failures: 0, successes: 0 });
  assert.equal((await control(env, state(), Number.MAX_SAFE_INTEGER)).status, 409);
  const invalidProbe = await object.fetch(new Request('https://internal/probe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(invalidProbe.status, 400);
});

test('status JSON and HEAD are independent of the origin and never cache or set cookies', async () => {
  const { env } = environment(state());
  const noOrigin = () => { throw new Error('must not reach origin'); };
  const response = await handleFetch(request('/__maintenance/status', { headers: { Cookie: 'private=session' } }), env, noOrigin);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), state());
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Set-Cookie'), null);
  const head = await handleFetch(request('/__maintenance/status', { method: 'HEAD' }), env, noOrigin);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await handleFetch(request('/__maintenance/status', { method: 'POST' }), env, noOrigin)).status, 405);
});

test('all blocking modes serve customer deep links while the entire origin is offline', async () => {
  for (const mode of ['maintenance', 'incident', 'recovering']) {
    const { env } = environment(state(mode));
    for (const path of ['/', '/app/start', '/app/saved-conversation', '/zh/app/', '/zh-hant/app/', '/ja/app/', '/ko/app/', '/es/app/']) {
      const response = await handleFetch(request(path), env, () => { throw new Error('origin offline'); });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('X-Fells-Maintenance'), '1');
      assert.equal(response.headers.get('Retry-After'), '60');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const html = await response.text();
      assert.ok(html.includes('Updating the service.'));
      assert.ok(!html.includes('<script'));
      assert.ok(!html.includes('<link'));
      assert.ok(!html.includes('private=session'));
    }
  }
});

test('API requests get JSON maintenance errors and are rejected before dispatch', async () => {
  const { env } = environment(state());
  for (const [path, options] of [
    ['/api/app/bootstrap', {}], ['/api/support/events', {}], ['/v1/messages', { method: 'POST', body: 'private prompt' }],
    ['/v1', {}], ['/admin/api/overview', {}], ['/unknown', { method: 'POST' }], ['/unknown', { headers: { Accept: 'application/json' } }],
    ['/unknown', { headers: { Accept: 'text/event-stream' } }],
  ]) {
    const response = await handleFetch(request(path, options), env, () => assert.fail('must reject before dispatch'));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
    const body = await response.json();
    assert.equal(body.error.code, 'service_maintenance');
    assert.equal(body.transaction_rejected, true);
    assert.equal(body.request_result_unknown, undefined);
    assert.equal(JSON.stringify(body).includes('private prompt'), false);
  }
  const head = await handleFetch(request('/api/app/bootstrap', { method: 'HEAD' }), env);
  assert.equal(await head.text(), '');
  const incident = await errorResponse(state('incident')).json();
  assert.equal(incident.error.code, 'service_unavailable');
  assert.ok((await errorResponse(state('maintenance', { title: '', message: '' })).json()).error.message);
});

test('explicitly allowed receipt callbacks settle through maintenance and state-store failure', async () => {
  for (const storageFailure of [false, true]) {
    const { env } = environment(state());
    env.CALLBACK_HOSTS = 'api.example.test';
    if (storageFailure) env.MAINTENANCE.get = () => { throw new Error('state store offline'); };
    for (const path of ['/hooks/sidecar-report', '/hooks/sidecar-direct-receipt', '/hooks/sidecar-direct-receipt-v2']) {
      const original = request(path, { method: 'POST', body: 'signed durable receipt', headers: { Authorization: 'Bearer node-control-secret' } }, 'api.example.test');
      const result = new Response('accepted by origin after node authentication');
      const response = await handleFetch(original, env, async incoming => {
        assert.equal(incoming, original);
        assert.equal(incoming.bodyUsed, false);
        assert.equal(incoming.headers.get('Authorization'), 'Bearer node-control-secret');
        return result;
      });
      assert.equal(response, result);
    }
    const refusedAuth = new Response('node authentication required', { status: 401 });
    assert.equal(await handleFetch(request('/hooks/sidecar-report', { method: 'POST', body: '{}' }, 'api.example.test'), env, async () => refusedAuth), refusedAuth);
    for (const [host, path, method] of [
      ['example.test', '/hooks/sidecar-report', 'POST'], ['api.example.test', '/hooks/sidecar-report/extra', 'POST'],
      ['api.example.test', '/hooks/sidecar-report', 'GET'], ['api.example.test', '/api/app/workspaces', 'POST'],
    ]) assert.equal((await handleFetch(request(path, { method }, host), env, () => assert.fail('non-callback admission must remain closed'))).status, 503);
  }
});

test('receipt exceptions stay closed by default and never replay an unknown callback outcome', async () => {
  const { env } = environment(state());
  const incoming = request('/hooks/sidecar-report', { method: 'POST', body: '{}' }, 'api.example.test');
  assert.equal((await handleFetch(incoming, env, () => assert.fail('callback host is not configured'))).status, 503);
  env.CALLBACK_HOSTS = 'api.example.test';
  let calls = 0;
  const response = await handleFetch(incoming, env, async () => { calls++; throw new Error('origin lost'); });
  assert.equal(calls, 1);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).request_result_unknown, true);
});

test('status hostname serves six independent pages with 200 and rejects unrelated paths', async () => {
  const { env } = environment(state());
  for (const path of ['/', '/en/', '/zh/', '/zh-hant/', '/ja/', '/ko/', '/es/']) {
    const response = await handleFetch(request(path, {}, 'status.example.test'), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Fells-Maintenance'), null);
  }
  assert.equal((await handleFetch(request('/app/', {}, 'status.example.test'), env)).status, 404);
  assert.equal((await handleFetch(request('/', { method: 'POST' }, 'status.example.test'), env)).status, 405);
  delete env.CONTROL_HOST;
  assert.equal((await handleFetch(request('/__maintenance/control', { method: 'POST' }, 'status.example.test'), env)).status, 401);
});

test('public operator support routes remain closed including localized deep paths', async () => {
  const { env } = environment(state());
  for (const path of ['/support', '/support/desk', '/zh/support/desk', '/zh-hant/support/', '/ja/support/desk', '/ko/support/', '/es/support/desk']) assert.equal((await handleFetch(request(path), env)).status, 404);
  const response = await handleFetch(request('/support/desk', {}, 'console.example.test'), env);
  assert.equal(response.status, 503);
  assert.ok((await response.text()).includes('Maintenance'));
});

test('normal and scheduled modes forward the same request and response without buffering or replay', async () => {
  for (const mode of ['normal', 'scheduled']) {
    const { env } = environment(state(mode));
    const original = request('/v1/messages', { method: 'POST', body: 'private', headers: { Authorization: 'Bearer user-key', Cookie: 'session=private', Origin: 'https://example.test', 'Cf-Access-Jwt-Assertion': 'access-jwt' } });
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); } });
    const originResponse = new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'X-Origin': 'unchanged' } });
    let calls = 0;
    const response = await handleFetch(original, env, async incoming => {
      calls++;
      assert.equal(incoming, original);
      assert.equal(incoming.bodyUsed, false);
      assert.equal(incoming.headers.get('Cf-Access-Jwt-Assertion'), 'access-jwt');
      return originResponse;
    });
    assert.equal(calls, 1);
    assert.equal(response, originResponse);
    assert.equal(response.headers.get('X-Origin'), 'unchanged');
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
    await reader.cancel();
  }
});

test('upstream HTTP failures remain unchanged and do not set global maintenance', async () => {
  const { env } = environment();
  for (const status of [401, 403, 429, 500, 502, 503, 529]) {
    const origin = new Response('native upstream failure', { status, headers: { 'Retry-After': '15' } });
    assert.equal(await handleFetch(request('/v1/messages', { method: 'POST', body: '{}' }), env, async () => origin), origin);
  }
  assert.equal((await readState(env)).mode, 'normal');
});

test('origin fetch failure displays fallback without replay and marks unknown dispatched API outcomes', async () => {
  const { env } = environment();
  let calls = 0;
  const offline = async () => { calls++; throw new Error(`private error ${TOKEN}`); };
  const html = await handleFetch(request('/zh/app/'), env, offline);
  assert.equal(html.status, 503);
  assert.equal((await html.text()).includes(TOKEN), false);
  const response = await handleFetch(request('/v1/messages', { method: 'POST', body: '{}' }), env, offline);
  const body = await response.json();
  assert.equal(calls, 2);
  assert.equal(body.request_result_unknown, true);
  assert.equal(body.transaction_rejected, undefined);
  assert.equal(body.error.code, 'service_unavailable');
  assert.equal((await readState(env)).mode, 'normal');
});

test('Cloudflare connect errors fall back only for browser HTML navigation', async () => {
  const { env } = environment();
  for (const status of [521, 522, 523, 524, 525, 526]) {
    const page = await handleFetch(request('/zh/app/', { headers: { Accept: 'text/html' } }), env, async () => new Response('Cloudflare connection error', { status }));
    assert.equal(page.status, 503);
    assert.ok((await page.text()).includes('Service temporarily unavailable'));
    const apiResponse = new Response('exact API upstream error', { status });
    assert.equal(await handleFetch(request('/v1/messages', { headers: { Accept: 'text/html' } }), env, async () => apiResponse), apiResponse);
    const unknownResponse = new Response('unknown non-navigation response', { status });
    assert.equal(await handleFetch(request('/asset.bin'), env, async () => unknownResponse), unknownResponse);
  }
  const ordinary = new Response('origin HTTP error', { status: 503 });
  assert.equal(await handleFetch(request('/app/', { headers: { 'Sec-Fetch-Mode': 'navigate' } }), env, async () => ordinary), ordinary);
});

test('default Worker fetch accepts Cloudflare execution context without treating it as fetch', async () => {
  const { env } = environment(state());
  assert.equal((await worker.fetch(request('/'), env, {})).status, 503);
});

test('locale selection prefers path then browser language without script injection', async () => {
  assert.equal(localeFor(request('/ja/app', { headers: { 'Accept-Language': 'zh-TW,en' } })), 'ja');
  assert.equal(localeFor(request('/', { headers: { 'Accept-Language': 'fr,zh-TW;q=.8' } })), 'zh-hant');
  assert.equal(localeFor(request('/', { headers: { 'Accept-Language': 'ko-KR,en' } })), 'ko');
  assert.equal(localeFor(request('/', { headers: { 'Accept-Language': 'fr-FR' } })), 'en');
  const response = await renderPage(request('/'), state('maintenance', { title: '<script>bad</script>', message: '<img src=x onerror=bad>', incident_id: '<secret>', next_update_at: NOW }), 503, '<contact>');
  const html = await response.text();
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img '), false);
  assert.ok(html.includes('&lt;contact&gt;'));
  assert.ok(html.includes('&lt;secret&gt;'));
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(style)));
  assert.ok(response.headers.get('Content-Security-Policy').includes(`style-src 'sha256-${btoa(String.fromCharCode(...digest))}'`));
  assert.ok(response.headers.get('Content-Security-Policy').includes("default-src 'none'"));
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(await (await renderPage(request('/', { method: 'HEAD' }), state())).text(), '');
  const normal = await renderPage(request('/'), normalState(new Date(NOW)), 200, undefined);
  assert.ok((await normal.text()).includes('No active maintenance notice'));
  const fallback = await renderPage(request('/zh/'), state('incident', { title: '', message: '', incident_id: '', status_url: '' }), 503, 'x'.repeat(255));
  assert.ok((await fallback.text()).includes('服务暂时中断'));
});

test('refresh links remain bound to the current origin for scheme-relative pathnames', async () => {
  for (const path of ['//evil.example.test/path', '///evil.example.test/path', '/%2F%2Fevil.example.test/path']) {
    const incoming = request(path);
    const html = await (await renderPage(incoming, state())).text();
    const href = html.match(/<a href="([^"]+)">Refresh<\/a>/)[1];
    assert.equal(new URL(href, incoming.url).origin, 'https://example.test');
    assert.equal(href, new URL(incoming.url).origin + new URL(incoming.url).pathname);
  }
});

test('independent probe rejects self-routes, unsafe URLs and weak credentials', () => {
  const { env } = environment();
  assert.equal(probeConfiguration(env), null);
  env.ORIGIN_PROBE_TOKEN = PROBE_TOKEN;
  for (const url of [
    'http://probe.example.test/__maintenance/probe', 'https://u:p@probe.example.test/__maintenance/probe',
    'https://example.test/__maintenance/probe', 'https://console.example.test/__maintenance/probe',
    'https://status.example.test/__maintenance/probe', 'https://ops.example.test/__maintenance/probe',
    'https://probe.example.test/__maintenance/status', 'https://probe.example.test/__maintenance/probe#fragment',
  ]) { env.ORIGIN_PROBE_URL = url; assert.throws(() => probeConfiguration(env)); }
  env.ORIGIN_PROBE_URL = 'https://probe.example.test/__maintenance/probe';
  assert.equal(probeConfiguration(env).hostname, 'probe.example.test');
  env.ORIGIN_PROBE_TOKEN = 'short';
  assert.throws(() => probeConfiguration(env));
});

test('failed probes enter incident and healthy probes require explicit recovery clearance', async () => {
  const { env } = environment();
  env.ORIGIN_PROBE_URL = 'https://probe.example.test/__maintenance/probe';
  env.ORIGIN_PROBE_TOKEN = PROBE_TOKEN;
  const failed = async (url, options) => {
    assert.equal(url, env.ORIGIN_PROBE_URL);
    assert.equal(options.headers.Authorization, `Bearer ${PROBE_TOKEN}`);
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    return new Response('not ready', { status: 503 });
  };
  await runProbe(env, failed); await runProbe(env, failed);
  assert.equal((await readState(env)).mode, 'normal');
  await runProbe(env, failed);
  const incident = await readState(env);
  assert.equal(incident.mode, 'incident');
  assert.equal(incident.revision, 1);
  const healthy = async () => new Response('ready');
  await runProbe(env, healthy);
  assert.equal((await readState(env)).mode, 'incident');
  await runProbe(env, healthy);
  assert.equal((await readState(env)).mode, 'recovering');
  await runProbe(env, healthy);
  assert.equal((await readState(env)).mode, 'recovering');
  await runProbe(env, failed); await runProbe(env, failed); await runProbe(env, failed);
  assert.equal((await readState(env)).mode, 'incident');
});

test('manual maintenance, scheduled and recovering states take priority over monitor results', async () => {
  for (const mode of ['maintenance', 'scheduled', 'recovering', 'incident']) {
    const { env, object } = environment(state(mode));
    env.ORIGIN_PROBE_URL = 'https://probe.example.test/__maintenance/probe'; env.ORIGIN_PROBE_TOKEN = PROBE_TOKEN;
    await runProbe(env, async () => new Response('ready'));
    await sample(object, true); await sample(object, true); await sample(object, false); await sample(object, false); await sample(object, false);
    assert.equal((await readState(env)).mode, mode);
  }
});

test('a manual change wins over an already in-flight probe', async () => {
  const { env } = environment();
  env.ORIGIN_PROBE_URL = 'https://probe.example.test/__maintenance/probe'; env.ORIGIN_PROBE_TOKEN = PROBE_TOKEN;
  await runProbe(env, async () => new Response('bad')); await runProbe(env, async () => new Response('bad'));
  await runProbe(env, async () => { assert.equal((await control(env, state('maintenance'))).status, 200); throw new Error('timeout'); });
  assert.equal((await readState(env)).mode, 'maintenance');
});

test('probes reject fake readiness, oversized bodies, redirects, errors and maintenance responses', async () => {
  for (const makeResponse of [
    () => new Response('ok'), () => new Response('<html>ready</html>'), () => new Response('x'.repeat(65)),
    () => new Response('ready', { headers: { 'X-Fells-Maintenance': '1' } }), () => new Response(null, { status: 204 }),
    () => new Response('', { status: 302 }), () => { throw new Error('unreachable'); },
  ]) {
    const { env } = environment();
    env.ORIGIN_PROBE_URL = 'https://probe.example.test/__maintenance/probe'; env.ORIGIN_PROBE_TOKEN = PROBE_TOKEN;
    await runProbe(env, makeResponse); await runProbe(env, makeResponse); await runProbe(env, makeResponse);
    assert.equal((await readState(env)).mode, 'incident');
  }
});

test('probe scheduling is disabled without configuration and reports storage failure', async () => {
  const { env } = environment();
  await runProbe(env, () => assert.fail('disabled probe must not fetch'));
  env.ORIGIN_PROBE_URL = 'https://probe.example.test/__maintenance/probe'; env.ORIGIN_PROBE_TOKEN = PROBE_TOKEN;
  const actual = env.MAINTENANCE.get;
  env.MAINTENANCE.get = id => ({ async fetch(incoming) { return new URL(incoming.url).pathname === '/probe' ? new Response('{}', { status: 503 }) : actual(id).fetch(incoming); } });
  await assert.rejects(runProbe(env, async () => new Response('ready')), /Probe state update failed/);
  env.ORIGIN_PROBE_URL = '';
  let awaited = false;
  await worker.scheduled({}, env, { waitUntil(promise) { awaited = true; return promise; } });
  assert.equal(awaited, true);
});
