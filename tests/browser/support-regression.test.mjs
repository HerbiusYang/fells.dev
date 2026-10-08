import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64');
before(() => fixture.start());
after(() => fixture.stop());

async function customer(page, base) {
  await page.goto(base + '/zh/app/start/');
  await page.locator('#auth-email').fill('support-regression@example.invalid');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-act=ob-skip]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('[data-support-open]').click();
  return page;
}

async function operator(context, base, portal) {
  assert.ok(portal, 'Support regressions require an operator fixture');
  const page = await context.newPage();
  await page.goto(`${base}/zh/${portal}/`);
  await page.locator('#support-name').fill('Regression operator');
  await page.locator('#support-email').fill('support@example.invalid');
  await page.locator('[data-support-login-form] [type=submit]').click();
  await page.locator('[data-support-search]').waitFor({ state: 'visible' });
  return page;
}

async function selectCustomer(desk) {
  await desk.locator('[data-support-conversation]').filter({ hasText: 'support-regression@example.invalid' }).click();
  await desk.locator('[data-support-chat]').waitFor({ state: 'visible' });
}

test('removing the selected customer closes the modal details drawer and restores the inbox', async t => {
  const { context, page, base, portal, errors } = await fixture.setup(t, { viewport: { width: 1000, height: 700 } });
  const userPage = await customer(page, base);
  await userPage.locator('[data-support-text]').fill('Customer leaves while details are open');
  await userPage.locator('[data-support-send]').click();
  await userPage.locator('[data-support-message]').waitFor({ state: 'attached' });
  const desk = await operator(context, base, portal);
  await desk.locator('[data-support-seed]').click();
  await desk.locator('[data-support-conversation=demo-alex]').waitFor();
  await selectCustomer(desk);
  await desk.locator('[data-support-details]').click();
  const details = desk.locator('[data-support-detail-panel]');
  await details.waitFor({ state: 'visible' });
  assert.equal(await details.getAttribute('aria-modal'), 'true');
  assert.equal(await desk.locator('.support-topbar').evaluate(element => element.inert), true);

  await userPage.bringToFront();
  await userPage.locator('[data-support-close]').click();
  await userPage.locator('[data-act=account]').click();
  await userPage.locator('[data-act=logout]').click();
  await desk.locator('[data-support-conversation]').filter({ hasText: 'support-regression@example.invalid' }).waitFor({ state: 'detached' });
  await details.waitFor({ state: 'hidden' });
  assert.equal(await details.getAttribute('aria-modal'), null);
  assert.equal(await desk.locator('[data-support-console]').getAttribute('data-details'), 'false');
  assert.equal(await desk.locator('[data-support-details]').getAttribute('aria-expanded'), 'false');
  assert.equal(await desk.locator('[inert]').count(), 0, 'the covering drawer releases all inert surfaces');

  await desk.bringToFront();
  assert.equal(await desk.locator('[data-support-search]').evaluate(element => document.activeElement === element), true, 'focus returns to the visible inbox');
  await desk.locator('[data-support-search]').fill('Alex');
  await desk.locator('[data-support-conversation=demo-alex]').click();
  await desk.locator('[data-support-customer-name]').filter({ hasText: 'Alex Morgan' }).waitFor();
  assert.deepEqual(errors, []);
});

