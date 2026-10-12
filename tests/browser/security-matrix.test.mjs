import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { chromium, firefox, webkit } from 'playwright';
import { createBrowserFixture } from '../helpers/browser.mjs';

for (const [name, engine] of [['Chromium', chromium], ['Firefox', firefox], ['WebKit', webkit]]) {
  test(`${name} security boundary matrix`, async t => {
    if (engine !== chromium) {
      try { await access(engine.executablePath()); }
      catch (error) {
        if (process.env.TEST_REQUIRE_BROWSERS === '1') throw error;
        t.skip(`${name} runtime is missing; security compatibility is unverified`); return;
      }
    }
    const fixture = createBrowserFixture(engine);
    t.after(() => fixture.stop());
    try { await fixture.start(); }
    catch (error) {
      if (engine !== chromium && process.env.TEST_REQUIRE_BROWSERS !== '1' && /sandbox_extension_issue_file_to_process|RenderCompositorSWGL|Host system is missing dependencies/i.test(error.message)) {
        t.skip(`${name} host requirements are unavailable; security compatibility is unverified`); return;
      }
      throw error;
    }

    await t.test('no-script account entry stays disabled and the retired checkout form is absent', async t => {
      const { page, base, errors } = await fixture.setup(t, { javaScriptEnabled: false });
      await page.goto(base + '/app/start/');
      assert.equal(await page.locator('#auth-email').isDisabled(), true);
      assert.equal(await page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
      await page.goto(base + '/checkout/?mode=redeem');
      assert.equal(await page.locator('[data-checkout], [data-field=cdk]').count(), 0);
      assert.deepEqual(errors, []);
    });
  });
}
