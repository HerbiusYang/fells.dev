import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chromium } from 'playwright';
import { handleFetch } from '../../edge/maintenance/worker.mjs';
import { MaintenanceState } from '../../edge/maintenance/state.mjs';
import { trackCoverage } from '../helpers/browser.mjs';

// This fixture uses two real loopback HTTP servers. Origin outages are caused
// by closing its listener and sockets, rather than mocking a fetch exception.
// Only DO storage is in memory; control writes travel over the edge HTTP server.
const TOKEN = 'isolated-edge-browser-control-token-0123456789';
const PRIVATE_COOKIE = 'isolated-origin-http-only-secret';
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  const completed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await completed;
}

// Node's Fetch implementation may replace a caller-supplied Host header with
// the loopback URL's authority. Use real node:http for virtual control/status
// hosts so this fixture tests the configured host boundary on the actual wire.
// The TCP destination remains the existing loopback edge listener.
async function virtualHostRequest(url, { method = 'GET', headers = {}, body } = {}) {
  assert.equal(new URL(url).hostname, '127.0.0.1');
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(url, { method, headers, agent: false }, incoming => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(incoming), { status: incoming.statusCode, headers: responseHeaders }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

async function createFixture() {
  let origin, originBase, originVersion = 'v1', forwardAttempts = 0;
  const originRequests = [], serverErrors = [];
  async function startOrigin(version) {
    originVersion = version;
    origin = createServer((incoming, outgoing) => {
      originRequests.push({ path: incoming.url, cookie: incoming.headers.cookie ?? '', method: incoming.method });
      outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Origin-Version': originVersion,
        'Cache-Control': 'no-store', 'Set-Cookie': `fells_edge_fixture=${PRIVATE_COOKIE}; HttpOnly; Path=/; SameSite=Lax` });
      outgoing.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated origin</title></head><body><main><h1>REAL ORIGIN ${originVersion}</h1></main></body></html>`);
    });
    originBase = await listen(origin);
  }
  await startOrigin('v1');

  const records = new Map();
  let transaction = Promise.resolve();
  const storage = {
    async get(key) { return structuredClone(records.get(key)); },
    async put(key, value) { records.set(key, structuredClone(value)); },
    transaction(callback) {
      const result = transaction.then(() => callback(storage));
      transaction = result.catch(() => {});
      return result;
    },
  };
  const env = {
    PUBLIC_HOSTS: '127.0.0.1', STATUS_HOST: 'status.example.test', CONTROL_HOST: 'ops.example.test',
    MAINTENANCE_CONTROL_TOKEN: TOKEN, STATUS_URL: '', CONTACT_TEXT: 'help@example.test',
  };
  const durable = new MaintenanceState({ storage }, env);
  env.MAINTENANCE = { idFromName: name => name, get: () => durable };

  async function originFetch(incoming) {
    forwardAttempts++;
    const url = new URL(incoming.url), headers = new Headers(incoming.headers);
    for (const name of HOP_HEADERS) headers.delete(name);
    const options = { method: incoming.method, headers, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(incoming.method)) { options.body = incoming.body; options.duplex = 'half'; }
    // A single real fetch transfers the untouched application body stream to
    // the isolated source server. The listener remains closed during outages.
    return fetch(originBase + url.pathname + url.search, options);
  }
  const edge = createServer(async (incoming, outgoing) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const options = { method: incoming.method, headers };
      if (!['GET', 'HEAD'].includes(incoming.method)) { options.body = Readable.toWeb(incoming); options.duplex = 'half'; }
      const request = new Request(`http://${incoming.headers.host}${incoming.url}`, options);
      const response = await handleFetch(request, env, originFetch);
      outgoing.writeHead(response.status, Object.fromEntries([...response.headers].filter(([name]) => !HOP_HEADERS.includes(name))));
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
    } catch (error) {
      serverErrors.push(error.message);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'text/plain' });
      outgoing.end('Isolated edge fixture failed');
    }
  });
  const base = await listen(edge);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, timeout: 30000,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  } catch (error) { await close(edge); await close(origin); throw error; }

  async function status() {
    const response = await fetch(base + '/__maintenance/status');
    assert.equal(response.status, 200);
    return response.json();
  }
  async function update(mode, changes = {}) {
    const before = await status();
    const state = { ...before, mode, incident_id: 'http-browser-acceptance', title: mode === 'normal' ? '' : 'VPS patch acceptance',
      message: mode === 'normal' ? '' : 'The source VPS is offline. <img src=x onerror=alert(1)>',
      starts_at: '2026-10-26T00:00:00Z', next_update_at: null, expected_end_at: null, ...changes };
    const response = await virtualHostRequest(base + '/__maintenance/control', { method: 'POST',
      headers: { Host: 'ops.example.test', 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ expected_revision: before.revision, state }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.revision, before.revision + 1);
    return result;
  }
  return {
    base, browser, originRequests, serverErrors, status, update,
    get forwardAttempts() { return forwardAttempts; },
    async stopOrigin() { await close(origin); },
    async restartOrigin(version) { await startOrigin(version); },
    async stop() { await browser.close(); await close(edge); await close(origin); },
  };
}

