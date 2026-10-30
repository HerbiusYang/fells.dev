import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';
const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
async function open(t, locale = 'en') {
  const f = await fixture.setup(t);
  const backend = createAppBackend({ preferences, keys: [{ id: 17, name: 'Production tool key', prefix: 'sk-synthetic-safe-prefix', kind: 'user', revoked: false, created_at: 1700000000 }] });
  await backend.install(f.context);
  await f.page.addInitScript(() => { window.keyCopies = []; navigator.clipboard.writeText = async value => window.keyCopies.push(value); });
  await f.page.goto(f.base + (locale === 'en' ? '/app/' : `/${locale}/app/`) + '#/api');
  await f.page.locator('[data-act=revoke][data-id="17"]').waitFor();
  return { ...f, backend };
}
const creations = backend => backend.state.writes.filter(write => write.method === 'POST' && write.path === '/api/app/keys');
async function create(page, limit = '12.345678') {
  await page.locator('.bar [data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('Explicitly limited key');
  await page.locator('[data-form=key] [name=limit]').fill(limit);
  await page.locator('[data-form=key] .btn.pri').click();
  await page.locator('[data-key-secret]').waitFor();
}

test('key creation sends the exact monthly limit in the single creation transaction', async t => {
  const { page, backend, errors } = await open(t); await create(page);
  assert.deepEqual(creations(backend).map(write => write.body), [{ name: 'Explicitly limited key', monthly_micro: 12345678 }]);
  assert.equal(backend.state.writes.some(write => /\/keys\/\d+\/limits$/.test(write.path)), false);
  assert.equal(backend.state.keys.find(key => key.name === 'Explicitly limited key').limit, 12345678);
  assert.deepEqual(errors, []);
});

for (const locale of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) test(`invalid key limits show a local field error without creating an unlimited key: ${locale}`, async t => {
  const { page, backend, errors } = await open(t, locale);
  await page.locator('.bar [data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('Must not be created');
  for (const value of ['abc', '-1', '1e3', '1.0000001', '9007199254740992']) {
    await page.locator('[data-form=key] [name=limit]').fill(value);
    await page.locator('[data-form=key] .btn.pri').click();
    assert.ok((await page.locator('[data-key-error]').innerText()).length > 0);
    assert.equal(await page.locator('[data-form=key] [name=limit]').getAttribute('aria-invalid'), 'true');
    assert.equal(creations(backend).length, 0);
  }
  await page.locator('[data-form=key] [name=limit]').fill('0');
  await page.locator('[data-form=key] .btn.pri').click();
  await page.locator('[data-key-secret]').waitFor();
  assert.equal(creations(backend)[0].body.monthly_micro, 0, 'explicit zero keeps the documented default limit');
  assert.deepEqual(errors, []);
});

test('one-time secret survives Escape, backdrop, shortcuts and account refresh, then closes only after explicit consent or copy', async t => {
  const { page, backend, errors } = await open(t); await create(page);
  const secret = await page.locator('[data-key-secret] pre').innerText();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.locator('.scrim').click({ position: { x: 2, y: 2 } });
  assert.equal(await page.locator('[data-key-secret] pre').innerText(), secret);
  backend.state.profile.name = 'Refreshed account';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.me-btn b').filter({ hasText: 'Refreshed account' }).waitFor();
  assert.equal(await page.locator('[data-key-secret] pre').innerText(), secret);
  await page.locator('[data-key-secret] [data-act=close]').click();
  await page.getByRole('alertdialog').locator('[data-confirm-cancel]').click();
  assert.equal(await page.locator('[data-key-secret]').count(), 1, 'declining discard retains the only copy');
  assert.equal((await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(secret), false);
  await page.locator('[data-key-secret] [data-act=copy]').click();
  assert.equal(await page.evaluate(() => window.keyCopies.at(-1)), secret);
  await page.locator('[data-key-secret] [data-act=close]').click();
  await page.locator('[data-key-secret]').waitFor({ state: 'detached' });
  assert.equal(creations(backend).length, 1);
  assert.deepEqual(errors, []);
});

test('revoke first shows the exact key name and prefix and cancellation cannot revoke it', async t => {
  const { page, backend, errors } = await open(t, 'zh');
  await page.locator('[data-act=revoke][data-id="17"]').click();
  const dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /Production tool key/); assert.match(await dialog.innerText(), /sk-synthetic-safe-prefix/);
  assert.equal(backend.state.keys[0].revoked, false);
  await dialog.locator('.x[data-act=close]').click();
  assert.equal(backend.state.keys[0].revoked, false);
  await page.locator('[data-act=revoke][data-id="17"]').click();
  await page.locator('[data-act=key-revoke-confirm]').click();
  await page.locator('[data-act=revoke][data-id="17"]').waitFor({ state: 'detached' });
  assert.equal(backend.state.keys[0].revoked, true);
  assert.equal(backend.state.writes.filter(write => /\/keys\/17\/revoke$/.test(write.path)).length, 1);
  assert.deepEqual(errors, []);
});

test('an uncopied secret survives a cancelled in-app route change and leaves only after a drawn discard decision', async t => {
  const { page, backend, errors } = await open(t); await create(page);
  const secret = await page.locator('[data-key-secret] pre').innerText();
  await page.evaluate(() => { location.hash = '/billing/credits'; });
  await page.getByRole('alertdialog').waitFor();
  assert.equal(await page.locator('[data-key-secret] pre').innerText(), secret);
  assert.equal(new URL(page.url()).hash, '#/api', 'the requested route is held until consent');
  await page.getByRole('alertdialog').locator('[data-confirm-cancel]').click();
  assert.equal(await page.locator('[data-key-secret] pre').innerText(), secret);
  assert.equal(new URL(page.url()).hash, '#/api');
  await page.evaluate(() => { location.hash = '/billing/credits'; });
  await acceptSiteConfirm(page);
  await page.waitForURL(url => url.hash === '#/billing/credits');
  assert.equal(await page.locator('[data-key-secret]').count(), 0);
  assert.equal((await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(secret), false);
  assert.equal(creations(backend).length, 1);
  assert.deepEqual(errors, []);
});

test('refreshing an uncopied secret shows no browser leave prompt and never persists the secret', async t => {
  const { page, backend, errors } = await open(t); await create(page);
  const secret = await page.locator('[data-key-secret] pre').innerText();
  assert.match(await page.locator('[data-key-secret]').innerText(), /Refreshing or closing this tab/);
  await page.reload();
  await page.locator('.bar [data-act=new-key]').waitFor();
  assert.equal(await page.locator('[data-key-secret]').count(), 0, 'refresh is honest about the nonrecoverable one-time display');
  assert.equal((await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(secret), false);
  assert.equal(creations(backend).length, 1);
  assert.deepEqual(errors, []);
});
