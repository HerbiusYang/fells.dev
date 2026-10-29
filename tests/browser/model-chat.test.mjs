import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };
const key = { id: 17, name: 'Existing personal key', prefix: 'sk-existing…', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000, limit: 0 };
const cliOnlyCatalog = () => ({ capability: 'model_chat', billing_mode: 'account_allowance', models: [], diagnostics: {
  reason: 'claude_code_only', counts: { visible_models: 1, priced_models: 1, permitted_models: 1, web_models: 0, claude_code_only_models: 1, unsupported_provider_models: 0, no_route_models: 0 },
} });
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

const recoveryID = '6c49d206-09f1-4f96-94b6-78e09213cde0';
const recoveryChat = () => ({ id: 'recovery-chat', ws: 'chat-space', title: 'Recover saved reply', agent: 'lite', model: 'server/text-model-v2', created: 1700000000000,
  messages: [['you', 'Original bound instruction'], ['assistant', 'Exact saved reply']],
  message_metadata: [{ id: 'recovery-user', created: 1700000000000, imported: false, author_user_id: 42, author_name: 'UI user' }, { id: 'recovery-assistant', created: 1700000002400, imported: false }] });
const recoveryRun = () => ({ id: 'recovery-run', chat_id: 'recovery-chat', request_id: recoveryID, status: 'completed', message_id: 'recovery-user', assistant_message_id: 'recovery-assistant', created: 1700000000000, updated: 1700000002400 });
async function storedRecovery(t, { chat = recoveryChat(), run = recoveryRun(), marker = {}, extraChats = [] } = {}) {
  const checks = [];
  const session = await open(t, { chats: [chat, ...extraChats], chatRuns: { [recoveryID]: run } }, async ({ page, context }) => {
    await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
    await context.addInitScript(({ requestID, marker }) => sessionStorage.setItem(`fells.chat-run.v1:42:${'c'.repeat(64)}`, JSON.stringify([{ chat_id: 'recovery-chat', request_id: requestID, status: 'unknown', ...marker }])), { requestID: recoveryID, marker });
    await context.route('**/api/app/chats/*/runs/*', route => { checks.push(route.request().method()); return route.fallback(); });
  });
  await session.page.locator('[data-go="chat/recovery-chat"]').click();
  await session.page.locator('[data-chat-run]').waitFor();
  return { ...session, checks };
}
async function completedWithHistoryFailure(t, legacy = false) {
  let failHistory = false;
  const checks = [];
  const chat = { ...recoveryChat(), messages: [], message_metadata: [] };
  const session = await open(t, { chats: [chat] }, async ({ page, context, backend }) => {
    await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
    await context.route('**/api/app/workspaces/*/chats', route => {
      if (failHistory) { failHistory = false; return route.fulfill({ status: 503, json: { error: 'Synthetic history refresh unavailable' } }); }
      return route.fallback();
    });
    await context.route('**/api/app/chats/*/runs/*', route => { checks.push(route.request().method()); return route.fallback(); });
    await context.route('**/api/app/chats/*/generate', route => {
      const input = route.request().postDataJSON();
      backend.state.generations.push(input);
      const stored = backend.state.chats[0]; Object.assign(stored, recoveryChat()); stored.messages[0][1] = input.body;
      const run = backend.state.chatRuns[input.request_id] = legacy ? { request_id: input.request_id, status: 'completed', message_id: 'recovery-assistant' } : { ...recoveryRun(), request_id: input.request_id };
      failHistory = true;
      return route.fulfill({ json: { run } });
    });
  });
  await session.page.locator('[data-go="chat/recovery-chat"]').click(); await ready(session.page);
  await send(session.page, 'Original bound instruction');
  await session.page.locator('[data-run-status=restoring]').waitFor();
  return { ...session, checks, failNextHistory: () => { failHistory = true; } };
}

test('a completed receipt keeps its meaning through a history error and a background refresh recovers its exact reply', async t => {
  const { page, backend, errors, checks } = await completedWithHistoryFailure(t);
  assert.match(await page.locator('.chat-run-status').innerText(), /Reply completed/);
  assert.doesNotMatch(await page.locator('.chat-run-status').innerText(), /unconfirmed|may have run|charged/);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  await page.locator('#fx-input').fill('Preserve my next draft');
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(await page.locator('.chat-run-status').count(), 0);
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Exact saved reply');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Preserve my next draft');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
  assert.deepEqual(checks, [], 'the fresh completion and its exact recovered history need no further status call');
  assert.equal(backend.state.generations.length, 1);
  assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem(`fells.chat-run.v1:42:${'c'.repeat(64)}`))), []);
  assert.deepEqual(errors, []);
});

