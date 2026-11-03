import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { mkdir } from 'node:fs/promises';

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
    assert.equal(await page.locator('[data-act=account]').evaluate(element => document.activeElement === element), true, 'nested-menu Escape restores the connected account trigger');

    await page.locator('[data-act=account]').click();
    await page.locator('.account-pop [data-act=lang]').click();
    const retainedMenu = await page.locator('#fx .pop').elementHandle();
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 80 });
    await page.waitForFunction(() => document.querySelector('#fx')?.style.getPropertyValue('--app-height') === `${innerHeight}px`);
    assert.equal(await retainedMenu.evaluate(element => element.isConnected), true, 'a viewport resize repositions the current menu');
    await assertWithinViewport(page, '#fx .pop');
    assert.deepEqual(errors, []);
  });
}

test('account menu labels the allowance expiry and keeps every action on one line', async t => {
  const { page, errors } = await openAccount(t, { width: 1280, height: 900 });
  const menu = page.locator('.account-pop');
  assert.match(await menu.locator('[data-allowance-expiry]').textContent(), /^有效期至 2030年/);
  assert.equal(await menu.getByText('暂无套餐').count(), 0, 'the market row does not claim a plan state it has not read');
  assert.equal((await menu.locator('[data-act=agreement]').textContent()).trim(), '服务条款');
  assert.equal(await menu.locator('.invite-banner small').textContent(), '查看当前推荐奖励规则');
  const amount = await menu.locator('.credit-row b').textContent();
  assert.ok((await page.locator('.me-btn small').textContent()).endsWith(amount), 'the sidebar shows the balance the menu reads');
  for (const item of await menu.locator('.account-links .mi, .mi.logout').all()) {
    const box = await item.boundingBox();
    assert.ok(box.height <= 40, `${await item.textContent()} stays on one line: ${box.height}`);
  }
  await mkdir('test-results/package-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/package-audit/ux-account-menu.png' });
  assert.deepEqual(errors, []);
});

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

async function openModels(t, viewport = { width: 390, height: 844 }) {
  const session = await fixture.setup(t, { viewport });
  const backend = createAppBackend({ modelChat: true,
    preferences: { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false },
    workspaces: [{ id: 'menu-space', name: 'Menu workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }],
    chatModels: [1, 2, 3].map(index => ({ model: `server/model-${index}`, label: `Server model ${index}`, format: 'openai-completions', formats: ['openai-completions'] })),
  });
  await backend.install(session.context);
  await session.page.goto(session.base + '/app/#/new');
  await session.page.locator('#fx-input:not(:disabled)').waitFor();
  return { ...session, backend };
}

test('model search survives a mobile keyboard-sized resize with its focus and query', async t => {
  const { page, backend, errors } = await openModels(t);
  const opener = page.locator('[data-act=model]');
  await opener.click();
  const search = page.locator('.pop [data-input=modelQ]');
  await search.fill('Server');
  const original = await search.elementHandle();
  await search.evaluate(element => element.setSelectionRange(2, 4));
  await page.setViewportSize({ width: 390, height: 420 });
  await page.waitForFunction(() => document.querySelector('#fx')?.style.getPropertyValue('--app-height') === '420px');
  assert.equal(await original.evaluate(element => element.isConnected && document.activeElement === element), true);
  assert.equal(await search.inputValue(), 'Server');
  assert.deepEqual(await search.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 4]);
  await assertWithinViewport(page, '#fx .pop');
  assert.equal(await page.locator('.pop [data-act=pick-model]').count(), 3);
  await mkdir('test-results/package-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/package-audit/ux-model-keyboard-390.png', fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await opener.evaluate(element => document.activeElement === element), true);
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.writes.length, 0);
  assert.deepEqual(errors, []);
});

test('model choices support arrows and Home/End while search retains its text-editing keys', async t => {
  const { page, backend, errors } = await openModels(t, { width: 1280, height: 900 });
  const opener = page.locator('[data-act=model]'); await opener.click();
  const search = page.locator('.pop [data-input=modelQ]'); await search.fill('Server');
  assert.equal(await search.evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  }), false, 'IME candidate cancellation is not intercepted as menu dismissal');
  assert.equal(await search.evaluate(element => element.isConnected && document.activeElement === element), true);
  assert.equal(await search.inputValue(), 'Server');
  await page.keyboard.press('Home'); assert.equal(await search.evaluate(element => element.selectionStart), 0);
  await page.keyboard.press('End'); assert.equal(await search.evaluate(element => element.selectionStart), 6);
  assert.equal(await search.evaluate(element => document.activeElement === element), true);
  const choices = page.locator('.pop [data-act=pick-model]');
  const active = async index => assert.equal(await choices.nth(index).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('ArrowDown'); await active(0);
  await page.keyboard.press('End'); await active(2);
  await page.keyboard.press('ArrowDown'); await active(0);
  await page.keyboard.press('ArrowUp'); await active(2);
  await page.keyboard.press('Home'); await active(0);
  await page.keyboard.press('Escape');
  assert.equal(await opener.evaluate(element => document.activeElement === element), true);
  assert.equal(backend.state.generations.length, 0); assert.equal(backend.state.writes.length, 0);
  assert.deepEqual(errors, []);
});

