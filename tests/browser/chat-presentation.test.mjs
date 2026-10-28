import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const preferences = { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
const workspace = { id: 'presentation-space', name: 'Presentation fixture', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const chat = messages => ({ id: 'presentation-chat', ws: workspace.id, title: 'Presentation', agent: 'lite', model: 'server/text-model-v2', created: 1700000000000, messages });
async function open(t, { backend: options = {}, browser = {}, path = '/app/#/new', configure } = {}) {
  const session = await fixture.setup(t, browser);
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, workspaces: [{ ...workspace }], ...options });
  await backend.install(session.context);
  await configure?.({ ...session, backend });
  await session.page.goto(session.base + path);
  await session.page.locator('#fx-input:not([disabled])').waitFor();
  return { ...session, backend };
}

for (const width of [390, 1280]) for (const colorScheme of ['light', 'dark']) {
  test(`${width}px ${colorScheme}: composer stays at the bottom with a neutral keyboard focus boundary`, async t => {
    const { page, errors } = await open(t, { browser: { viewport: { width, height: 800 }, colorScheme } });
    const dock = await page.locator('.dock').boundingBox(), main = await page.locator('#fx-main').boundingBox();
    assert.ok(Math.abs(dock.y + dock.height - main.y - main.height) <= 2, 'empty-chat composer is anchored to the bottom of the main panel');
    assert.equal(await page.locator('.composer').evaluate(element => getComputedStyle(element).boxShadow), 'none', 'the dock has no floating shadow');
    await page.locator('#fx-input').focus();
    const focus = await page.locator('#fx-input').evaluate(element => ({ outline: getComputedStyle(element).outlineStyle, visible: element.matches(':focus-visible'), border: getComputedStyle(element.closest('.composer')).borderColor }));
    assert.equal(focus.outline, 'none');
    assert.equal(focus.visible, true);
    assert.notEqual(focus.border, 'rgb(224, 122, 85)', 'composer focus uses the neutral boundary');
    await page.locator('#fx-input').fill(Array(100).fill('A long editable draft').join('\n'));
    assert.ok(await page.locator('#fx-input').evaluate(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto'));
    await page.setViewportSize({ width, height: 460 });
    const compactDock = await page.locator('.dock').boundingBox();
    assert.ok(compactDock.y >= 0 && compactDock.y + compactDock.height <= 460, 'the dock fits a reduced viewport such as an open keyboard');
    assert.deepEqual(errors, []);
  });
}

test('stored assistant Markdown renders safely while customer text remains plain across reloads', async t => {
  const assistant = '**Claude** can help.\n\n- First\n- Second\n\n1. One\n2. Two\n\n```js\nconst x = "<safe>";\n```\n\nUse `code` and [docs](https://example.test/docs).\n\n<script>window.__forged=1</script>\n\n![tracking](https://tracker.invalid/pixel)\n\n[bad](javascript:alert(1))';
  const attempts = [];
  const { page, base, errors } = await open(t, {
    backend: { chats: [chat([['you', '**Customer** <img src=x onerror=evil>'], ['assistant', assistant]])] },
    path: '/app/#/chat/presentation-chat',
    configure: async ({ context }) => context.on('request', request => { if (request.url().includes('tracker.invalid')) attempts.push(request.url()); }),
  });
  for (let reload = 0; reload < 2; reload++) {
    const body = page.locator('.chat-markdown');
    assert.equal(await body.locator('strong').innerText(), 'Claude');
    assert.equal(await body.locator('ul > li').count(), 2);
    assert.equal(await body.locator('ol > li').count(), 2);
    assert.match(await body.locator('pre code').innerText(), /<safe>/);
    assert.equal(await body.locator('a').count(), 1);
    assert.equal(await body.locator('img,script,iframe,svg,style,form').count(), 0);
    assert.equal(await page.locator('.msg.user .msg-body strong,.msg.user .msg-body img').count(), 0);
    assert.match(await page.locator('.msg.user .msg-body').innerText(), /\*\*Customer\*\*/);
    assert.equal(await page.evaluate(() => window.__forged), undefined);
    assert.deepEqual(attempts, []);
    if (reload === 0) { await page.goto(base + '/app/#/chat/presentation-chat'); await page.locator('#fx-input:not([disabled])').waitFor(); }
  }
  assert.deepEqual(errors, []);
});

test('a pending reply has an inline status and elapsed wait without remounting the draft or announcing every second', async t => {
  let release, dispatched;
  const gate = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { dispatched = resolve; });
  const { page, errors } = await open(t, { configure: async ({ context, page }) => {
    await page.clock.install({ time: new Date('2026-10-28T04:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-28T04:00:01Z'));
    await context.route('**/api/app/chats/*/generate', async route => { dispatched(); await gate; await route.fallback(); });
  } });
  try {
    await page.locator('#fx-input').fill('A real synthetic request');
    await page.locator('[data-form=send] .send').click();
    await began;
    await page.locator('[data-run-status=pending]').waitFor();
    assert.equal(await page.locator('[data-thread] .chat-run-status').count(), 1, 'status appears beside the corresponding messages');
    await page.locator('#fx-input').fill('My next draft');
    await page.evaluate(() => { window.__draftNode = document.querySelector('#fx-input'); });
    await page.clock.runFor(3_000);
    assert.match(await page.locator('[data-chat-elapsed]').innerText(), /0:03/);
    assert.equal(await page.locator('[data-chat-elapsed]').getAttribute('aria-live'), 'off');
    assert.equal(await page.locator('[data-chat-elapsed]').evaluate(element => element.closest('[role=status]') === null), true);
    assert.equal(await page.evaluate(() => window.__draftNode === document.querySelector('#fx-input')), true);
    assert.equal(await page.locator('#fx-input').inputValue(), 'My next draft');
    assert.equal(await page.locator('.chat-run-indicator.is-active i').first().evaluate(element => getComputedStyle(element).animationName), 'none', 'reduced motion retains a static indicator');
    release();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    assert.equal(await page.locator('.chat-run-status').count(), 0, 'completed requests do not leave a saved-success banner');
    assert.equal(await page.locator('[data-chat-elapsed]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { release(); }
});

for (const status of ['running', 'unknown']) test(`server ${status} state has an honest localized status`, async t => {
  const { page, errors } = await open(t, { backend: { generationStatus: status }, path: '/zh/app/#/new' });
  await page.locator('#fx-input').fill('一条合成请求');
  await page.locator('[data-form=send] .send').click();
  const notice = page.locator(`.chat-run-status[data-run-status=${status}]`);
  await notice.waitFor();
  assert.equal(await notice.locator('[role=status]').innerText(), status === 'running' ? '正在生成回复' : '结果待确认');
  assert.equal(await notice.locator('.is-active').count(), status === 'running' ? 1 : 0);
  assert.doesNotMatch(await notice.innerText(), /\d+%|内部思考|chain.of.thought/i);
  assert.deepEqual(errors, []);
});

test('thread scrolling preserves an earlier reading position and follows new replies only at the bottom', async t => {
  const history = Array.from({ length: 40 }, (_, index) => [index % 2 ? 'assistant' : 'you', `Message ${index}\n${'Long fixture line. '.repeat(15)}`]);
  const { page, backend, errors } = await open(t, { backend: { chats: [chat(history)] }, path: '/app/#/chat/presentation-chat', browser: { viewport: { width: 390, height: 700 } } });
  const thread = page.locator('[data-thread]');
  const geometry = await thread.evaluate(element => ({ scroll: element.scrollHeight, client: element.clientHeight, overflow: getComputedStyle(element).overflowY, scrollbar: getComputedStyle(element).scrollbarWidth }));
  assert.ok(geometry.scroll > geometry.client);
  assert.equal(geometry.overflow, 'scroll');
  assert.notEqual(geometry.scrollbar, 'none');
  await thread.evaluate(element => { element.scrollTop = 0; });
  backend.state.chats[0].messages.push(['assistant', 'A new reply while reading history']);
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('.msg-body').filter({ hasText: 'A new reply while reading history' }).waitFor();
  assert.equal(await thread.evaluate(element => element.scrollTop), 0, 'background refresh does not force the reader to the end');
  await page.locator('[data-chat-latest]').click();
  backend.state.chats[0].messages.push(['assistant', 'Another reply while following the end']);
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('.msg-body').filter({ hasText: 'Another reply while following the end' }).waitFor();
  assert.ok(await thread.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight <= 2));
  assert.deepEqual(errors, []);
});

test('a background 401 clears customer content even while a different account read is still pending', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, workspaces: [{ ...workspace }] });
  const { context, page, base } = await fixture.setup(t);
  await backend.install(context);
  await context.route('**/api/app/auth/config', route => route.fulfill({ json: { signup_enabled: true, email_enabled: true, channels: ['email'], min_password_length: 8, turnstile_site_key: '' } }));
  await context.route(/\/api\/app\/agreement(?:\?.*)?$/, route => route.fulfill({ json: { version: 'synthetic', h1: 'Terms', lede: 'Synthetic terms', clauses: [], ui: {} } }));
  await context.route(url => url.pathname === '/api/app/wallet/ledger', async route => {
    await gate;
    try { await route.fulfill({ json: { entries: [] } }); }
    catch (error) { if (!page.isClosed() && !route.request().failure()) throw error; }
  });
  await context.route(url => url.pathname === '/api/app/coupons', route => { backend.state.signedIn = false; return route.fulfill({ status: 401, json: { error: 'Synthetic revoked session' } }); });
  try {
    await page.goto(base + '/zh/app/');
    await page.waitForURL(/\/zh\/app\/start\/\?session=changed$/);
    await page.locator('[data-msg]').filter({ hasText: '登录状态已改变，请重新登录。' }).waitFor();
    assert.equal(await page.locator('#fx').count(), 0);
  } finally { release(); }
});

for (const available of [false, true]) test(`web search is an explicit opt-in only when advertised available=${available}`, async t => {
  const { page, backend, errors } = await open(t, { backend: { webSearch: { available, provider: 'native-tools', reason: available ? 'available' : 'route_unsupported' }, chatModels: [{ model: 'server/text-model-v2', label: 'Server text model', format: 'anthropic-messages', formats: ['anthropic-messages'], web_search: available }] } });
  const toggle = page.locator('[data-act=chat-web-search]');
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(await toggle.isDisabled(), !available);
  if (available) {
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('.chat-search-note').innerText(), /additional charges.*account/);
  }
  await page.locator('#fx-input').fill('A question with an explicit search preference');
  await page.locator('[data-form=send] .send').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations.length, 1);
  assert.equal(backend.state.generations[0].web_search === true, available);
  assert.deepEqual(errors, []);
});

test('changing to a model without native web search disables and clears the opted-in preference', async t => {
  const supported = { model: 'server/native-model', label: 'Native model', format: 'anthropic-messages', formats: ['anthropic-messages'], web_search: true };
  const unsupported = { model: 'server/plain-model', label: 'Plain model', format: 'openai-completions', formats: ['openai-completions'] };
  const { page, backend, errors } = await open(t, { backend: { webSearch: { available: true, provider: 'native-tools', reason: 'available' }, chatModels: [supported, unsupported] } });
  await page.locator('[data-act=chat-web-search]').click();
  assert.equal(await page.locator('[data-act=chat-web-search]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-act=model]').click();
  await page.locator('[data-act=pick-model][data-name="server/plain-model"]').click();
  assert.equal(await page.locator('[data-act=chat-web-search]').isDisabled(), true);
  assert.equal(await page.locator('[data-act=chat-web-search]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.chat-search-note').count(), 0);
  await page.locator('#fx-input').fill('A plain request after switching models');
  await page.locator('[data-form=send] .send').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations[0].web_search, undefined);
  assert.equal(backend.state.generations[0].model, unsupported.model);
  assert.deepEqual(errors, []);
});