test('a restored completed marker needs a fresh GET, then uses exact visible messages if the next history read fails', async t => {
  const { page, backend, errors, checks, failNextHistory } = await completedWithHistoryFailure(t);
  await page.reload(); await page.locator('[data-run-status=restoring]').waitFor();
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Exact saved reply');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true, 'session storage is not a fresh completion proof');
  assert.deepEqual(checks, []);
  failNextHistory();
  await page.locator('[data-act=chat-check]').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(await page.locator('.chat-run-status').count(), 0);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('a stored unknown marker never trusts visible answers until the exact run is checked by GET', async t => {
  const { page, backend, errors, checks } = await storedRecovery(t);
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Exact saved reply');
  assert.equal(await page.locator('[data-run-status=unknown]').count(), 1);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('[data-run-status=unknown]').waitFor();
  assert.deepEqual(checks, []);
  await page.locator('[data-act=chat-check]').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(await page.locator('.chat-run-status').count(), 0);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const scenario of ['wrong-user-id', 'wrong-user-role', 'missing-assistant-id', 'wrong-assistant-role', 'imported-assistant', 'assistant-before-user', 'later-unrelated-assistant', 'assistant-in-other-chat']) test(`completed recovery requires the exact user and assistant in the same chat: ${scenario}`, async t => {
  const chat = recoveryChat(), run = recoveryRun(), extraChats = [];
  if (scenario === 'wrong-user-id') run.message_id = 'some-other-user-message';
  if (scenario === 'wrong-user-role') chat.messages[0][0] = 'assistant';
  if (scenario === 'missing-assistant-id') run.assistant_message_id = 'missing-saved-message';
  if (scenario === 'wrong-assistant-role') chat.messages[1][0] = 'you';
  if (scenario === 'imported-assistant') chat.message_metadata[1].imported = true;
  if (scenario === 'assistant-before-user') { chat.messages.reverse(); chat.message_metadata.reverse(); }
  if (scenario === 'later-unrelated-assistant') { chat.message_metadata[1].id = 'unrelated-answer'; chat.messages.push(['assistant', 'Another later answer']); chat.message_metadata.push({ id: 'yet-another-answer', created: 1700000002500, imported: false }); }
  if (scenario === 'assistant-in-other-chat') { chat.messages.pop(); chat.message_metadata.pop(); extraChats.push({ ...recoveryChat(), id: 'other-chat', title: 'Different chat' }); }
  const { page, backend, errors, checks } = await storedRecovery(t, { chat, run, extraChats });
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-run-status=restoring]').waitFor();
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0);
  assert.doesNotMatch(await page.locator('.chat-run-status').innerText(), /unconfirmed|charged/);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 0);
  await page.locator('[data-go=new]').click(); await ready(page);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false, 'recovery blocks only its own conversation');
  assert.deepEqual(errors, []);
});

