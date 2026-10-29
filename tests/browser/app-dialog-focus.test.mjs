import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[0], [0], [0], [0]], promoClosed: true, sbHidden: false };

async function open(t, path = '/app/', viewport = { width: 1280, height: 900 }) {
  const backend = createAppBackend({ preferences: structuredClone(preferences) });
  const session = await fixture.setup(t, { viewport });
  await backend.install(session.context);
  await session.page.goto(session.base + path);
  await session.page.locator('#fx .sb').waitFor();
  return { ...session, backend };
}

const focusedInside = page => page.locator('.dlg').evaluate(dialog => dialog.contains(document.activeElement));

for (const prefix of ['', '/zh', '/zh-hant', '/ja', '/ko', '/es']) {
  for (const viewport of [{ width: 320, height: 640 }, { width: 844, height: 390 }]) {
    test(`${prefix || 'en'} ${viewport.width}x${viewport.height} keeps workspace-dialog keyboard focus contained`, async t => {
      const { page, backend, errors } = await open(t, prefix + '/app/', viewport);
      const opener = page.locator('.wcard[data-act=new-ws]');
      await opener.click();
      const dialog = page.locator('.dlg');
      const input = dialog.locator('[name=name]');
      await input.fill('Unsubmitted keyboard draft');
      await dialog.locator('.x[data-act=close]').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog.locator('button.btn.pri').evaluate(element => document.activeElement === element), true);
      await page.keyboard.press('Tab');
      assert.equal(await dialog.locator('.x[data-act=close]').evaluate(element => document.activeElement === element), true);
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab');
        assert.equal(await focusedInside(page), true, 'Tab never reaches navigation behind the overlay');
      }
      await page.evaluate(() => document.querySelector('.sb [data-go=api]').focus());
      assert.equal(await focusedInside(page), true, 'programmatic focus cannot escape to the background');
      await page.locator('a.skip').focus();
      assert.equal(await focusedInside(page), true, 'focusin also contains links outside the application root');
      for (const shortcut of ['Control+Shift+o', 'Control+/', 'Control+k', 'Meta+Shift+o', 'Meta+/', 'Meta+k']) {
        await page.keyboard.press(shortcut);
        assert.equal(await input.inputValue(), 'Unsubmitted keyboard draft');
        assert.equal(await dialog.count(), 1, 'background shortcuts do not replace the form');
        assert.equal(new URL(page.url()).hash, '');
      }
      const box = await dialog.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
        `dialog fits ${viewport.width}x${viewport.height}`);
      assert.equal(await page.locator('#fx > .main').evaluate(element => element.inert), true);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await opener.evaluate(element => document.activeElement === element), true);
      assert.equal(await page.locator('#fx > .main').evaluate(element => element.inert), false);
      assert.equal(backend.state.writes.length, 0, 'opening, typing, shortcuts and closing never save the draft');
      assert.deepEqual(errors, []);
    });
  }
}

test('a dialog opened from the switcher returns focus to the attached switcher trigger', async t => {
  const { page, backend, errors } = await open(t);
  const trigger = page.locator('.sb [data-act=switcher]');
  await trigger.click();
  await page.locator('.pop [data-act=new-ws]').click();
  await page.locator('.dlg [name=name]').fill('Keep the menu opener');
  await page.keyboard.press('Escape');
  await page.locator('.dlg').waitFor({ state: 'detached' });
  assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
  assert.equal(backend.state.writes.length, 0);
  assert.deepEqual(errors, []);
});

test('a same-route rerender preserves the live dialog, its draft and its focus scope', async t => {
  const { page, backend, errors } = await open(t);
  const opener = page.locator('.wcard[data-act=new-ws]');
  await opener.click();
  const input = page.locator('.dlg [name=name]');
  await input.fill('Draft survives reattachment');
  await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
  assert.equal(await input.inputValue(), 'Draft survives reattachment');
  assert.equal(await input.evaluate(element => document.activeElement === element), true);
  assert.equal(await page.locator('#fx > .main').evaluate(element => element.inert), true);
  await page.locator('.dlg button.btn.pri').focus();
  await page.keyboard.press('Tab');
  assert.equal(await focusedInside(page), true);
  await page.keyboard.press('Escape');
  await page.locator('.dlg').waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(element => document.activeElement === element), true);
  assert.equal(backend.state.writes.length, 0);
  assert.deepEqual(errors, []);
});

test('a native dialog above the app keeps its own focus and Escape does not dismiss the underlying form', async t => {
  const { page, errors } = await open(t);
  await page.locator('.wcard[data-act=new-ws]').click();
  const input = page.locator('.dlg [name=name]');
  await input.fill('Draft beneath a native dialog');
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.dataset.syntheticNativeDialog = '';
    const button = document.createElement('button');
    button.textContent = 'Synthetic native dialog';
    dialog.append(button); document.body.append(dialog);
    dialog.showModal(); button.focus();
  });
  assert.equal(await page.locator('[data-synthetic-native-dialog] button').evaluate(element => document.activeElement === element), true);
  await page.keyboard.press('Escape');
  await page.locator('[data-synthetic-native-dialog]').waitFor({ state: 'hidden' });
  assert.equal(await input.inputValue(), 'Draft beneath a native dialog');
  assert.equal(await focusedInside(page), true);
  await page.keyboard.press('Escape');
  await page.locator('.dlg').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});


test('the command palette keeps its own Ctrl+K toggle and returns focus', async t => {
  const { page, errors } = await open(t);
  const input = page.locator('#fx-input');
  await input.focus(); await page.keyboard.press('Control+k');
  await page.locator('[data-input=pal]').waitFor();
  await page.keyboard.press('Control+k');
  await page.locator('.scrim').waitFor({ state: 'detached' });
  assert.equal(await input.evaluate(element => document.activeElement === element), true);
  assert.deepEqual(errors, []);
});