test('real HTTP edge survives a closed source listener, serves six no-JS locales, and restores a new source revision', async t => {
  const fixture = await createFixture();
  const contexts = [];
  t.after(async () => {
    try { for (const context of contexts) await context.close(); }
    finally { await fixture.stop(); }
  });
  const context = await fixture.browser.newContext({ javaScriptEnabled: false });
  contexts.push(context);
  const browserRequests = [], externalRequests = [], pageErrors = [];
  context.on('request', incoming => browserRequests.push({ url: incoming.url(), type: incoming.resourceType() }));
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === fixture.base) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(8000);

  const normal = await page.goto(fixture.base + '/app/start/', { waitUntil: 'networkidle' });
  assert.equal(normal.status(), 200);
  assert.equal(normal.headers()['x-origin-version'], 'v1');
  assert.equal(await page.locator('h1').innerText(), 'REAL ORIGIN v1');
  assert.ok((await context.cookies()).some(cookie => cookie.name === 'fells_edge_fixture' && cookie.httpOnly && cookie.value === PRIVATE_COOKIE));

  const maintenance = await fixture.update('maintenance');
  assert.equal(maintenance.revision, 1);
  const beforeOutage = fixture.forwardAttempts, beforeBrowser = browserRequests.length;
  await fixture.stopOrigin();
  for (const [prefix, language] of [['', 'en'], ['/zh', 'zh'], ['/zh-hant', 'zh-hant'], ['/ja', 'ja'], ['/ko', 'ko'], ['/es', 'es']]) {
    const response = await page.goto(fixture.base + prefix + '/app/saved/deep-link', { waitUntil: 'networkidle' });
    assert.equal(response.status(), 503);
    assert.equal(response.headers()['cache-control'], 'no-store');
    assert.equal(response.headers()['retry-after'], '60');
    assert.equal(response.headers()['x-fells-maintenance'], '1');
    assert.equal(response.headers()['set-cookie'], undefined);
    assert.match(response.headers()['content-security-policy'], /default-src 'none'; style-src 'sha256-/);
    assert.equal(await page.locator('html').getAttribute('lang'), language);
    assert.equal(await page.locator('h1').innerText(), 'VPS patch acceptance');
    assert.match(await page.locator('main p').innerText(), /source VPS is offline/);
    assert.match(await page.locator('main p').innerText(), /<img src=x/);
    assert.equal(await page.locator('script, img, link, iframe').count(), 0);
    const html = await response.text();
    assert.equal(html.includes(PRIVATE_COOKIE), false);
    assert.equal(html.includes(TOKEN), false);
  }
  const home = await page.goto(fixture.base + '/', { waitUntil: 'networkidle' });
  assert.equal(home.status(), 503);
  assert.equal(fixture.forwardAttempts, beforeOutage, 'all maintenance documents must be served without contacting the stopped origin');
  assert.equal(browserRequests.slice(beforeBrowser).some(incoming => ['script', 'stylesheet', 'font', 'image', 'fetch', 'xhr'].includes(incoming.type)), false);
  assert.deepEqual(externalRequests, []);

  const api = await fetch(fixture.base + '/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `fells_edge_fixture=${PRIVATE_COOKIE}` }, body: JSON.stringify({ model: 'isolated', messages: ['private prompt'] }) });
  assert.equal(api.status, 503);
  assert.equal(api.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(api.headers.get('Cache-Control'), 'no-store');
  assert.equal(api.headers.get('Retry-After'), '60');
  assert.equal(api.headers.get('Set-Cookie'), null);
  const refusal = await api.json();
  assert.equal(refusal.error.code, 'service_maintenance');
  assert.equal(refusal.transaction_rejected, true);
  assert.equal(refusal.maintenance.revision, 1);
  assert.equal(JSON.stringify(refusal).includes(PRIVATE_COOKIE), false);
  assert.equal(JSON.stringify(refusal).includes('private prompt'), false);
  assert.equal(fixture.forwardAttempts, beforeOutage, 'a rejected API request must not dispatch');

  const independentStatus = await virtualHostRequest(fixture.base + '/zh/', { headers: { Host: 'status.example.test' } });
  assert.equal(independentStatus.status, 200);
  assert.match(await independentStatus.text(), /VPS patch acceptance/);
  const current = await fixture.status();
  assert.equal(current.mode, 'maintenance');

  const secureContext = await fixture.browser.newContext();
  contexts.push(secureContext);
  await trackCoverage(secureContext);
  const securePage = await secureContext.newPage();
  await securePage.goto(fixture.base + '/zh/app/', { waitUntil: 'networkidle' });
  assert.equal(await securePage.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(9, 11, 14)', 'the exact CSP style hash must allow the announcement CSS');
  const violation = await securePage.evaluate(() => new Promise(resolve => {
    const deadline = setTimeout(() => resolve('no-violation'), 1500);
    document.addEventListener('securitypolicyviolation', event => { clearTimeout(deadline); resolve(event.effectiveDirective); }, { once: true });
    const script = document.createElement('script'); script.textContent = 'window.__fellsUnsafeAnnouncement = true'; document.head.append(script);
  }));
  assert.match(violation, /script-src/);
  assert.equal(await securePage.evaluate(() => window.__fellsUnsafeAnnouncement), undefined);
  // Clear only the persisted notice while the real source remains stopped:
  // normal routing must discover the actual connection refusal and fall back.
  const normalWhileOffline = await fixture.update('normal');
  assert.equal(normalWhileOffline.revision, 2);
  const fallback = await page.goto(fixture.base + '/app/deep/offline', { waitUntil: 'networkidle' });
  assert.equal(fallback.status(), 503);
  assert.match(await page.locator('h1').innerText(), /temporarily unavailable/);
  assert.equal(fixture.forwardAttempts, beforeOutage + 1, 'an unreachable origin must not be replayed');
  assert.equal((await fixture.status()).mode, 'normal', 'a single failed navigation must not overwrite authoritative state');

  await fixture.restartOrigin('v2');
  assert.equal((await fixture.update('recovering')).revision, 3);
  assert.equal((await page.goto(fixture.base + '/app/')).status(), 503);
  const reopened = await fixture.update('normal');
  assert.equal(reopened.revision, 4);
  const restored = await page.goto(fixture.base + '/app/restored', { waitUntil: 'networkidle' });
  assert.equal(restored.status(), 200);
  assert.equal(restored.headers()['x-origin-version'], 'v2');
  assert.equal(await page.locator('h1').innerText(), 'REAL ORIGIN v2');
  assert.ok(fixture.originRequests.at(-1).cookie.includes(PRIVATE_COOKIE), 'normal proxying preserves the real HTTP-only session cookie');
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(fixture.serverErrors, []);
});