for (const status of ['running', 'unknown']) test(`an unrelated visible answer cannot finish a server ${status} run`, async t => {
  const { page, context, backend, errors, checks } = await storedRecovery(t, { run: { ...recoveryRun(), status }, marker: status === 'unknown' ? { server_unknown: true } : {} });
  await page.locator('[data-act=chat-check]').click();
  await page.locator(`[data-run-status=${status}]`).waitFor();
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0);
  if (status === 'unknown') {
    await page.clock.runFor(120_000); assert.deepEqual(checks, ['GET'], 'a real unknown never starts automatic retry or polling');
    await context.route('**/api/app/chats/*/runs/*', route => { checks.push(route.request().method()); return route.fulfill({ status: 503, json: { error: 'Synthetic status unavailable' } }); });
    await page.locator('[data-act=chat-check]').click(); await page.locator('[data-act=chat-check]:not([disabled])').waitFor();
    await page.clock.runFor(120_000); assert.deepEqual(checks, ['GET', 'GET'], 'a failed read cannot erase the server-unknown boundary');
  }
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const status of ['running', 'unknown']) test(`a restored completion marker obeys a fresh server ${status} receipt`, async t => {
  const { page, backend, errors, checks } = await storedRecovery(t, { run: { ...recoveryRun(), status }, marker: { ...recoveryRun(), history_pending: true } });
  assert.equal(await page.locator('[data-run-status=restoring]').count(), 1);
  await page.locator('[data-act=chat-check]').click();
  await page.locator(`[data-run-status=${status}]`).waitFor();
  assert.equal(await page.locator('[data-run-status=restoring]').count(), 0, 'a stored completion is not fresh server evidence');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a cross-chat completed receipt is rejected without clearing the original unknown marker', async t => {
  const { page, backend, errors, checks } = await storedRecovery(t, { run: { ...recoveryRun(), chat_id: 'different-chat' } });
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-act=chat-check]:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-run-status=unknown]').count(), 1);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('completed history recovery has three bounded GETs and a later status error cannot turn it into an unknown charge', async t => {
  const { page, context, backend, errors, checks } = await completedWithHistoryFailure(t);
  await page.evaluate(({ storageKey, chatID, requestID }) => {
    const marker = JSON.parse(sessionStorage.getItem(storageKey));
    if (marker.length !== 1 || marker[0].chat_id !== chatID || marker[0].request_id !== requestID || marker[0].status !== 'completed' || marker[0].history_pending !== true) throw Error('Expected this completed run to await history recovery');
    const setItem = Storage.prototype.setItem;
    window.__recoveryMarkerWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      const result = setItem.call(this, key, value);
      if (this === sessionStorage && key === storageKey) {
        const saved = JSON.parse(value);
        if (saved.length === 1 && saved[0].chat_id === chatID && saved[0].request_id === requestID && saved[0].status === 'completed' && saved[0].history_pending === true) window.__recoveryMarkerWrites++;
      }
      return result;
    };
  }, { storageKey: `fells.chat-run.v1:42:${'c'.repeat(64)}`, chatID: 'recovery-chat', requestID: backend.state.generations[0].request_id });
  await context.route('**/api/app/workspaces/*/chats', route => route.fulfill({ status: 503, json: { error: 'Synthetic history still offline' } }));
  for (const delay of [2_000, 4_000, 10_000]) {
    const before = await page.evaluate(() => window.__recoveryMarkerWrites);
    const response = page.waitForResponse('**/api/app/chats/*/runs/*');
    await page.clock.runFor(delay); await (await response).finished();
    // Automatic checks keep the button mounted and enabled. Persisting this
    // run happens after its history read, in the same turn as finally schedules
    // the next relative timer; response.finished() alone is too early.
    await page.waitForFunction(value => window.__recoveryMarkerWrites > value, before);
  }
  assert.deepEqual(checks, ['GET', 'GET', 'GET']);
  await page.clock.runFor(120_000); assert.deepEqual(checks, ['GET', 'GET', 'GET']);
  assert.equal(await page.locator('.chat-wait').count(), 0, 'exhausted background recovery is not an endless spinner');
  await context.route('**/api/app/chats/*/runs/*', route => route.fulfill({ status: 503, json: { error: 'Synthetic short status failure' } }));
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-act=chat-check]:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-run-status=restoring]').count(), 1);
  assert.doesNotMatch(await page.locator('.chat-run-status').innerText(), /unconfirmed|may have run|charged/);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('legacy completed receipts remain compatible when a fresh GET also reloads full history', async t => {
  const { page, backend, errors, checks } = await storedRecovery(t, { run: { request_id: recoveryID, status: 'completed', message_id: 'recovery-assistant' } });
  await page.locator('[data-act=chat-check]').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(await page.locator('.chat-run-status').count(), 0);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('legacy completion without a history snapshot waits for a fresh full-history GET instead of trusting an arbitrary answer', async t => {
  const { page, backend, errors, checks } = await completedWithHistoryFailure(t, true);
  const response = page.waitForResponse('**/api/app/workspaces/*/chats');
  await page.evaluate(() => dispatchEvent(new Event('focus'))); await (await response).finished();
  await page.locator('.msg-body').filter({ hasText: 'Exact saved reply' }).waitFor();
  assert.equal(await page.locator('[data-run-status=restoring]').count(), 1);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  await page.locator('[data-act=chat-check]').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('a fresh receipt can correct a stale stored server-run ID without replaying the request', async t => {
  const { page, backend, errors, checks } = await storedRecovery(t, { marker: { id: 'original-server-run' } });
  await page.locator('[data-act=chat-check]').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(await page.locator('.chat-run-status').count(), 0);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false);
  assert.deepEqual(checks, ['GET']); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a different server-run ID cannot replace an ID already verified in this page for the same request', async t => {
  const { page, backend, errors, checks } = await storedRecovery(t, { run: { ...recoveryRun(), status: 'running' }, marker: { id: 'stale-stored-id' } });
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-run-status=running]').waitFor();
  backend.state.chatRuns[recoveryID] = { ...recoveryRun(), id: 'different-server-run' };
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-act=chat-check]:not([disabled])').waitFor();
  assert.equal(await page.locator('[data-run-status=running]').count(), 1);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0);
  assert.deepEqual(checks, ['GET', 'GET']); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('an old status GET cannot replace a later request after background history restores the completed reply', async t => {
  const { page, context, backend, errors } = await completedWithHistoryFailure(t);
  const original = backend.state.generations[0], originalRun = { ...backend.state.chatRuns[original.request_id] };
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  await context.route('**/api/app/chats/*/runs/*', async route => { entered(); await gate; return route.fulfill({ json: { run: originalRun } }); });
  await context.route('**/api/app/chats/*/generate', route => {
    const input = route.request().postDataJSON(), chat = backend.state.chats[0];
    backend.state.generations.push(input); chat.messages.push(['you', input.body]);
    chat.message_metadata.push({ id: 'next-user-message', created: 1700000003000, imported: false, author_user_id: 42, author_name: 'UI user' });
    const run = backend.state.chatRuns[input.request_id] = { id: 'next-server-run', chat_id: chat.id, request_id: input.request_id, status: 'running', message_id: 'next-user-message' };
    return route.fulfill({ status: 202, json: { run } });
  });
  try {
    await page.locator('[data-act=chat-check]').click(); await began;
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.locator('.thread[data-run-status=completed]').waitFor();
    await send(page, 'A distinct next request');
    await page.locator('[data-run-status=running]').waitFor();
    const next = backend.state.generations[1]; assert.notEqual(next.request_id, original.request_id);
    const response = page.waitForResponse('**/api/app/chats/*/runs/*'); release(); await (await response).finished();
    await page.locator('[data-act=chat-check]:not([disabled])').waitFor();
    assert.equal(await page.locator('[data-run-status=running]').getAttribute('data-chat-run'), next.request_id);
    assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
    assert.equal(backend.state.generations.length, 2, 'the only two POSTs are the two deliberate user instructions');
    assert.deepEqual(errors, []);
  } finally { release(); }
});

for (const path of ['/api/app/wallet/ledger', '/api/app/coupons', '/api/app/invoices']) {
  for (const mode of ['pending', '503']) test(`chat models are ready independently of ${mode} ${path}`, { timeout: 25_000 }, async t => {
    let release, began;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { began = resolve; });
    let released = mode !== 'pending';
    const failure = `Synthetic unrelated failure: ${path}`;
    const { page, backend, errors } = await open(t, {}, async ({ context }) => {
      await context.route(url => url.pathname === path, async route => {
        began();
        if (mode === 'pending') await gate;
        await route.fulfill({ status: 503, json: { error: failure } });
      });
    });
    try {
      await requested;
      await ready(page);
      await page.locator('.chat-model-state[data-model-state=ready]').waitFor({ state: 'attached' });
      await page.locator('#fx-input').fill('My independent draft');
      assert.equal(await page.locator('[data-form=send] .send').isDisabled(), false, 'a non-chat API cannot disable a valid conversation');
      assert.deepEqual(backend.state.modelReads, [0], 'the account model catalog is loaded once');
      if (mode === 'pending') assert.equal(released, false, 'chat becomes usable while the unrelated API is still pending');
      released = true; release();
      // The visible background error proves loadAccountViews has finished its
      // complete result projection and its trailing model-load fallback ran.
      await page.evaluate(() => { location.hash = '#/billing/market'; });
      await page.locator('.market-page .note').filter({ hasText: failure }).waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(backend.state.modelReads, [0], 'background completion reuses the ready catalog');
      assert.equal(backend.state.generations.length, 0, 'checking composer readiness sends no paid request');
      assert.deepEqual(errors, []);
    } finally { release(); }
  });
}

test('a delayed model request leaves navigation, menus and next-message drafts responsive', { timeout: 25_000 }, async t => {
  let release;
  let responseReleased = false;
  const gate = new Promise(resolve => { release = resolve; });
  const { page, backend, errors } = await open(t, { chats: [{ id: 'slow-chat', ws: 'chat-space', title: 'Slow conversation', agent: 'lite', model: 'server/text-model-v2', created: 1700000000000, messages: [] }] }, async ({ context, backend }) => {
    await context.route('**/api/app/chats/*/generate', async route => {
      const input = route.request().postDataJSON(), chat = backend.state.chats[0];
      backend.state.generations.push(input); chat.messages.push(['you', input.body]);
      backend.state.chatRuns[input.request_id] = { request_id: input.request_id, status: 'running' };
      await gate; responseReleased = true;
      chat.messages.push(['assistant', backend.state.assistantReply]);
      const run = backend.state.chatRuns[input.request_id] = { request_id: input.request_id, status: 'completed', message_id: `${chat.id}-m2` };
      await route.fulfill({ json: { run } });
    });
  });
  try {
    await page.locator('[data-go="chat/slow-chat"]').click(); await ready(page);
    const began = page.waitForRequest('**/api/app/chats/*/generate');
    await send(page, 'This request is still waiting on the network'); await began;
    assert.equal(await page.locator('[data-chat-submission] .msg-body').innerText(), 'This request is still waiting on the network');
    assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
    assert.equal(await page.locator('#fx-input').isDisabled(), false, 'the next draft does not wait on inference');
    await page.locator('#fx-input').fill('Keep my next message');
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-submission]').length === 0);
    assert.equal(await page.locator('.msg-body').count(), 1, 'a history refresh replaces the optimistic user message without duplicating it');
    await page.locator('[data-act=account]').click(); await page.locator('.account-pop').waitFor();
    let supportOpens = 0; await page.exposeFunction('__supportOpened', () => { supportOpens++; });
    await page.evaluate(() => document.addEventListener('fells:support-open', () => window.__supportOpened()));
    await page.locator('.credit-row [data-go="billing/credits"]').click();
    await page.locator('.wallet-summary-grid').waitFor();
    assert.equal(new URL(page.url()).hash, '#/billing/credits', 'account top-up first opens the CNY wallet');
    assert.equal(supportOpens, 0, 'opening the wallet does not open support');
    await page.locator('[data-go=new]').click(); await ready(page);
    await page.locator('#fx-input').fill('Independent unsent idea');
    await page.locator('[data-go="chat/slow-chat"]').click(); await ready(page);
    assert.equal(await page.locator('#fx-input').inputValue(), 'Keep my next message');
    assert.equal(responseReleased, false, 'all interaction checks happened before the held POST reply was released');
    release(); await page.locator('[data-run-status=completed]').waitFor();
    assert.equal(await page.locator('#fx-input').inputValue(), 'Keep my next message', 'completion keeps the follow-up draft');
    assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
  } finally { release(); }
});

