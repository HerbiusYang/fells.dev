import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture, enterPreview, createWorkspace } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());
const locales = ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'];

test('public customer widget remains usable in all locales without an operator entry', async t => {
  for (const locale of locales) {
    const { context, page, base, portal, errors } = await fixture.setup(t, { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    if (process.env.TEST_REQUIRE_SUPPORT_PORTAL === '0') assert.equal(portal, undefined, 'unconfigured output omits the operator entry');
    await enterPreview(page, base, locale);
    const launcher = page.locator('[data-support-open]');
    await launcher.waitFor({ state: 'visible' });
    await launcher.focus();
    await launcher.press('Enter');
    await page.locator('#support-panel').waitFor({ state: 'visible' });
    for (const selector of ['#support-panel', '[data-support-form]']) {
      const size = await page.locator(selector).evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: element.scrollWidth - element.clientWidth, width: innerWidth, height: innerHeight };
      });
      assert.ok(size.left >= -1 && size.right <= size.width + 1 && size.top >= -1 && size.bottom <= size.height + 1 && size.overflow <= 1, `${locale} ${selector}: ${JSON.stringify(size)}`);
    }
    for (const selector of ['[data-support-close]', '[data-support-send]', '.support-attach']) {
      const rect = await page.locator(selector).boundingBox();
      assert.ok(rect.width >= 44 && rect.height >= 44, `${locale} ${selector} touch target`);
    }
    await page.locator('[data-support-text]').fill(`Public widget message ${locale || 'en'}`);
    await page.locator('[data-support-send]').click();
    await page.locator('[data-support-message]').filter({ hasText: `Public widget message ${locale || 'en'}` }).waitFor();
    await page.locator('[data-support-close]').click();
    assert.equal(await launcher.evaluate(element => document.activeElement === element), true, 'closing returns keyboard focus to the launcher');
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('the support launcher leaves the main chat send button clickable across desktop and mobile breakpoints', async t => {
  for (const width of [390, 1100, 1101, 1280, 1440, 1920]) {
    const { context, page, base, errors } = await fixture.setup(t, { viewport: { width, height: 720 } });
    await enterPreview(page, base);
    await createWorkspace(page);
    await page.locator('[data-support-open]').waitFor({ state: 'visible' });
    await page.locator('[data-support-availability-dot][data-state=offline]').first().waitFor({ state: 'attached' });
    await page.locator('#fx-input').fill(`Message at ${width}px`);
    const send = page.locator('[data-form=send] .send');
    assert.equal(await send.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return top === element || element.contains(top);
    }), true, `${width}px main send button receives pointer events`);
    await send.click();
    await page.locator('.msg-body').filter({ hasText: `Message at ${width}px` }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
});
