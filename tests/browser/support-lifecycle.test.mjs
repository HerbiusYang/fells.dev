import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, enterPreview } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

async function holdCommittedSupportResponse(page, mode) {
  await page.evaluate(mode => {
    window.__supportHold = mode;
    window.__supportHeld = false;
    const transaction = IDBDatabase.prototype.transaction;
    const complete = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args), keys = new Set();
      const objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const store = objectStore(name), get = store.get.bind(store);
        store.get = key => { keys.add(key); return get(key); };
        return store;
      };
      Object.defineProperty(tx, 'oncomplete', {
        set(handler) {
          complete.set.call(tx, event => {
            if (window.__supportHold === tx.mode && keys.has('support.demo') && ![...keys].some(key => String(key).startsWith('support.typing.') || key === 'support.availability.agent')) {
              window.__supportHold = null;
              window.__supportHeld = true;
              window.__releaseSupport = () => handler.call(tx, event);
            } else handler.call(tx, event);
          });
        },
        get() { return complete.get.call(tx); },
      });
      return tx;
    };
    window.dispatchEvent(new Event('focus'));
  }, mode);
  await page.waitForFunction(() => window.__supportHeld === true);
}

async function send(page, message) {
  await page.locator('[data-support-text]').fill(message);
  await page.locator('[data-support-send]').click();
  await page.locator('[data-support-message]').filter({ hasText: message }).waitFor({ state: 'attached' });
  await page.waitForFunction(() => document.querySelector('[data-support-text]').closest('form').getAttribute('aria-busy') === 'false');
}

for (const transition of ['logout', 'account replacement']) test(`a customer refresh committed before ${transition} cannot paint its late private response`, async t => {
  const { context, page, base, errors } = await fixture.setup(t);
  // Notifications are best effort: exercise the response boundary independently
  // of a cross-tab logout notification, using a real committed IndexedDB read.
  await context.addInitScript(() => { window.BroadcastChannel = undefined; });
  await enterPreview(page, base, '/zh', 'late-response@example.invalid');
  await page.locator('[data-support-open]').click();
  await send(page, 'Initial customer message');
  const other = await context.newPage();
  await other.goto(base + '/zh/app/');
  await other.locator('[data-support-open]').click();
  const privateMessage = 'Private message captured before the customer session ended';
  await send(other, privateMessage);
  assert.equal(await page.locator('[data-support-message]').filter({ hasText: privateMessage }).count(), 0);
  await page.evaluate(() => {
    // Pause unrelated availability polling so it cannot revoke the widget and
    // conceal a missing session check at the held response boundary.
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
  });
  await holdCommittedSupportResponse(page, 'readwrite');
  await other.locator('[data-support-close]').click();
  await other.locator('[data-act=account]').click();
  await other.locator('[data-act=logout]').click();
  await other.locator('#auth-email').waitFor();
  if (transition === 'account replacement') {
    await other.locator('#auth-email').fill('replacement@example.invalid');
    await other.locator('[data-auth-form] [type=submit]').click();
    await other.locator('[data-act=ob-skip]').click();
    await other.locator('.scrim').waitFor({ state: 'detached' });
  }
  assert.equal(await page.locator('#support-widget').evaluate(element => element.hidden), false, 'the held response has not been released or revoked by another mechanism');
  await page.evaluate(() => window.__releaseSupport());
  await page.waitForFunction(message => document.querySelector('#support-widget').hidden || document.querySelector('[data-support-messages]').textContent.includes(message), privateMessage);
  assert.equal(await page.locator('#support-widget').evaluate(element => element.hidden), true, 'the expired widget stops before displaying a late response');
  assert.equal(await page.locator('[data-support-message]').count(), 0, 'private history is purged');
  assert.deepEqual(errors, []);
});