test('new-chat creation shows immediate progress and navigation works before the create reply', { timeout: 25_000 }, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { page, backend, errors } = await open(t, {}, async ({ context }) => {
    await context.route('**/api/app/chats', async route => { if (route.request().method() === 'POST') await gate; return route.fallback(); });
  });
  try {
    await ready(page); const began = page.waitForRequest(request => request.url().endsWith('/api/app/chats') && request.method() === 'POST');
    await send(page, 'Create without freezing the app'); await began;
    await page.locator('[data-chat-starting]').waitFor();
    await page.locator('[data-go=api]').click(); await page.locator('.api-page').waitFor();
    await page.locator('.bar [data-act=new-key]').click();
    await page.locator('[data-form=key] [name=name]').fill('Still editable during creation');
    assert.equal(await page.locator('[data-form=key] [name=name]').inputValue(), 'Still editable during creation');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.dlg').count(), 0);
    assert.equal(backend.state.generations.length, 0);
    release();
    await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
    assert.equal(new URL(page.url()).hash, '#/api', 'background completion does not navigate away from the user');
    assert.deepEqual(errors, []);
  } finally { release(); }
});

test('pending model runs reconcile automatically using GET and keep an unsent follow-up', async t => {
  const methods = [];
  const { page, backend, errors } = await open(t, { generationStatus: 'running' }, async ({ context }) => {
    await context.route('**/api/app/chats/*/runs/*', route => { methods.push(route.request().method()); return route.fallback(); });
  });
  await ready(page); await send(page, 'One paid instruction'); await page.locator('[data-run-status=running]').waitFor();
  await page.locator('#fx-input').fill('Unsent follow-up');
  const [request] = backend.state.generations, chat = backend.state.chats[0];
  chat.messages.push(['assistant', 'Automatically recovered server reply']);
  backend.state.chatRuns[request.request_id] = { request_id: request.request_id, status: 'completed', message_id: `${chat.id}-m2` };
  await page.locator('[data-run-status=completed]').waitFor();
  assert.deepEqual(methods, ['GET']);
  assert.equal(backend.state.generations.length, 1, 'reconciliation never submits another generation');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Unsent follow-up');
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Automatically recovered server reply');
  assert.deepEqual(errors, []);
});

