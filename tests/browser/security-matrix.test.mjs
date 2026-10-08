import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { chromium, firefox, webkit } from 'playwright';
import { createBrowserFixture, enterPreview, createWorkspace } from '../helpers/browser.mjs';

async function go(page, route) {
  await page.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
  await page.evaluate(route => { location.hash = '#/' + route; }, route);
  await page.locator(`[data-form=env]`).waitFor();
}

async function activeRecord(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('fells.preview.v2', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('preview');
      const read = tx.objectStore('preview').get('active');
      read.onsuccess = () => resolve(read.result ?? null);
      tx.oncomplete = () => db.close();
      tx.onabort = () => reject(tx.error);
    };
  }));
}

async function nativeSubmission(page, formSelector) {
  await page.route('**/*', route => route.request().isNavigationRequest() && route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>Local audit interception</p>' })
    : route.continue());
  const submitted = page.waitForRequest(request => request.isNavigationRequest() && request.method() === 'POST');
  await page.locator(formSelector).evaluate(form => HTMLFormElement.prototype.submit.call(form));
  const request = await submitted;
  await page.locator('p').filter({ hasText: 'Local audit interception' }).waitFor();
  return { method: request.method(), url: request.url(), body: request.postData() ?? '' };
}

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

    await t.test('hostile persisted text stays literal, secrets avoid URLs/storage, and logout revokes both tabs', async t => {
      const { context, page, base, errors } = await fixture.setup(t);
      const hostileName = '<img src=x onerror=globalThis.__auditXss=1>';
      const secret = 'DUMMY-MATRIX-ENV-SECRET';
      await enterPreview(page, base);
      await createWorkspace(page, hostileName);
      assert.equal(await page.locator('#fx img[src=x]').count(), 0);
      assert.equal(await page.evaluate(() => globalThis.__auditXss), undefined);
      assert.equal((await activeRecord(page)).state.workspaces[0].name, hostileName);
      await go(page, 'ws-settings/1');
      await page.locator('[data-form=env] [name=k]').fill('DUMMY_TOKEN');
      await page.locator('[data-env-value]').fill(secret);
      await page.locator('[data-form=env] button').click();
      await page.locator('[data-act=env-del]').waitFor();
      assert.equal(JSON.stringify(await activeRecord(page)).includes(secret), false);
      assert.equal(await page.evaluate(secret => JSON.stringify([localStorage, sessionStorage]).includes(secret), secret), false);
      await page.locator('[data-form=env] [name=k]').fill('DUMMY_NATIVE_TOKEN');
      await page.locator('[data-env-value]').fill(secret);
      const submitted = await nativeSubmission(page, '[data-form=env]');
      assert.equal(submitted.method, 'POST');
      assert.equal((submitted.url + submitted.body).includes(secret), false);
      await page.goto(base + '/app/#/ws-settings/1');
      await page.locator('[data-form=env]').waitFor();
      assert.equal(await page.locator('[data-act=env-del]').count(), 0);
      assert.equal(await page.locator('#fx img[src=x]').count(), 0);
      assert.equal(await page.evaluate(() => globalThis.__auditXss), undefined);
      const second = await context.newPage();
      await second.goto(base + '/app/');
      await second.locator('#fx .sb').waitFor();
      await page.locator('[data-act=account]').click();
      await page.locator('[data-act=logout]').click();
      await page.waitForURL(/\/app\/start\/?$/);
      await second.waitForURL(/\/app\/start\/?$/);
      assert.equal(await activeRecord(page), null);
      assert.deepEqual(errors, []);
    });

    await t.test('native checkout submission omits CDK and no-script entry/checkout remain disabled', async t => {
      const { page, base, errors } = await fixture.setup(t);
      const secret = 'DUMMY-MATRIX-CDK-SECRET';
      await page.goto(base + '/checkout/?mode=redeem');
      await page.locator('[data-field=cdk]').fill(secret);
      await page.locator('[name=email]').fill('matrix@example.invalid');
      const submitted = await nativeSubmission(page, '[data-checkout]');
      assert.equal(submitted.method, 'POST');
      assert.equal((submitted.url + submitted.body).includes(secret), false);
      assert.deepEqual(errors, []);
      const noScript = await fixture.setup(t, { javaScriptEnabled: false });
      await noScript.page.goto(base + '/app/start/');
      assert.equal(await noScript.page.locator('#auth-email').isDisabled(), true);
      assert.equal(await noScript.page.locator('[data-auth-form] [type=submit]').isDisabled(), true);
      await noScript.page.goto(base + '/checkout/?mode=redeem');
      assert.equal(await noScript.page.locator('[data-field=cdk]').isDisabled(), true);
      assert.equal(await noScript.page.locator('[data-submit]').isDisabled(), true);
      assert.deepEqual(noScript.errors, []);
    });
  });
}
