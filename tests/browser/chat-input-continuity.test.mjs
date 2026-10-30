import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
const workspace = { id: 'input-space', name: 'Input continuity', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const chat = { id: 'input-chat', ws: workspace.id, title: 'Existing conversation', agent: 'lite', model: 'server/text-model-v2', created: 1700000000000, messages: [] };
const key = { id: 17, name: 'Synthetic existing key', prefix: 'synthetic', kind: 'user', expires_at: 0, revoked: false, created_at: 1700000000 };
const draftKey = 'fells.chat.relogin-draft.v1';
async function open(t, { existing = false, options = {}, configure } = {}) {
  const session = await fixture.setup(t, { viewport: { width: existing ? 1440 : 320, height: 900 } });
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, workspaces: [{ ...workspace }], chats: existing ? [structuredClone(chat)] : [], ...options });
  await backend.install(session.context); await configure?.({ ...session, backend });
  await session.page.goto(session.base + '/app/#/' + (existing ? 'chat/' + chat.id : 'new'));
  await session.page.locator('#fx-input:not([disabled])').waitFor();
  return { ...session, backend };
}
async function beginComposition(page) {
  await page.locator('#fx-input').fill('Before candidate');
  await page.locator('#fx-input').evaluate(input => {
    const form = input.closest('form'), dock = form.parentElement;
    window.__chatInputProbe = { input, form, dock, blur: 0, ended: 0, mutations: 0 };
    input.addEventListener('blur', () => window.__chatInputProbe.blur++);
    input.addEventListener('compositionend', () => window.__chatInputProbe.ended++);
    new MutationObserver(() => window.__chatInputProbe.mutations++).observe(document.querySelector('#fx-main'), { childList: true });
    input.focus(); input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中文' }));
    // A preedit value must not be overwritten with the last committed draft.
    input.value = 'Keep 中文 candidate'; input.setSelectionRange(5, 7, 'forward');
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 229, isComposing: false }));
  });
}
async function assertCompositionRetained(page) {
  assert.deepEqual(await page.evaluate(() => {
    const probe = window.__chatInputProbe, input = document.querySelector('#fx-input');
    return { sameInput: input === probe.input, sameForm: input.closest('form') === probe.form, sameDock: input.closest('.dock') === probe.dock,
      connected: probe.input.isConnected, focused: document.activeElement === input, value: input.value,
      start: input.selectionStart, end: input.selectionEnd, blur: probe.blur, ended: probe.ended,
      main: document.querySelector('#fx-main')?.classList.contains('main') };
  }), { sameInput: true, sameForm: true, sameDock: true, connected: true, focused: true, value: 'Keep 中文 candidate', start: 5, end: 7, blur: 0, ended: 0, main: true });
}

for (const existing of [false, true]) test(`a late account catalog keeps the ${existing ? 'existing' : 'new'} editor, selection and composition connected`, async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const { page, backend, errors } = await open(t, { existing, options: { keys: [key] }, configure: async ({ context }) => {
    await context.route('**/api/app/catalog?*', async route => { entered(); await gate; await route.fallback(); });
  } });
  try {
    await began; await beginComposition(page);
    const response = page.waitForResponse(reply => new URL(reply.url()).pathname === '/api/app/catalog');
    release(); await (await response).finished();
    await page.waitForFunction(() => window.__chatInputProbe.mutations > 0);
    await assertCompositionRetained(page);
    assert.equal(backend.state.generations.length, 0, 'an IME Enter key cannot start generation');
    await page.locator('#fx-input').evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
    assert.equal(await page.locator('#fx-input').inputValue(), 'Keep 中文 candidate');
    if (!existing) {
      await mkdir('test-results/package-audit', { recursive: true });
      await page.screenshot({ path: 'test-results/package-audit/chat-input-continuity-320.png', animations: 'disabled' });
    }
    await page.locator('[data-form=send] .send').click(); await page.locator('.thread[data-run-status=completed]').waitFor();
    assert.equal(backend.state.generations.length, 1); assert.equal(backend.state.generations[0].body, 'Keep 中文 candidate');
    assert.deepEqual(errors, []);
  } finally { release(); }
});