test('a confirmed unknown run stops automatic polling and remains blocked until an explicit check', async t => {
  const methods = [];
  const { page, backend, errors } = await open(t, { generationStatus: 'unknown' }, async ({ context, page }) => {
    await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
    await context.route('**/api/app/chats/*/runs/*', route => { methods.push(route.request().method()); return route.fallback(); });
  });
  await ready(page); await send(page, 'An uncertain terminal request'); await page.locator('[data-run-status=unknown]').waitFor();
  await page.clock.runFor(120_000);
  assert.deepEqual(methods, [], 'a confirmed uncertain outcome does not create an endless background poll');
  assert.equal(await page.locator('.chat-wait').count(), 0, 'a terminal uncertain outcome is not shown as an endless active spinner');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-act=chat-check]:not([disabled])').waitFor();
  assert.deepEqual(methods, ['GET']);
  await page.clock.runFor(120_000); assert.deepEqual(methods, ['GET']);
  assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('unchanged run status preserves the mounted composer and polling pauses off-page', async t => {
  const methods = [];
  const { page, backend, errors } = await open(t, { generationStatus: 'running' }, async ({ context, page }) => {
    await page.clock.install({ time: new Date('2026-10-26T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
    await context.route('**/api/app/chats/*/runs/*', route => { methods.push(route.request().method()); return route.fallback(); });
  });
  await ready(page); await send(page, 'Keep a stable composer'); await page.locator('[data-run-status=running]').waitFor();
  await page.locator('#fx-input').fill('My focused draft');
  await page.evaluate(() => { window.__composer = document.querySelector('[data-form=send]'); window.__draft = document.querySelector('#fx-input'); });
  const response = page.waitForResponse('**/api/app/chats/*/runs/*');
  await page.clock.runFor(2_000); await (await response).finished();
  await page.evaluate(() => Promise.resolve());
  assert.equal(await page.evaluate(() => window.__composer === document.querySelector('[data-form=send]') && window.__draft === document.querySelector('#fx-input')), true, 'an unchanged status reply does not rebuild the chat');
  assert.equal(await page.locator('#fx-input').inputValue(), 'My focused draft');
  await page.locator('[data-go=api]').click(); await page.locator('.api-page').waitFor();
  await page.clock.runFor(120_000); assert.deepEqual(methods, ['GET']);
  assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('a delayed preference save applies its visual change and permits navigation and typing', { timeout: 25_000 }, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { page, errors } = await open(t, {}, async ({ context }) => {
    await context.route('**/api/app/preferences', async route => { if (route.request().method() !== 'GET') await gate; return route.fallback(); });
  });
  try {
    await ready(page); await page.locator('[data-act=account]').click();
    const began = page.waitForRequest(request => request.url().endsWith('/api/app/preferences') && request.method() !== 'GET');
    await page.locator('[data-act=theme][data-v=dark]').click(); await began;
    assert.equal(await page.locator('#fx').getAttribute('data-theme'), 'dark', 'visual feedback precedes the held write response');
    await page.keyboard.press('Escape');
    await page.locator('[data-go=api]').click(); await page.locator('.api-page').waitFor();
    await page.locator('.bar [data-act=new-key]').click(); await page.locator('[data-form=key] [name=name]').fill('Draft while saving');
    assert.equal(await page.locator('[data-form=key] [name=name]').inputValue(), 'Draft while saving');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('.dlg').count(), 0);
    release(); await idle(page); assert.deepEqual(errors, []);
  } finally { release(); }
});

test('a zero-key account sends canonical IDs from account allowance and shows only server-generated replies', async t => {
  const { page, backend, errors } = await open(t, { assistantReply: '<svg onload="window.__forged=1">server text</svg>' });
  await ready(page);
  assert.equal(await page.locator('[data-input=chatKey],.chat-key-toolbar').count(), 0);
  assert.equal(await page.locator('.model-chat-intro h2').innerText(), 'Start a conversation');
  assert.match(await page.locator('.chat-billing-note').innerText(), /Account API balance.*\$9\.00/);
  assert.equal(await page.locator('.strip,.chat-execution-note').count(), 0);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /CLI|terminal|file tools|cloud computer/);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /Agent execution is not configured/);
  assert.equal(await page.locator('.agent-tabs').count(), 0);
  await send(page, '<img src=x onerror="window.__forged=2">User text');
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.match(await page.locator('.chat-billing-note').innerText(), /Account API balance.*\$9\.00/);
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

test('an enabled Claude Messages model uses account billing without asking for an external key', async t => {
  const model = 'claude/hosted-text-fixture';
  const { page, backend, errors } = await open(t, {
    chatModels: [{ model, label: 'Claude conversation', format: 'anthropic-messages', formats: ['anthropic-messages'] }],
  });
  await ready(page);
  assert.match(await page.locator('.model-btn').innerText(), /Claude conversation/);
  assert.equal(await page.locator('[data-chat-availability],[data-input=chatKey]').count(), 0);
  await send(page, 'Use the enabled Claude conversation');
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.equal(backend.state.generations.length, 1);
  assert.equal(backend.state.generations[0].model, model);
  assert.equal(backend.state.generations[0].billing_mode, 'account_allowance');
  assert.equal(Object.hasOwn(backend.state.generations[0], 'key_id'), false);
  assert.deepEqual(backend.state.keys, []); assert.deepEqual(errors, []);
});

for (const width of [320, 1280]) test(`conversation funding details separate total, plan and USD balances at width ${width}`, async t => {
  const { page, backend, errors } = await open(t, {
    apiAllowance: { user_id: 42, micro: 23000000, plan_micro: 10000000, comp_micro: 3000000, expires_at: 1900000000 },
  }, async ({ page }) => page.setViewportSize({ width, height: 820 }));
  await ready(page);
  assert.match(await page.locator('.chat-billing-note').innerText(), /Account API balance.*\$23\.00/);
  assert.match(await page.locator('.me-btn').innerText(), /\$13\.00/, 'the sidebar excludes Token Plan capacity');
  await page.locator('#fx-input').fill('Preserve this draft while checking charges');
  const writes = backend.state.writes.length;
  const help = page.getByRole('button', { name: 'How charges work', exact: true });
  await help.click();
  const dialog = page.getByRole('dialog', { name: 'Conversation charges', exact: true });
  await dialog.waitFor();
  for (const [bucket, value] of [['total', '$23.00'], ['plan', '$10.00'], ['compensation', '$3.00'], ['independent', '$10.00']]) {
    assert.equal(await dialog.locator(`[data-funding-bucket=${bucket}] dd`).innerText(), value);
  }
  const text = await dialog.innerText();
  assert.match(text, /guaranteed quota first, then burst capacity when available, compensation, and finally 12-month USD allowance/);
  assert.match(text, /Burst availability is checked when the request is settled/);
  assert.match(text, /CNY wallets and monthly subscriptions do not pay/);
  assert.match(text, /No personal API key is needed/);
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height <= 820, 'the dialog stays within the viewport');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Preserve this draft while checking charges');
  assert.equal(await help.evaluate(element => element === document.activeElement), true, 'closing restores focus');
  assert.equal(backend.state.writes.length, writes, 'reading funding details does not submit account changes');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
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
    await context.route(/\/app\/start\/?(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
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
    await page.waitForURL(/\/app\/start\/?(?:\?session=changed)?$/);
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

test('an unrelated account read preserves a failed model catalog until an explicit reload recovers it', async t => {
  let releaseInvoices, recover = false, catalogRequests = 0;
  const invoicesGate = new Promise(resolve => { releaseInvoices = resolve; });
  const { page, backend, errors } = await open(t, {}, async ({ context }) => {
    await context.route('**/api/app/invoices', async route => { await invoicesGate; await route.fallback(); });
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => {
      catalogRequests++;
      return recover ? route.fallback() : route.fulfill({ status: 503, json: { error: 'Synthetic catalog outage' } });
    });
  });
  try {
    await page.locator('.chat-model-state[data-model-state=error]').waitFor();
    assert.equal(catalogRequests, 1);
    releaseInvoices();
    // Settle the deliberately gated account read and all resulting automatic
    // requests before asserting that the reported failure stayed in place.
    await page.waitForLoadState('networkidle');
    assert.equal(catalogRequests, 1, 'unrelated account completion cannot retry a failed catalog');
    assert.equal(await page.locator('.chat-model-state').getAttribute('data-model-state'), 'error');
    assert.equal(await page.locator('.model-btn').innerText(), 'Models unavailable');
    assert.equal(await page.locator('.send').isDisabled(), true);
    recover = true;
    await page.locator('[data-act=chat-models]').click();
    await ready(page);
    assert.equal(catalogRequests, 2, 'explicit reload performs the next catalog read');
    assert.equal(await page.locator('.model-btn span').innerText(), 'Server text model');
    assert.equal(backend.state.generations.length, 0);
    assert.deepEqual(errors, []);
  } finally { releaseInvoices(); }
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
  if (status !== 'loading') assert.doesNotMatch(await page.locator('.model-chat-compose,.dock').innerText(), /Loading/);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(backend.state.generations.length, 0);
  if (status === 'empty') assert.match(await page.locator('.chat-model-message').innerText(), /^No browser conversation route is available/);
  if (status === 'loading') {
    release(); await page.locator('.chat-model-state[data-model-state=empty]').waitFor();
    assert.equal(await page.locator('.model-btn').innerText(), 'No available models');
    assert.doesNotMatch(await page.locator('.model-chat-compose,.dock').innerText(), /Loading/);
  }
  assert.deepEqual(errors, []);
});

for (const [reason, message, details] of [
  ['no_visible_models', "No models are enabled in this account's catalog.", {}],
  ['pricing_unavailable', 'These models do not have complete API pricing yet', { visible_models: 1 }],
  ['model_restricted', "This account's model access policy does not allow these models", { visible_models: 1, priced_models: 1 }],
  ['claude_code_only', 'browser conversation execution is not enabled for this account.', { visible_models: 1, priced_models: 1, permitted_models: 1, claude_code_only_models: 1 }],
  ['browser_provider_unsupported', 'The connected routes do not support browser conversations.', { visible_models: 1, priced_models: 1, permitted_models: 1, unsupported_provider_models: 1 }],
  ['no_compatible_routes', 'No compatible browser conversation route is configured for this account.', { visible_models: 1, priced_models: 1, permitted_models: 1, no_route_models: 1 }],
]) test(`account catalog explains ${reason} without changing keys or dispatching a paid request`, async t => {
  const counts = { visible_models: 0, priced_models: 0, permitted_models: 0, web_models: 0, claude_code_only_models: 0, unsupported_provider_models: 0, no_route_models: 0, ...details };
  const { page, backend, errors } = await open(t, {}, async ({ context }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => route.fulfill({ json: { capability: 'model_chat', billing_mode: 'account_allowance', models: [], diagnostics: { reason, counts, private_provider: 'private-fixture-provider.example.invalid' } } }));
  });
  await page.locator('.chat-model-state[data-model-state=empty]').waitFor();
  assert.ok((await page.locator('.chat-model-message').innerText()).includes(message));
  if (reason === 'claude_code_only') {
    assert.equal(await page.locator('[data-chat-availability=claude_code_only]').count(), 1);
    assert.equal(await page.locator('[data-form=send]').count(), 0, 'CLI-only new conversations do not offer an unusable browser composer');
  } else assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await page.locator('[data-input=chatKey],.agent-tabs').count(), 0);
  assert.equal(backend.state.generations.length, 0);
  assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /private-fixture-provider|Check your allowance/);
  assert.deepEqual(errors, []);
});

for (const width of [320, 1280]) test(`CLI-only availability gives a direct Claude Code guide after a previous curl choice at width ${width}`, async t => {
  const { page, backend, errors } = await open(t, { keys: [{ ...key }] }, async ({ context, page }) => {
    await page.setViewportSize({ width, height: 820 });
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => route.fulfill({ json: cliOnlyCatalog() }));
    await context.route(/\/api\/app\/catalog(?:\?.*)?$/, route => route.fulfill({ json: { models: [{
      model: 'claude/fixture-cli', display_name: 'Claude fixture', routable: true, formats: ['anthropic-messages'],
      client_formats: { api: [], claude_code: ['anthropic-messages'] },
    }] } }));
  });
  await page.locator('[data-chat-availability=claude_code_only]').waitFor();
  assert.match(await page.locator('.chat-billing-note').innerText(), /Account API balance.*\$9\.00/);
  assert.equal(await page.locator('[data-form=send],[data-input=chatKey],[data-input=apiKey]').count(), 0);
  assert.doesNotMatch(await page.locator('#fx-main').innerText(), /Start a conversation|Choose a model and share your ideas/);
  await page.evaluate(() => { location.hash = '#/api'; });
  await page.locator('.codebox[data-catalog-state=ready]').waitFor();
  await page.locator('[data-act=quick][data-i="0"]').click();
  assert.equal(await page.locator('[data-act=quick][data-i="0"]').getAttribute('aria-selected'), 'true');
  await page.evaluate(() => { location.hash = '#/new'; });
  const guide = page.locator('[data-act=claude-guide]');
  await guide.waitFor();
  const box = await guide.boundingBox();
  assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 820, 'the guide action is visible without clipping');
  await guide.click();
  await page.locator('.codebox[data-catalog-state=ready][data-claude-mode=saved]').waitFor();
  assert.equal(JSON.parse(await page.locator('.api-code-area pre').innerText()).env.ANTHROPIC_AUTH_TOKEN, 'YOUR_FELLS_API_KEY');
  assert.equal(await page.locator('[data-act=quick][data-i="2"]').getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('.api-code-area pre').innerText(), /claude\/fixture-cli/);
  assert.equal(backend.state.generations.length, 0);
  assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false);
  assert.deepEqual(errors, []);
});

