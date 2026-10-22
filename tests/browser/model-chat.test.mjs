import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const key = { id: 17, name: 'Existing personal key', prefix: 'sk-existing…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000, limit: 0 };
async function open(t, options = {}, configure) {
  const session = await fixture.setup(t);
  const backend = createAppBackend({ preferences, modelChat: true, keys: [{ ...key }],
    workspaces: [{ id: 'chat-space', name: 'Shared workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }], ...options });
  await backend.install(session.context);
  await configure?.({ ...session, backend });
  await session.page.goto(session.base + '/app/#/new');
  return { ...session, backend };
}
const ready = page => page.locator('#fx-input:not([disabled])').waitFor();
async function send(page, text) { await page.locator('#fx-input').fill(text); await page.locator('[data-form=send] .send').click(); }
async function idle(page) { await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true'); }

test('web conversation sends canonical IDs with an existing key and shows only server-generated replies', async t => {
  const { page, backend, errors } = await open(t, { assistantReply: '<svg onload="window.__forged=1">server text</svg>' });
  await ready(page);
  assert.equal(await page.locator('[data-input=chatKey]').inputValue(), '17');
  assert.match(await page.locator('#fx-main').innerText(), /does not run a CLI, terminal/);
  assert.equal(await page.locator('.strip').innerText(), 'Conversations are saved in the workspace. Model calls are billed to the selected key.');
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /Agent execution is not configured/);
  assert.equal(await page.locator('.agent-tabs').count(), 0);
  await send(page, '<img src=x onerror="window.__forged=2">User text');
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.equal(await page.locator('.strip').innerText(), 'Conversations are saved in the workspace. Model calls are billed to the selected key.');
  assert.equal(backend.state.generations.length, 1);
  const request = backend.state.generations[0];
  assert.equal(request.model, 'server/text-model-v2'); assert.equal(request.key_id, 17);
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

test('a disconnected paid response survives reload and is resolved by GET without another generation', async t => {
  const { page, backend, errors } = await open(t, {}, async ({ context, backend }) => {
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
  assert.equal(backend.state.generations.length, 1);
  const [request] = backend.state.generations, chat = backend.state.chats[0];
  chat.messages.push(['assistant', 'Recovered server completion']);
  backend.state.chatRuns[request.request_id] = { request_id: request.request_id, status: 'completed', message_id: `${chat.id}-m2` };
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Recovered server completion');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
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

test('model routes reload for the selected personal key without using CLI, revoked, or expired keys', async t => {
  const keys = [{ ...key, id: 1, kind: 'cli' }, { ...key, id: 2, revoked: true }, { ...key, id: 3, expires_at: 1 }, key, { ...key, id: 18, name: 'Private scope key' }];
  const { page, backend, errors } = await open(t, { keys }, async ({ context }) => {
    await context.route('**/api/app/chat-models?*', route => {
      const id = Number(new URL(route.request().url()).searchParams.get('key_id'));
      return route.fulfill({ json: { key_id: id, capability: 'model_chat', models: [{ model: `private/key-${id}-model`, label: `Model for key ${id}`, format: 'openai-responses', formats: ['openai-responses'] }] } });
    });
  });
  await ready(page); assert.equal(await page.locator('[data-input=chatKey] option').count(), 2);
  await page.locator('[data-input=chatKey]').selectOption('18'); await ready(page);
  await page.locator('.model-btn').filter({ hasText: 'Model for key 18' }).waitFor();
  await send(page, 'Use this private route'); await page.locator('[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations[0].key_id, 18); assert.equal(backend.state.generations[0].model, 'private/key-18-model');
  assert.deepEqual(errors, []);
});

for (const status of ['loading', 'error', 'empty', 'no-key']) test(`conversation catalog ${status} does not invent a runnable model`, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { page, backend, errors } = await open(t, status === 'no-key' ? { keys: [] } : {}, async ({ context }) => {
    await context.route('**/api/app/chat-models?*', async route => {
      if (status === 'loading') await gate;
      await route.fulfill(status === 'error' ? { status: 503, json: { error: 'Catalog unavailable' } } : { json: { capability: 'model_chat', key_id: 17, models: [] } });
    });
  });
  const text = status === 'loading' ? 'Loading available models' : status === 'error' ? 'could not be loaded' : status === 'empty' ? 'no available web text models' : 'Configure an active personal key';
  await page.locator('.chat-model-state').filter({ hasText: text }).waitFor();
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(backend.state.generations.length, 0);
  if (status === 'loading') { release(); await page.locator('.chat-model-state').filter({ hasText: 'no available web text models' }).waitFor(); }
  assert.deepEqual(errors, []);
});

test('workspace viewers can read generated history and cannot start paid generation', async t => {
  const { page, backend, errors } = await open(t, { workspaces: [{ id: 'chat-space', name: 'Read only', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'viewer' }] });
  await page.locator('.model-btn').filter({ hasText: 'Server text model' }).waitFor();
  assert.equal(await page.locator('#fx-input').isDisabled(), true);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('changing keys during a pending catalog read cannot adopt the previous key routes', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; }), reads = [];
  const { page, backend, errors } = await open(t, { keys: [key, { ...key, id: 18, name: 'Second key' }] }, async ({ context, page }) => {
    await context.route('**/api/app/chat-models?*', async route => {
      const id = Number(new URL(route.request().url()).searchParams.get('key_id')); reads.push(id);
      if (id === 17) { await page.evaluate(() => { window.__catalog17Started = true; }); await gate; }
      await route.fulfill({ json: { key_id: id, capability: 'model_chat', models: [{ model: `key-${id}-only`, label: `Route for key ${id}`, format: 'openai-completions', formats: ['openai-completions'] }] } });
    });
  });
  await page.waitForFunction(() => window.__catalog17Started === true);
  await page.locator('[data-input=chatKey]').selectOption('18'); release();
  await page.locator('.model-btn').filter({ hasText: 'Route for key 18' }).waitFor(); await ready(page);
  await send(page, 'Use the latest chosen scope'); await page.locator('[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations[0].key_id, 18); assert.equal(backend.state.generations[0].model, 'key-18-only');
  assert.deepEqual(reads, [17, 18]); assert.deepEqual(errors, []);
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
