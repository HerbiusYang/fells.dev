import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function openAccount(t, viewport) {
  const { context, page, base, errors } = await fixture.setup(t, { viewport, colorScheme: 'dark' });
  const backend = createAppBackend({ preferences: {
    theme: 'dark', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false],
    onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false,
  } });
  await backend.install(context);
  await page.goto(base + '/zh/app/#/settings/0');
  await page.locator('[data-act=account]').waitFor();
  if (viewport.width <= 860) await page.locator('[data-act=sb]').click();
  await page.locator('[data-act=account]').click();
  await page.locator('.account-pop [data-act=lang]').waitFor();
  return { page, base, errors };
}

async function assertWithinViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box, `${selector} is visible`);
  assert.ok(box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7,
    `${selector} stays inside the viewport: ${JSON.stringify({ box, viewport })}`);
  return box;
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 900, height: 540 }, { width: 390, height: 844 }]) {
  test(`language menu stays beside its account trigger at ${viewport.width}x${viewport.height}`, async t => {
    const { page, base, errors } = await openAccount(t, viewport);
    await assertWithinViewport(page, '.account-pop');
    const trigger = await page.locator('.account-pop [data-act=lang]').boundingBox();
    assert.ok(trigger.y > viewport.height / 2, 'the language trigger starts in the lower half of the console');
    await page.locator('.account-pop [data-act=lang]').click();
    assert.equal(await page.locator('.account-pop').count(), 0, 'language choices replace the account menu');
    const menu = await assertWithinViewport(page, '#fx .pop');
    const gap = Math.min(Math.abs(menu.y - trigger.y - trigger.height), Math.abs(trigger.y - menu.y - menu.height));
    assert.ok(gap <= 12, `the language menu remains next to the removed trigger, gap=${gap}`);
    assert.ok(menu.x < trigger.x + trigger.width && menu.x + menu.width > trigger.x, 'the menu horizontally overlaps its trigger');
    assert.equal(await page.locator('#fx .pop a').count(), 6);
    assert.equal(await page.locator('#fx .pop a').filter({ hasText: '简体中文' }).locator('.end').count(), 1);

    const japanese = page.locator('#fx .pop a').filter({ hasText: '日本語' });
    const target = new URL(await japanese.getAttribute('href'), base);
    assert.equal(target.pathname, '/ja/app');
    assert.equal(target.hash, '#/settings/0', 'locale changes preserve the current console route');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#fx .pop').count(), 0);

    await page.locator('[data-act=account]').click();
    await page.locator('.account-pop [data-act=lang]').click();
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 });
    await page.locator('#fx .pop').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  });
}

test('account menu remains usable when the console is shorter than the full menu', async t => {
  const { page, errors } = await openAccount(t, { width: 900, height: 360 });
  await assertWithinViewport(page, '.account-pop');
  const language = page.locator('.account-pop [data-act=lang]');
  await language.scrollIntoViewIfNeeded();
  const trigger = await language.boundingBox();
  assert.ok(trigger.y >= 8 && trigger.y + trigger.height <= 352, 'the last account control is reachable inside the viewport');
  await language.click();
  await assertWithinViewport(page, '#fx .pop');
  assert.equal(await page.locator('#fx .pop a').count(), 6);
  assert.deepEqual(errors, []);
});