test('a new-conversation draft survives the CLI-only card and retry when browser models become available', async t => {
  let cliOnly = false;
  const { page, backend, errors } = await open(t, {}, async ({ context, backend }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => route.fulfill({ json: cliOnly ? cliOnlyCatalog() : {
      capability: 'model_chat', billing_mode: 'account_allowance', models: backend.state.chatModels,
    } }));
  });
  await ready(page); await page.locator('#fx-input').fill('Keep my unsent idea');
  cliOnly = true;
  await page.getByRole('button', { name: 'Reload models', exact: true }).click();
  await page.locator('[data-chat-availability=claude_code_only]').waitFor();
  assert.equal(await page.locator('[data-form=send]').count(), 0);
  cliOnly = false;
  await page.getByRole('button', { name: 'Reload models', exact: true }).click();
  await ready(page);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep my unsent idea');
  assert.equal(backend.state.generations.length, 0);
  assert.equal(backend.state.writes.some(write => write.path === '/api/app/keys'), false);
  assert.deepEqual(errors, []);
});

test('existing conversation history and its unsent draft remain mounted when routes become CLI-only', async t => {
  let cliOnly = false;
  const { page, backend, errors } = await open(t, {}, async ({ context, backend }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => route.fulfill({ json: cliOnly ? cliOnlyCatalog() : {
      capability: 'model_chat', billing_mode: 'account_allowance', models: backend.state.chatModels,
    } }));
  });
  await ready(page); await send(page, 'Keep the existing history');
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  await page.locator('#fx-input').fill('Keep this conversation draft');
  cliOnly = true;
  await page.getByRole('button', { name: 'Reload models', exact: true }).click();
  await page.locator('.chat-model-state[data-model-state=empty]').waitFor();
  assert.equal(await page.locator('[data-chat-availability]').count(), 0);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this conversation draft');
  assert.equal(await page.locator('#fx-input').isDisabled(), true);
  assert.equal(await page.locator('.msg-body').count(), 2);
  assert.equal(backend.state.generations.length, 1);
  assert.deepEqual(errors, []);
});