test('customer and operator keep keyboard focus on a history image when a new message arrives', async t => {
  const { context, page, base, portal, errors } = await fixture.setup(t, { viewport: { width: 1000, height: 700 } });
  const userPage = await customer(page, base);
  await userPage.locator('[data-support-file]').setInputFiles({ name: 'focus.png', mimeType: 'image/png', buffer: png });
  await userPage.locator('[data-support-preview]').waitFor({ state: 'visible' });
  await userPage.locator('[data-support-send]').click();
  await userPage.locator('[data-support-image]').waitFor();
  const desk = await operator(context, base, portal);
  await selectCustomer(desk);
  await desk.locator('[data-support-image]').waitFor();
  await userPage.locator('[data-support-receipt][data-read=true]').waitFor();

  for (const focusedPage of [desk, userPage]) {
    const other = focusedPage === desk ? userPage : desk;
    await focusedPage.bringToFront();
    const image = focusedPage.locator('[data-support-image]').first();
    await image.focus();
    assert.equal(await image.evaluate(element => document.activeElement === element), true);
    const incoming = focusedPage === desk ? 'Customer sends during keyboard navigation' : 'Operator sends during keyboard navigation';
    // Submit in the background so the receiver keeps its keyboard focus while
    // the normal send handler and cross-tab refresh process the new message.
    await other.evaluate(text => {
      const input = document.querySelector('[data-support-text]');
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.closest('form').requestSubmit();
    }, incoming);
    await focusedPage.locator('[data-support-message]').filter({ hasText: incoming }).waitFor({ state: 'attached' });
    assert.equal(await image.evaluate(element => document.activeElement === element), true, 'the same history image keeps focus after refresh');
    await focusedPage.keyboard.press('Enter');
    await focusedPage.locator('.support-image-viewer').waitFor({ state: 'visible' });
    await focusedPage.locator('.support-image-viewer img').evaluate(element => element.decode());
    await focusedPage.keyboard.press('Escape');
    assert.equal(await image.evaluate(element => document.activeElement === element), true, 'image keyboard navigation still works after refresh');
  }
  assert.deepEqual(errors, []);
});

test('keyboard history navigation cannot pull either chat away from a newly sent message', async t => {
  const { context, page, base, portal, errors } = await fixture.setup(t, { viewport: { width: 390, height: 844 } });
  const userPage = await customer(page, base);
  await userPage.locator('[data-support-text]').fill('Keyboard scrolling regression');
  await userPage.locator('[data-support-send]').click();
  await userPage.locator('[data-support-message]').waitFor({ state: 'attached' });
  const desk = await operator(context, base, portal);
  await selectCustomer(desk);
  for (let index = 0; index < 6; index++) {
    const body = `Long history ${index}: ${'History must remain readable while another reply arrives. '.repeat(25)}`;
    await desk.locator('[data-support-text]').fill(body);
    await desk.locator('[data-support-send]').click();
    await desk.locator('[data-support-message]').filter({ hasText: body }).waitFor({ state: 'attached' });
    await desk.waitForFunction(() => document.querySelector('[data-support-composer]').getAttribute('aria-busy') === 'false');
  }
  await userPage.locator('[data-support-message][data-sender=agent]').nth(5).waitFor({ state: 'attached' });
  for (const chat of [userPage, desk]) {
    await chat.bringToFront();
    const history = chat.locator('[data-support-messages]');
    await history.press('End');
    await history.press('PageUp');
    assert.ok(await history.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight > 100), 'PageUp reads earlier messages');
    await history.press('ArrowDown');
    await history.press('Home');
    assert.ok(await history.evaluate(element => element.scrollTop <= 1), 'Home reaches the beginning before returning control');
    const outgoing = chat === userPage ? 'Customer sends immediately after Home' : 'Operator sends immediately after Home';
    await chat.evaluate(body => {
      const input = document.querySelector('[data-support-text]');
      input.value = body;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.closest('form').requestSubmit();
    }, outgoing);
    await chat.locator('[data-support-message]').filter({ hasText: outgoing }).waitFor({ state: 'attached' });
    await chat.waitForFunction(() => document.querySelector('[data-support-text]').closest('form').getAttribute('aria-busy') === 'false');
    // Check multiple rendered frames, not just the synchronous scrollTop write:
    // the previous native Home animation used to overwrite it on the next frame.
    const remaining = await history.evaluate(async element => {
      const values = [];
      for (let frame = 0; frame < 4; frame++) {
        await new Promise(requestAnimationFrame);
        values.push(element.scrollHeight - element.scrollTop - element.clientHeight);
      }
      return values;
    });
    assert.ok(remaining.every(value => value <= 1), `the newest message stays visible after sending: ${remaining.join(', ')}`);
  }
  assert.deepEqual(errors, []);
});
