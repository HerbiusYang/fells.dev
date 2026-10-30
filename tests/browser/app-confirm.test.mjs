import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
async function open(t, { locale = 'en', width = 1280, role = 'owner', path = '#/chat/confirm-chat', configure } = {}) {
  const f = await fixture.setup(t, { viewport: { width, height: 760 } });
  const backend = createAppBackend({ preferences,
    workspaces: [{ id: 'confirm-workspace', name: 'Confirmation workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role }],
    chats: [{ id: 'confirm-chat', ws: 'confirm-workspace', title: 'Keep this conversation', agent: 'claude', model: 'Server model', created: 1700000000000, messages: [['you', 'Retained conversation']] }],
  });
  await backend.install(f.context); await configure?.(f, backend);
  await f.page.goto(f.base + (locale === 'en' ? '/app/' : `/${locale}/app/`) + path);
  await f.page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor();
  if (width < 800) await f.page.locator('[data-act=sb]').click();
  return { ...f, backend };
}
const deletion = page => page.locator('.sb .chat-delete[data-id=confirm-chat]');
const decision = page => page.getByRole('alertdialog');

for (const locale of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) test(`custom confirmation is centered, localized and safely cancellable at 320px: ${locale}`, async t => {
  const { page, backend, errors } = await open(t, { locale, width: 320 });
  await deletion(page).click();
  const dialog = decision(page); await dialog.waitFor();
  assert.equal(await dialog.getAttribute('aria-describedby'), 'app-confirm-message');
  assert.equal(await dialog.locator('[data-confirm-cancel]').evaluate(button => document.activeElement === button), true);
  assert.equal(await dialog.locator('h2').innerText() === 'Confirm this action', locale === 'en');
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 321 && box.y + box.height <= 761);
  assert.ok(Math.abs(box.x + box.width / 2 - 160) <= 1 && Math.abs(box.y + box.height / 2 - 380) <= 1, 'the application draws a centered modal');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.locator('[data-confirm-accept]').evaluate(button => document.activeElement === button), true);
  await page.keyboard.press('Tab');
  assert.equal(await dialog.locator('[data-confirm-cancel]').evaluate(button => document.activeElement === button), true);
  await page.keyboard.press('Control+k');
  assert.equal(await page.locator('[data-input=pal]').count(), 0);
  if (locale === 'zh') { await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: 'test-results/package-audit/custom-confirm-zh-mobile.png', fullPage: true }); }
  await page.keyboard.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await deletion(page).evaluate(button => document.activeElement === button), true);
  assert.equal(backend.state.writes.length, 0, 'default Enter cancels without deleting or saving');
  assert.equal(backend.state.chats.length, 1);
  assert.deepEqual(errors, []);
});

test('route changes invalidate an outstanding decision and a fresh confirmed deletion executes only once', async t => {
  const { page, backend, errors } = await open(t);
  await deletion(page).click();
  await decision(page).waitFor();
  await page.evaluate(() => { window.staleDecision = document.querySelector('[data-confirm-accept]'); location.hash = '/api'; });
  await decision(page).waitFor({ state: 'detached' });
  await page.evaluate(() => window.staleDecision.click());
  assert.equal(backend.state.writes.length, 0);
  assert.equal(backend.state.chats.length, 1);
  await page.evaluate(() => { location.hash = '/chat/confirm-chat'; });
  await deletion(page).click();
  await decision(page).waitFor();
  await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: 'test-results/package-audit/custom-confirm-en-desktop.png', fullPage: true });
  await page.evaluate(() => { const button = document.querySelector('[data-confirm-accept]'); button.click(); button.click(); });
  await deletion(page).waitFor({ state: 'detached' });
  assert.equal(backend.state.writes.filter(write => write.method === 'DELETE' && write.path === '/api/app/chats/confirm-chat').length, 1);
  assert.deepEqual(errors, []);
});

test('session expiration closes the decision and its detached accept button cannot write for the former session', async t => {
  const { page, backend, errors } = await open(t);
  await deletion(page).click(); await decision(page).waitFor();
  backend.state.signedIn = false;
  await page.evaluate(() => {
    const button = document.querySelector('[data-confirm-accept]');
    dispatchEvent(new CustomEvent('fells.session.changed', { detail: { audience: 'customer' } }));
    button.click();
  });
  await page.waitForURL(url => /\/app\/start\/?$/.test(url.pathname));
  assert.equal(backend.state.writes.length, 0);
  assert.equal(backend.state.chats.length, 1);
  assert.deepEqual(errors, []);
});

test('a rebate decision preserves the original account dialog; cancelling does not transfer and confirmation uses one frozen intent', async t => {
  const transfers = [];
  const { page, errors } = await open(t, { configure: async ({ context }) => {
    await context.route('**/api/app/referral', route => route.fulfill({ json: { active: true, name: 'Synthetic referral terms', stat: { code: 'SYNTHETIC', invited: 1, converted: 1 } } }));
    await context.route('**/api/app/rebates', route => route.fulfill({ json: { summary: { payable_micro: 2000000 }, hold_days: 7, window_months: 3 } }));
    await context.route('**/api/app/rebates/credit', route => { transfers.push({ body: route.request().postDataJSON(), key: route.request().headers()['idempotency-key'] }); return route.fulfill({ json: { ok: true } }); });
  } });
  await page.locator('.sb [data-act=invite]').click();
  await page.locator('[data-act=rebate-credit]').click();
  await decision(page).waitFor();
  assert.equal(await page.locator('.dlg [data-act=rebate-credit]').count(), 1, 'the original dialog is not replaced');
  await decision(page).locator('[data-confirm-cancel]').click();
  assert.equal(transfers.length, 0);
  assert.equal(await page.locator('[data-act=rebate-credit]').evaluate(button => document.activeElement === button), true);
  await page.locator('[data-act=rebate-credit]').click(); await acceptSiteConfirm(page);
  await page.locator('.scrim').waitFor({ state: 'detached' });
  assert.equal(transfers.length, 1); assert.equal(transfers[0].body.expected_payable, 2000000);
  assert.match(transfers[0].key, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(errors, []);
});

test('history import requires an in-page decision before uploading any selected content', async t => {
  const { page, backend, errors } = await open(t, { path: '#/import' });
  const picker = page.waitForEvent('filechooser'); await page.locator('[data-act=import-history]').click();
  await (await picker).setFiles({ name: 'private-history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ title: 'Private imported text', messages: [['you', 'Keep local until approved']] })) });
  await decision(page).waitFor();
  assert.equal(backend.state.writes.length, 0, 'choosing and parsing a file do not upload it');
  await page.keyboard.press('Escape');
  await decision(page).waitFor({ state: 'detached' });
  assert.equal(backend.state.writes.length, 0);
  assert.equal(backend.state.chats.length, 1);
  assert.deepEqual(errors, []);
});

test('leaving a workspace is explicitly confirmed and cancellation keeps membership', async t => {
  const { page, backend, errors } = await open(t, { role: 'viewer', path: '#/members' });
  await page.locator('[data-act=leave-workspace]').click();
  await decision(page).locator('[data-confirm-cancel]').click();
  assert.equal(backend.state.workspaces.length, 1); assert.equal(backend.state.writes.length, 0);
  await page.locator('[data-act=leave-workspace]').click(); await acceptSiteConfirm(page);
  await page.locator('[data-act=leave-workspace]').waitFor({ state: 'detached' });
  assert.equal(backend.state.workspaces.length, 0);
  assert.equal(backend.state.writes.filter(write => write.path.endsWith('/leave')).length, 1);
  assert.deepEqual(errors, []);
});