test('a pending request can recover by GET even after its route becomes CLI-only', async t => {
  let cliOnly = false; const checks = [];
  const { page, backend, errors } = await open(t, { generationStatus: 'running' }, async ({ context, backend }) => {
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, route => route.fulfill({ json: cliOnly ? cliOnlyCatalog() : {
      capability: 'model_chat', billing_mode: 'account_allowance', models: backend.state.chatModels,
    } }));
    await context.route('**/api/app/chats/*/runs/*', route => { checks.push(route.request().method()); return route.fallback(); });
  });
  await ready(page); await send(page, 'Recover this pending request once');
  await page.locator('[data-run-status=running]').waitFor(); await idle(page);
  cliOnly = true;
  await page.getByRole('button', { name: 'Reload models', exact: true }).click();
  await page.locator('.chat-model-state[data-model-state=empty]').waitFor();
  assert.equal(await page.locator('[data-chat-availability]').count(), 0);
  const request = backend.state.generations[0], chat = backend.state.chats[0];
  chat.messages.push(['assistant', 'Recovered while the catalog is CLI-only']);
  backend.state.chatRuns[request.request_id] = { request_id: request.request_id, status: 'completed', message_id: `${chat.id}-m2` };
  await page.locator('[data-act=chat-check]').click();
  await page.locator('[data-run-status=completed]').waitFor(); await idle(page);
  assert.equal(await page.locator('.msg-body').last().innerText(), 'Recovered while the catalog is CLI-only');
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.deepEqual(checks, ['GET']);
  assert.equal(backend.state.generations.length, 1);
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
    return { toolbar: rect('.composer .tools'), billing: rect('.chat-billing-note'), reload: rect('.chat-billing-note [data-act=chat-models]'), model: rect('.model-btn'), send: rect('[data-form=send] .send'), viewport: innerWidth };
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
  assert.doesNotMatch(await page.locator('.model-chat-compose,.dock').innerText(), /Loading|Server text model/);
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
  let release, catalogSettled;
  const gate = new Promise(resolve => { release = resolve; }), previousCatalog = new Promise(resolve => { catalogSettled = resolve; }), reads = [];
  const { page, base, backend, errors } = await open(t, {}, async ({ context, page, backend }) => {
    // Let the old application finish its own identity-change navigation before
    // starting the replacement application; the real entry redirect otherwise
    // competes with an explicit reload and the coverage navigation snapshot.
    await context.route(/\/app\/start\/?(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
    await context.route(/\/api\/app\/chat-models(?:\?.*)?$/, async route => {
      const userID = backend.state.userID;
      reads.push({ userID, url: route.request().url() });
      if (userID === 42) { await page.evaluate(() => { window.__previousCatalogStarted = true; }); await gate; }
      try {
        await route.fulfill({ json: { billing_mode: 'account_allowance', capability: 'model_chat', models: [{ model: `account-${userID}-only`, label: `Account ${userID} model`, format: 'openai-completions', formats: ['openai-completions'] }] } });
      } finally { if (userID === 42) catalogSettled(); }
    });
  });
  await page.waitForFunction(() => window.__previousCatalogStarted === true);
  backend.state.userID = 43; backend.state.sessionID = 'd'.repeat(64); backend.state.apiAllowance.user_id = 43;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForURL(/\/app\/start\/?(?:\?session=changed)?$/);
  assert.equal(await page.locator('[data-form=send],.model-btn').count(), 0, 'The old account loses its rendering and generation authority');
  assert.equal(backend.state.generations.length, 0);
  await page.goto(base + '/app/#/new');
  await page.locator('.model-btn').filter({ hasText: 'Account 43 model' }).waitFor(); await ready(page);
  release(); await previousCatalog;
  await send(page, 'Use the current account only'); await page.locator('[data-run-status=completed]').waitFor();
  const request = backend.state.generations[0];
  assert.equal(request.billing_mode, 'account_allowance'); assert.equal(Object.hasOwn(request, 'key_id'), false);
  assert.equal(request.model, 'account-43-only');
  assert.equal(request.headers['x-fells-expected-user'], '43'); assert.equal(request.headers['x-fells-expected-session'], 'd'.repeat(64));
  assert.deepEqual(reads.map(read => read.userID), [42, 43]);
  assert.ok(reads.every(read => !new URL(read.url).searchParams.has('key_id')));
  assert.doesNotMatch(await page.locator('.model-chat-compose,.dock').innerText(), /Account 42 model/);
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


for (const [name, fields, expected] of [
  ['occupied', { available_micro: 7000000, available_plan_micro: 2000000, available_comp_micro: 1000000, reserved_micro: 14000000, pending_micro: 2000000 }, { total: '$7.00', plan: '$2.00', compensation: '$1.00', independent: '$4.00', gross: '$23.00', reserved: '$14.00', pending: '$2.00', nonPlan: '$5.00' }],
  ['zero', { available_micro: 0, available_plan_micro: 0, available_comp_micro: 0, reserved_micro: 23000000, pending_micro: 0 }, { total: '$0.00', plan: '$0.00', compensation: '$0.00', independent: '$0.00', gross: '$23.00', reserved: '$23.00', pending: '$0.00', nonPlan: '$0.00' }],
  ['debt', { available_micro: -150001, available_plan_micro: 0, available_comp_micro: 0, reserved_micro: 0, pending_micro: 0 }, { total: '$-0.15', plan: '$0.00', compensation: '$0.00', independent: '$-0.15', gross: '$23.00', reserved: '$0.00', pending: '$0.00', nonPlan: '$-0.15' }],
]) test(`account funding ${name} snapshot is consistent across chat, sidebar, details and credits`, async t => {
  const { page, backend, errors } = await open(t, { apiAllowance: { user_id: 42, micro: 23000000, plan_micro: 10000000, comp_micro: 3000000, expires_at: 1900000000, ...fields } }, async ({ page }) => page.setViewportSize({ width: 390, height: 820 }));
  await ready(page);
  assert.equal(await page.locator('.chat-billing-note a').innerText(), `Account API balance available · ${expected.total}`);
  assert.ok((await page.locator('.me-btn').innerText()).includes(expected.nonPlan));
  const writes = backend.state.writes.length;
  await page.getByRole('button', { name: 'How charges work', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Conversation charges', exact: true }); await dialog.waitFor();
  for (const [bucket, value] of Object.entries(expected).filter(([bucket]) => bucket !== 'nonPlan')) assert.equal(await dialog.locator(`[data-funding-bucket=${bucket}] dd`).innerText(), value);
  assert.match(await dialog.innerText(), /cannot fund another request/);
  const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.height <= 820);
  await page.keyboard.press('Escape'); await page.goto(page.url().split('#')[0] + '#/billing/credits');
  const credit = page.locator('[data-api-available-credit]'); await credit.waitFor();
  assert.equal(await credit.locator('.wallet-summary-value').innerText(), expected.nonPlan);
  assert.equal(await credit.locator('small').first().innerText(), 'Available USD API allowance');
  if (fields.reserved_micro || fields.pending_micro) {
    assert.ok((await credit.locator('[data-funding-reserved]').innerText()).includes(expected.reserved));
    assert.ok((await credit.locator('[data-funding-pending]').innerText()).includes(expected.pending));
  }
  assert.equal(await page.locator('[data-input=chatKey],.chat-key-toolbar').count(), 0);
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.writes.length, writes); assert.deepEqual(errors, []);
});
