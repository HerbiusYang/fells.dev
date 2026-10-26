import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const key = { id: 17, name: 'Existing personal key', prefix: 'sk-existing…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000, limit: 0 };
async function open(t, options = {}, configure) {
  const session = await fixture.setup(t);
  const backend = createAppBackend({ preferences, modelChat: true, keys: [],
    workspaces: [{ id: 'chat-space', name: 'Shared workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }], ...options });
  await backend.install(session.context);
  await configure?.({ ...session, backend });
  await session.page.goto(session.base + '/app/#/new');
  return { ...session, backend };
}
const ready = page => page.locator('#fx-input:not([disabled])').waitFor();
async function send(page, text) { await page.locator('#fx-input').fill(text); await page.locator('[data-form=send] .send').click(); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }

test('a zero-key account sends canonical IDs from account allowance and shows only server-generated replies', async t => {
  const { page, backend, errors } = await open(t, { assistantReply: '<svg onload="window.__forged=1">server text</svg>' });
  await ready(page);
  assert.equal(await page.locator('[data-input=chatKey],.chat-key-toolbar').count(), 0);
  assert.equal(await page.locator('.model-chat-welcome h2').innerText(), 'Start a conversation');
  assert.match(await page.locator('.chat-billing-note').innerText(), /account's USD API allowance.*\$9\.00/);
  assert.equal(await page.locator('.strip,.chat-execution-note').count(), 0);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /CLI|terminal|file tools|cloud computer/);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /Agent execution is not configured/);
  assert.equal(await page.locator('.agent-tabs').count(), 0);
  await send(page, '<img src=x onerror="window.__forged=2">User text');
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.match(await page.locator('.chat-billing-note').innerText(), /account's USD API allowance.*\$9\.00/);
  assert.equal(await page.locator('.strip,.chat-execution-note').count(), 0);
  assert.equal(backend.state.generations.length, 1);
  const request = backend.state.generations[0];
  assert.equal(request.model, 'server/text-model-v2');
  assert.equal(request.billing_mode, 'account_allowance');
  assert.equal(Object.hasOwn(request, 'key_id'), false);
  assert.deepEqual(backend.state.keys, []);
  assert.ok(backend.state.modelReads.length > 0 && backend.state.modelReads.every(id => id === 0), 'the account model catalog never selects a key');
  assert.match(request.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(request.headers['x-fells-expected-user'], '42'); assert.equal(request.headers['x-fells-expected-session'], 'c'.repeat(64));
  assert.deepEqual(backend.state.writes.find(write => write.path === '/api/app/chats').body.messages, [], 'a new chat is created empty; generate owns its user message');
  assert.equal(backend.state.writes.some(write => /\/messages$/.test(write.path)), false, 'the browser never stores a fabricated assistant reply');
  assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false, 'chat never creates a hidden key');
  assert.equal(await page.locator('.msg-body').count(), 2);
  assert.equal(await page.locator('.msg-body svg,.msg-body img').count(), 0);
  assert.equal(await page.evaluate(() => window.__forged), undefined);
  assert.equal(await page.locator('#fx-input').inputValue(), '');
  await page.reload(); await page.locator('.msg-body').filter({ hasText: 'server text' }).waitFor();
  assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('account generation request IDs remain idempotent and bound to their chat and body', async t => {
  const { page, backend, errors } = await open(t);
  await ready(page); await send(page, 'Charge this account request once');
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  const first = backend.state.generations[0];
  backend.state.chats.push({ id: 'other-chat', ws: 'chat-space', title: 'Other chat', agent: 'codex', model: first.model, created: 1700000000000, messages: [] });
  const statuses = await page.evaluate(async request => {
    const headers = { 'Content-Type': 'application/json', 'X-Fells-Expected-User': '42', 'X-Fells-Expected-Session': 'c'.repeat(64) };
    const body = { request_id: request.request_id, body: request.body, model: request.model, billing_mode: 'account_allowance' };
    const post = (chatID, payload) => fetch(`/api/app/chats/${chatID}/generate`, { method: 'POST', headers, body: JSON.stringify(payload) }).then(response => response.status);
    return [await post(request.chat_id, body), await post(request.chat_id, { ...body, body: 'Different instruction' }),
      await post('other-chat', body), await fetch(`/api/app/chats/other-chat/runs/${request.request_id}`, { headers }).then(response => response.status)];
  }, first);
  assert.deepEqual(statuses, [200, 409, 409, 404]);
  assert.equal(backend.state.generations.length, 1);
  assert.equal(backend.state.chats[0].messages.length, 2);
  assert.deepEqual(backend.state.chats[1].messages, []);
  assert.deepEqual(backend.state.keys, []); assert.deepEqual(errors, []);
});

test('a disconnected paid response survives reload and is resolved by GET without another generation', async t => {
  const statusMethods = [];
  const { page, backend, errors } = await open(t, {}, async ({ context, backend }) => {
    await context.route('**/api/app/chats/*/runs/*', route => { statusMethods.push(route.request().method()); return route.fallback(); });
    await context.route('**/api/app/chats/*/generate', async route => {
      const input = route.request().postDataJSON(), chatID = new URL(route.request().url()).pathname.split('/')[4];
      const chat = backend.state.chats.find(c => c.id === chatID);
      chat.model = input.model; chat.messages.push(['you', input.body]);
      backend.state.generations.push(input); backend.state.chatRuns[input.request_id] = { request_id: input.request_id, status: 'running' };
      await route.abort('failed');
    });
  });
  await ready(page); await send(page, 'Do not charge twice for this instruction');
  await page.locator('[data-run-status=unknown]').waitFor(); await idle(page);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.match(await page.locator('.chat-run-status').innerText(), /may have run and been charged/);
  await page.reload(); await page.locator('[data-run-status=unknown]').waitFor(); await idle(page);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true, 'reload preserves the unresolved paid request marker');
  assert.equal(backend.state.generations.length, 1);
  const [request] = backend.state.generations, chat = backend.state.chats[0];
  chat.messages.push(['assistant', 'Recovered server completion']);
  backend.state.chatRuns[request.request_id] = { request_id: request.request_id, status: 'completed', message_id: `${chat.id}-m2` };
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Recovered server completion');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
  assert.deepEqual(statusMethods, ['GET'], 'the explicit check is a single read, never a paid retry');
  assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

for (const explicit of [false, true]) test(`a no-run refusal ${explicit ? 'with chat_not_started releases' : 'without an explicit non-dispatch code retains'} the request marker`, async t => {
  const { page, backend, errors } = await open(t, {}, async ({ context }) => {
    await context.route('**/api/app/chats/*/generate', route => route.fulfill({ status: 403, json: { error: 'Request refused', ...(explicit ? { code: 'chat_not_started' } : {}) } }));
  });
  await ready(page); await send(page, 'Keep this draft until the server confirms');
  await page.locator(`[data-run-status=${explicit ? 'failed' : 'unknown'}]`).waitFor(); await idle(page);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), !explicit);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this draft until the server confirms');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const scenario of ['valid-unknown', 'valid-failed', 'expired', 'replacement']) test(`a generation 401 verifies the current cookie before handling its run: ${scenario}`, async t => {
  let returned = false, verificationReads = 0;
  const status = scenario === 'valid-failed' ? 'failed' : 'unknown';
  const { page, backend, errors } = await open(t, {}, async ({ context, backend }) => {
    await context.route('**/api/app/bootstrap', route => { if (returned) verificationReads++; return route.fallback(); });
    // Keep the entry document stable so this test observes session termination,
    // independently of the sign-in page's own existing-session redirect.
    await context.route('**/app/start/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
    await context.route('**/api/app/chats/*/generate', async route => {
      const input = route.request().postDataJSON(), chatID = new URL(route.request().url()).pathname.split('/')[4];
      const chat = backend.state.chats.find(item => item.id === chatID);
      chat.messages.push(['you', input.body]); backend.state.generations.push(input);
      const run = backend.state.chatRuns[input.request_id] = { request_id: input.request_id, status, error_code: 'upstream_unauthorized' };
      if (scenario === 'expired') backend.state.signedIn = false;
      if (scenario === 'replacement') { backend.state.sessionID = 'd'.repeat(64); backend.state.userID = 43; }
      returned = true;
      await route.fulfill({ status: 401, json: { error: 'Provider authentication failed', run } });
    });
  });
  await ready(page); await send(page, 'Private instruction with an upstream authentication failure');
  if (scenario.startsWith('valid-')) {
    await page.locator(`[data-run-status=${status}]`).waitFor(); await idle(page);
    assert.equal(await page.locator('.msg-body').innerText(), 'Private instruction with an upstream authentication failure');
    assert.equal(await page.locator('[data-form=send] .send').isDisabled(), status === 'unknown');
    assert.equal(await page.locator('.chat-billing-note').count(), 1); assert.ok(verificationReads >= 1);
    if (status === 'unknown') {
      await page.reload(); await page.locator('[data-run-status=unknown]').waitFor();
      await page.locator('[data-act=chat-check]').click(); await idle(page);
      assert.equal(await page.locator('[data-run-status=unknown]').count(), 1);
    }
  } else {
    await page.waitForURL(/\/app\/start\/?$/);
    assert.equal((await page.content()).includes('Private instruction'), false);
    const retained = await page.evaluate(() => JSON.parse(sessionStorage.getItem(`fells.chat-run.v1:42:${'c'.repeat(64)}`)));
    assert.equal(retained.length, 1); assert.equal(retained[0].status, 'pending', 'an unverified 401 cannot consume the old account request marker');
    assert.ok(verificationReads >= 1);
  }
  assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('account model routes never depend on personal, CLI, revoked or expired keys', async t => {
  const keys = [{ ...key, id: 1, kind: 'cli' }, { ...key, id: 2, revoked: true }, { ...key, id: 3, expires_at: 1 }, key, { ...key, id: 18, name: 'Private scope key' }];
  const reads = [];
  const { page, backend, errors } = await open(t, { keys }, async ({ context }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => {
      reads.push(route.request().url());
      return route.fulfill({ json: { billing_mode: 'account_allowance', capability: 'model_chat', models: [{ model: 'account/text-model', label: 'Account model', format: 'openai-responses', formats: ['openai-responses'] }] } });
    });
  });
  await ready(page); assert.equal(await page.locator('[data-input=chatKey],.chat-key-toolbar').count(), 0);
  await page.locator('.model-btn').filter({ hasText: 'Account model' }).waitFor();
  await send(page, 'Use the account route'); await page.locator('[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations[0].billing_mode, 'account_allowance');
  assert.equal(Object.hasOwn(backend.state.generations[0], 'key_id'), false);
  assert.equal(backend.state.generations[0].model, 'account/text-model');
  assert.ok(reads.length > 0 && reads.every(url => !new URL(url).searchParams.has('key_id')));
  assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false);
  assert.deepEqual(errors, []);
});

for (const status of ['loading', 'error', 'empty', 'wrong-key-scope']) test(`conversation catalog ${status} does not invent a runnable model`, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { page, backend, errors } = await open(t, {}, async ({ context }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, async route => {
      if (status === 'loading') await gate;
      await route.fulfill(status === 'error' ? { status: 503, json: { error: 'Catalog unavailable' } } : { json: { capability: 'model_chat', billing_mode: 'account_allowance', ...(status === 'wrong-key-scope' ? { key_id: 17 } : {}), models: [] } });
    });
  });
  const modelState = status === 'wrong-key-scope' ? 'error' : status;
  await page.locator(`.chat-model-state[data-model-state=${modelState}]`).waitFor();
  const label = status === 'loading' ? 'Loading models…' : modelState === 'error' ? 'Models unavailable' : 'No available models';
  assert.equal(await page.locator('.model-btn').innerText(), label);
  assert.equal(await page.locator('.model-btn').isDisabled(), true);
  if (status !== 'loading') assert.doesNotMatch(await page.locator('.dock').innerText(), /Loading/);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(backend.state.generations.length, 0);
  if (status === 'loading') {
    release(); await page.locator('.chat-model-state').filter({ hasText: 'no available models' }).waitFor();
    assert.equal(await page.locator('.model-btn').innerText(), 'No available models');
    assert.doesNotMatch(await page.locator('.dock').innerText(), /Loading/);
  }
  assert.deepEqual(errors, []);
});

for (const width of [320, 390, 768, 1280]) test(`account billing and conversation controls fit without clipping at viewport width ${width}`, async t => {
  const { page, backend, errors } = await open(t, {
    keys: [{ ...key, name: 'A very long personal key name for a shared conversation workspace', prefix: 'sk-ap-really-long-prefix…' }],
    chatModels: [{ model: 'scope/a-long-canonical-model-route-for-conversations', label: 'A long model display name that still fits the composer', formats: ['openai-responses'], format: 'openai-responses' }],
  }, async ({ page }) => page.setViewportSize({ width, height: 820 }));
  await ready(page);
  const boxes = await page.evaluate(() => {
    const rect = selector => { const box = document.querySelector(selector).getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }; };
    return { toolbar: rect('.composer .tools'), billing: rect('.chat-billing-note'), reload: rect('.chat-billing-note button'), model: rect('.model-btn'), send: rect('[data-form=send] .send'), viewport: innerWidth };
  });
  assert.ok(boxes.toolbar.left >= 0 && boxes.toolbar.right <= boxes.viewport, 'toolbar fits the viewport');
  assert.ok(boxes.billing.left >= 0 && boxes.billing.right <= boxes.viewport, 'account allowance caption fits the viewport');
  assert.ok(boxes.reload.height > 0 && boxes.reload.right <= boxes.billing.right + 1, 'reload stays visible');
  assert.ok(boxes.model.right <= boxes.send.left && boxes.send.right <= boxes.toolbar.right + 1, 'model and send controls do not overlap');
  assert.equal(await page.locator('[data-input=chatKey],.chat-key-toolbar').count(), 0);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('reloading models immediately shows loading, then empty, without losing an unsent draft', async t => {
  let release, reads = 0; const gate = new Promise(resolve => { release = resolve; });
  const { page, backend, errors } = await open(t, {}, async ({ context, backend }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, async route => {
      if (++reads === 1) return route.fulfill({ json: { capability: 'model_chat', billing_mode: 'account_allowance', models: backend.state.chatModels } });
      await gate; return route.fulfill({ json: { capability: 'model_chat', billing_mode: 'account_allowance', models: [] } });
    });
  });
  await ready(page); await page.locator('#fx-input').fill('Keep this draft while models refresh');
  await page.getByRole('button', { name: 'Reload models', exact: true }).click();
  await page.locator('.chat-model-state[data-model-state=loading]').waitFor();
  assert.equal(await page.locator('.model-btn').innerText(), 'Loading models…');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this draft while models refresh');
  release(); await page.locator('.chat-model-state[data-model-state=empty]').waitFor();
  assert.equal(await page.locator('.model-btn').innerText(), 'No available models');
  assert.doesNotMatch(await page.locator('.dock').innerText(), /Loading|Server text model/);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this draft while models refresh');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('workspace viewers can read generated history and cannot start paid generation', async t => {
  const { page, backend, errors } = await open(t, { workspaces: [{ id: 'chat-space', name: 'Read only', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'viewer' }] });
  await page.locator('.model-btn').filter({ hasText: 'Server text model' }).waitFor();
  assert.equal(await page.locator('#fx-input').isDisabled(), true);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a pending account catalog cannot leak its routes into a replacement session', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }), reads = [];
  const { page, backend, errors } = await open(t, {}, async ({ context, page, backend }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, async route => {
      const userID = backend.state.userID;
      reads.push({ userID, url: route.request().url() });
      if (userID === 42) { await page.evaluate(() => { window.__previousCatalogStarted = true; }); await gate; }
      await route.fulfill({ json: { billing_mode: 'account_allowance', capability: 'model_chat', models: [{ model: `account-${userID}-only`, label: `Account ${userID} model`, format: 'openai-completions', formats: ['openai-completions'] }] } }).catch(() => {});
    });
  });
  await page.waitForFunction(() => window.__previousCatalogStarted === true);
  backend.state.userID = 43; backend.state.sessionID = 'd'.repeat(64);
  await page.reload();
  await page.locator('.model-btn').filter({ hasText: 'Account 43 model' }).waitFor(); await ready(page);
  release();
  await send(page, 'Use the current account only'); await page.locator('[data-run-status=completed]').waitFor();
  const request = backend.state.generations[0];
  assert.equal(request.billing_mode, 'account_allowance'); assert.equal(Object.hasOwn(request, 'key_id'), false);
  assert.equal(request.model, 'account-43-only');
  assert.equal(request.headers['x-fells-expected-user'], '43'); assert.equal(request.headers['x-fells-expected-session'], 'd'.repeat(64));
  assert.deepEqual(reads.map(read => read.userID), [42, 43]);
  assert.ok(reads.every(read => !new URL(read.url).searchParams.has('key_id')));
  assert.doesNotMatch(await page.locator('.dock').innerText(), /Account 42 model/);
  assert.deepEqual(errors, []);
});

test('blocked request-marker storage prevents a paid model request and retains the draft', async t => {
  const { page, backend, errors } = await open(t, {}, async ({ page }) => {
    await page.addInitScript(() => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name, value) {
        if (name.startsWith('fells.chat-run.v1:')) throw new DOMException('Blocked', 'SecurityError');
        return write.call(this, name, value);
      };
    });
  });
  await ready(page); await send(page, 'Keep this unsubmitted draft');
  await page.locator('.toast').filter({ hasText: 'no model request was sent' }).waitFor(); await idle(page);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this unsubmitted draft');
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.chats[0].messages.length, 0);
  assert.deepEqual(errors, []);
});

test('a rejected empty-chat creation restores the composer before any paid model call', async t => {
  const { page, backend, errors } = await open(t, { failChatWrites: true });
  await ready(page); await send(page, 'Keep the draft when chat creation fails'); await idle(page);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep the draft when chat creation fails');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.chats.length, 0);
  backend.state.failChatWrites = false;
  await page.locator('[data-form=send] .send').click();
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.equal(backend.state.generations.length, 1);
  assert.equal(backend.state.generations[0].body, 'Keep the draft when chat creation fails');
  assert.deepEqual(errors, []);
});
