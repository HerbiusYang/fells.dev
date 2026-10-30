import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const key = { id: 17, name: 'Existing key', prefix: 'sk-private-prefix', kind: 'user', revoked: false, expires_at: 0, created_at: 1700000000 };
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
const model = (id, extra = {}) => ({ model: id, offered: true, routable: true, formats: ['openai-completions'], client_formats: { api: ['openai-completions'] }, ...extra });
async function capture(page, name) {
  const directory = 'test-results/package-audit';
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), fullPage: true });
}

async function open(t, { locale = 'en', width = 1280, keys = [key], models = [], failure = false, deferred } = {}) {
  const f = await fixture.setup(t, { viewport: { width, height: 900 } });
  const backend = createAppBackend({ preferences, keys, modelChat: true,
    workspaces: [{ id: 'buddy-workspace', name: 'Workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }],
    chats: [{ id: 'buddy-chat', ws: 'buddy-workspace', title: 'Saved conversation', agent: 'claude', model: 'Server text model', created: 1700000000001, messages: [['you', 'Saved conversation']] }],
  });
  await backend.install(f.context);
  const reads = [];
  await f.context.route(/\/api\/app\/catalog(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url()); reads.push(url.searchParams.get('key_id'));
    if (deferred && url.searchParams.get('key_id') === '17') await deferred;
    if (route.request().isNavigationRequest()) throw Error('Catalog must remain a background read');
    try { await route.fulfill({ status: failure ? 503 : 200, json: failure ? { error: 'Unavailable' } : { models } }); } catch { /* Closing the guide aborts its read. */ }
  });
  await f.page.goto(f.base + (locale === 'en' ? '/app/' : `/${locale}/app/`) + '#/chat/buddy-chat');
  await f.page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor();
  await f.page.locator('#fx-input').fill('Keep this unsent draft');
  if (width < 800) await f.page.locator('[data-act=sb]').click();
  return { ...f, backend, reads };
}

for (const locale of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) test(`WorkBuddy guide is a small localized dialog below New chat: ${locale}`, async t => {
  const { page, backend, reads, errors } = await open(t, { locale, width: 320, models: [model('native-claude', { formats: ['anthropic-messages'], client_formats: { api: [], claude_code: ['anthropic-messages'] } })] });
  const entry = page.locator('.sb [data-act=workbuddy-guide]');
  assert.equal(await page.locator('.sb [data-go=new]').evaluate(button => button.closest('li').nextElementSibling.querySelector('button').dataset.act), 'workbuddy-guide');
  await entry.click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-workbuddy-state=ready]').waitFor();
  assert.match(await dialog.getByRole('heading').innerText(), /WorkBuddy/);
  assert.equal(await dialog.locator('input, textarea, pre, [data-workbuddy-model]').count(), 0, 'no secret entry, scripts or invented compatible models');
  assert.equal(await dialog.locator('a[target=_blank]').getAttribute('href'), 'https://www.codebuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model');
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, '320px dialog stays within its width');
  assert.ok(reads.includes('17'), 'guide checks the existing key’s catalog');
  assert.equal((await dialog.innerText()).includes(key.prefix), false);
  if (locale === 'zh') await capture(page, 'workbuddy-zh-mobile.png');
  await dialog.locator('[data-act=close]').click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await entry.evaluate(element => element === document.activeElement), true, 'close returns focus to the opener');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this unsent draft');
  assert.equal(backend.state.generations.length, 0);
  assert.equal(backend.state.writes.some(write => /\/keys|\/plans\/buy|\/subscriptions\/buy|\/generate/.test(write.path)), false);
  assert.deepEqual(errors, []);
});

test('WorkBuddy lists only explicitly offered Chat Completions models permitted for the existing API key', async t => {
  const { page, base, backend, errors } = await open(t, { locale: 'zh', models: [
    model('real-compatible'), model('duplicate-compatible'), model('real-compatible'),
    model('reference-only', { offered: false }), model('unconfirmed', { offered: undefined }),
    model('no-route', { routable: false }), model('missing-client-projection', { client_formats: undefined }),
    model('native-claude-only', { formats: ['anthropic-messages'], client_formats: { api: [], claude_code: ['anthropic-messages'] } }),
    model('responses-only', { formats: ['openai-responses'], client_formats: { api: ['openai-responses'] } }),
    model('wire-mismatch', { formats: ['anthropic-messages'] }),
  ] });
  await page.locator('[data-act=workbuddy-guide]').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-workbuddy-model]').waitFor();
  assert.deepEqual(await dialog.locator('option').evaluateAll(options => options.map(option => option.value)), ['real-compatible', 'duplicate-compatible']);
  assert.equal(await dialog.locator('[data-workbuddy-base]').innerText(), base + '/v1');
  assert.doesNotMatch(await dialog.innerText(), /ANTHROPIC_|oauth|sk-private-prefix|bash -c/);
  await capture(page, 'workbuddy-zh-desktop.png');
  await dialog.locator('[data-act=workbuddy-keys]').click();
  await page.waitForURL(url => url.hash === '#/api');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(backend.state.writes.some(write => write.method === 'POST' && write.path === '/api/app/keys'), false);
  assert.deepEqual(errors, []);
});

test('WorkBuddy does not create a key when none exists and reports a failed catalog honestly', async t => {
  const missing = await open(t, { keys: [] });
  await missing.page.locator('[data-act=workbuddy-guide]').click();
  await missing.page.locator('[data-workbuddy-state=no-key]').waitFor();
  assert.equal(missing.reads.includes('17'), false);
  assert.equal(missing.backend.state.keys.length, 0);
  const failed = await open(t, { failure: true });
  await failed.page.locator('[data-act=workbuddy-guide]').click();
  await failed.page.locator('[data-workbuddy-state=error]').waitFor();
  assert.equal(await failed.page.locator('[data-workbuddy-model]').count(), 0);
  assert.deepEqual([...missing.errors, ...failed.errors], []);
});

test('closing WorkBuddy during a catalog read does not reopen it or replace the conversation', async t => {
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const { page, errors } = await open(t, { deferred, models: [model('real-compatible')] });
  await page.locator('[data-act=workbuddy-guide]').click();
  await page.locator('[data-workbuddy-state=loading]').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  release();
  await page.locator('[data-act=workbuddy-guide]').focus();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(new URL(page.url()).hash, '#/chat/buddy-chat');
  assert.deepEqual(errors, []);
});