test('an automatic completed-run update keeps the next-message composition and sends it only after explicit submit', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const { page, backend, errors } = await open(t, { existing: true, options: { generationStatus: 'running' }, configure: async ({ context }) => {
    await context.route('**/api/app/chats/*/runs/*', async route => { entered(); await gate; await route.fallback(); });
  } });
  try {
    await page.locator('#fx-input').fill('First request'); await page.locator('.send').click();
    await page.locator('[data-run-status=running]').waitFor(); await began;
    await beginComposition(page);
    const request = backend.state.generations[0], conversation = backend.state.chats[0];
    conversation.messages.push(['assistant', 'The first saved reply']);
    backend.state.chatRuns[request.request_id] = { request_id: request.request_id, status: 'completed', message_id: `${chat.id}-m2` };
    release(); await page.locator('.thread[data-run-status=completed]').waitFor();
    await assertCompositionRetained(page);
    assert.equal(backend.state.generations.length, 1, 'a status read never submits the next draft');
    await page.locator('#fx-input').evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
    backend.state.generationStatus = 'completed';
    await page.locator('.send').click();
    await page.locator('.msg.user .msg-body').filter({ hasText: 'Keep 中文 candidate' }).waitFor();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    assert.equal(backend.state.generations.length, 2); assert.equal(backend.state.generations[1].body, 'Keep 中文 candidate');
    assert.deepEqual(errors, []);
  } finally { release(); }
});

for (const existing of [false, true]) test(`a ${existing ? 'conversation' : 'new-conversation'} draft survives an expired session only for its account and route`, async t => {
  const { page, backend, base, errors } = await open(t, { existing, options: { chats: [structuredClone(chat)] }, configure: async ({ context }) => {
    await context.route(/\/app\/start\/?(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
  } });
  const text = 'Private unsent draft 中文', original = new URL(page.url());
  await page.locator('#fx-input').fill(text); backend.state.signedIn = false;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForURL(url => /\/app\/start\/?$/.test(url.pathname));
  const destination = new URL(page.url()).searchParams.get('next');
  assert.equal(destination, original.pathname + original.search + original.hash);
  const stored = await page.evaluate(name => JSON.parse(sessionStorage.getItem(name)), draftKey);
  assert.equal(stored.userId, 42); assert.equal(stored.route, original.hash); assert.equal(stored.workspace, workspace.id); assert.equal(stored.text, text);
  backend.state.signedIn = true; backend.state.userID = 43; backend.state.sessionID = 'd'.repeat(64);
  await page.goto(base + destination); await page.locator('#fx-input:not([disabled])').waitFor();
  assert.equal(await page.locator('#fx-input').inputValue(), '', 'another account cannot see the retained draft');
  // Leave the old bound account before completing the next synthetic sign-in;
  // its late account requests must not race with the new identity or its draft.
  await page.goto(base + '/app/start/');
  backend.state.userID = 42; backend.state.sessionID = 'e'.repeat(64);
  await page.goto(base + '/app/#/' + (existing ? 'new' : 'chat/' + chat.id)); await page.locator('#fx-input:not([disabled])').waitFor();
  assert.equal(await page.locator('#fx-input').inputValue(), '', 'the same account cannot restore it into a different conversation');
  assert.equal(await page.evaluate(name => JSON.parse(sessionStorage.getItem(name)).text, draftKey), text);
  await page.goto(base + destination); await page.locator('#fx-input:not([disabled])').waitFor();
  await page.waitForFunction(({ hash, text }) => document.querySelector('#fx')?.getAttribute('data-route') === hash && document.querySelector('#fx-input')?.value === text, { hash: original.hash, text });
  assert.equal(await page.locator('#fx-input').inputValue(), text);
  assert.equal(await page.evaluate(name => sessionStorage.getItem(name), draftKey), null, 'restoration consumes the retained draft');
  assert.equal(backend.state.generations.length, 0);
  await page.evaluate(({ name, stored }) => sessionStorage.setItem(name, JSON.stringify({ ...stored, savedAt: Date.now() })), { name: draftKey, stored });
  if (page.viewportSize().width <= 860) await page.locator('[data-act=sb]').click();
  await page.locator('[data-act=account]').click(); await page.locator('[data-act=logout]').click();
  await page.waitForURL(url => /\/app\/start\/?$/.test(url.pathname));
  assert.equal(await page.evaluate(name => sessionStorage.getItem(name), draftKey), null, 'explicit logout still clears a retained draft');
  assert.equal(backend.state.signedIn, false); assert.deepEqual(errors, []);
});

test('editor preservation never moves a textarea into another conversation or workspace', async t => {
  const second = { ...workspace, id: 'second-input-space', name: 'Other workspace' };
  const { page, backend, errors } = await open(t, { existing: true, options: { workspaces: [workspace, second] } });
  await page.locator('#fx-input').fill('Existing private draft');
  const original = await page.locator('#fx-input').elementHandle();
  await page.locator('[data-go=new]').click(); await page.locator('#fx-input:not([disabled])').waitFor();
  assert.equal(await original.evaluate(input => input.isConnected), false);
  assert.equal(await page.locator('#fx-input').inputValue(), '');
  const newEditor = await page.locator('#fx-input').elementHandle();
  await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id="second-input-space"]').click();
  await page.locator('#fx:not([aria-busy=true])').waitFor(); await page.locator('#fx-input:not([disabled])').waitFor();
  assert.equal(await newEditor.evaluate(input => input.isConnected), false);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});