test('model choices are grouped by vendor with headings that stay out of keyboard order', async t => {
  const session = await fixture.setup(t, { viewport: { width: 1280, height: 900 } });
  const backend = createAppBackend({ modelChat: true,
    preferences: { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false },
    workspaces: [{ id: 'menu-space', name: 'Menu workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' }],
    chatModels: [
      { model: 'gpt-5.5', label: 'GPT-5.5', vendor: 'OpenAI', format: 'openai-responses', formats: ['openai-responses'] },
      { model: 'server/model-x', label: 'Server model', format: 'openai-completions', formats: ['openai-completions'] },
      { model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', vendor: 'Anthropic', format: 'anthropic-messages', formats: ['anthropic-messages'] },
    ],
  });
  await backend.install(session.context);
  const { page, errors } = session;
  await page.goto(session.base + '/zh/app/#/new');
  await page.locator('#fx-input:not(:disabled)').waitFor();
  const opener = page.locator('[data-act=model]'); await opener.click();
  const headings = page.locator('.pop [data-model-group]');
  const choices = page.locator('.pop [data-act=pick-model]');
  assert.deepEqual(await headings.allTextContents(), ['Claude', 'ChatGPT', '其他模型']);
  assert.deepEqual(await choices.evaluateAll(items => items.map(item => item.dataset.name)), ['claude-sonnet-5-5', 'gpt-5.5', 'server/model-x']);
  await page.keyboard.press('ArrowDown');
  assert.equal(await choices.nth(0).evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await choices.nth(1).evaluate(element => document.activeElement === element), true);
  const search = page.locator('.pop [data-input=modelQ]'); await search.fill('chatgpt');
  assert.deepEqual(await headings.allTextContents(), ['ChatGPT']);
  assert.equal(await choices.count(), 1);
  await mkdir('test-results/package-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/package-audit/ux-model-vendor-groups.png' });
  await choices.first().click();
  assert.match(await opener.textContent(), /GPT-5\.5/);
  assert.equal(await opener.locator('.aimk').count(), 1, 'the composer shows the chosen vendor mark');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('an app dialog follows a shrunken and panned visual viewport without losing its draft', async t => {
  const session = await fixture.setup(t, { viewport: { width: 320, height: 640 } });
  const backend = createAppBackend({ preferences: { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false } });
  await backend.install(session.context);
  await session.context.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { width: 320, height: 640, scale: 1, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.__setVisualViewport = (height, offsetTop) => {
      viewport.height = height; viewport.offsetTop = offsetTop;
      viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
    };
  });
  const { page, errors } = session;
  await page.goto(session.base + '/zh/app/');
  const opener = page.locator('.wcard[data-act=new-ws]'); await opener.click();
  const input = page.locator('.dlg [name=name]'); await input.fill('Keyboard-visible draft');
  const original = await input.elementHandle();
  await page.evaluate(() => window.__setVisualViewport(300, 180));
  await page.waitForFunction(() => document.querySelector('#fx')?.style.getPropertyValue('--app-height') === '300px');
  assert.equal(await original.evaluate(element => element.isConnected && document.activeElement === element), true);
  assert.equal(await input.inputValue(), 'Keyboard-visible draft');
  const dialog = await page.locator('.dlg').boundingBox();
  assert.ok(dialog && dialog.x >= 0 && dialog.x + dialog.width <= 320 && dialog.y >= 180 && dialog.y + dialog.height <= 480,
    `dialog fits the simulated visible keyboard viewport: ${JSON.stringify(dialog)}`);
  const save = page.locator('.dlg button.btn.pri'); await save.scrollIntoViewIfNeeded();
  const action = await save.boundingBox();
  assert.ok(action && action.y >= 180 && action.y + action.height <= 480, 'the submit action is reachable inside the visible viewport');
  await mkdir('test-results/package-audit', { recursive: true });
  await page.screenshot({ path: 'test-results/package-audit/ux-dialog-visual-viewport-320.png', fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await opener.evaluate(element => document.activeElement === element), true);
  assert.equal(backend.state.writes.length, 0); assert.deepEqual(errors, []);
});
