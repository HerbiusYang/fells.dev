import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, refresh } from './helpers/support-http-fixture.mjs';

let environment;
before(async () => { environment = await supportBrowser(); });
after(async () => { await environment?.close(); });

async function appFixture(t, options = {}) {
  const fixture = await supportFixture(t, environment, options);
  const workspace = { id: 'workspace-1', name: 'Test workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
  await fixture.context.route('**/api/app/workspaces', route => route.fulfill({ json: { workspaces: [workspace] } }));
  await fixture.context.route('**/api/app/workspaces/workspace-1/chats', route => route.fulfill({ json: { chats: [] } }));
  await fixture.context.route('**/api/app/workspaces/workspace-1/members', route => route.fulfill({ json: { members: [{ user_id: 42, name: 'Customer', role: 'owner' }] } }));
  const page = await fixture.context.newPage();
  await page.goto(environment.base + '/zh/app/#/new');
  // Account data triggers a second render after the initial chat form appears.
  // Wait for that render before measuring the composer and support launcher.
  await page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor({ state: 'attached' });
  await page.locator('#fx [data-form="send"]').waitFor({ state: 'visible' });
  await page.locator('[data-support-open]').waitFor({ state: 'visible' });
  return { ...fixture, page };
}

async function launcherRect(page) {
  return page.locator('[data-support-open]').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: innerWidth - rect.right, bottom: innerHeight - rect.bottom };
  });
}

function sameRect(actual, expected, reason) {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1, `${reason}: ${key} changed (${JSON.stringify(actual)})`);
}

test('support launcher stays at the viewport edge across scrolling, route changes, panel toggles and resize', async t => {
  const { page, errors } = await appFixture(t, { viewport: { width: 1440, height: 900 } });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport);
    // Chromium can expose the new innerWidth/matchMedia result before applying
    // responsive styles. Cross a completed rendering frame before measuring;
    // the exact edge assertions below still detect incorrect product CSS.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => { location.hash = '#/new'; });
    await page.locator('#fx [data-form="send"]').waitFor({ state: 'visible' });
    const expected = await launcherRect(page);
    assert.equal(expected.right, viewport.width <= 560 ? 12 : 24);
    assert.equal(expected.bottom, viewport.width <= 560 ? 12 : 22);
    assert.ok(expected.x >= 0 && expected.y >= 0, 'launcher remains inside the viewport');
    const composer = await page.locator('#fx [data-form="send"]').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { y: rect.y, height: rect.height };
    });
    assert.ok(composer.height > 0, 'chat composer is laid out');
    assert.ok(composer.y + composer.height + 8 <= expected.y, 'support does not cover chat input or send controls');

    await page.locator('#fx .main .scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    sameRect(await launcherRect(page), expected, 'scrolling');
    await page.evaluate(() => { location.hash = '#/billing/market'; });
    await page.waitForFunction(() => document.getElementById('fx')?.dataset.route === '#/billing/market');
    sameRect(await launcherRect(page), expected, 'switching from chat to market');
    await page.locator('[data-support-open]').click();
    await page.locator('#support-panel').waitFor({ state: 'visible' });
    const panel = await page.locator('#support-panel').boundingBox();
    assert.ok(panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width && panel.y + panel.height <= viewport.height, 'support panel stays in view');
    await page.locator('[data-support-close]').click();
    sameRect(await launcherRect(page), expected, 'closing support');
  }
  assert.deepEqual(errors, []);
});

test('availability changes and unread badges do not resize or move the support launcher', async t => {
  const fixture = await appFixture(t, { viewport: { width: 1280, height: 800 } });
  const { page } = fixture;
  // The availability reader pauses in hidden documents. Make this test's page
  // active explicitly instead of relying on which context Chromium foregrounds.
  await refresh(page);
  try {
    await page.locator('.support-launcher [data-support-availability-dot][data-state="offline"]').waitFor();
  } catch (failure) {
    t.diagnostic(JSON.stringify({
      support: await page.locator('#support-widget').evaluate(root => ({
        hidden: root.hidden, state: root.querySelector('[data-support-availability-dot]')?.getAttribute('data-state'),
        error: root.querySelector('[data-support-error]')?.textContent,
        history: root.querySelector('[data-support-messages]')?.textContent,
        pageHidden: document.hidden, online: navigator.onLine,
      })),
      calls: fixture.calls.filter(call => call.path.startsWith('/api/support/')).map(({ path, method, headers }) => ({ path, method, audience: headers['x-fells-support-audience'] })),
      errors: fixture.errors,
    }));
    throw failure;
  }
  const expected = await launcherRect(page);
  fixture.state.online = true;
  await refresh(page);
  await page.locator('.support-launcher [data-support-availability-dot][data-state="online"]').waitFor();
  sameRect(await launcherRect(page), expected, 'availability update');
  fixture.state.messages.push(...Array.from({ length: 12 }, (_, i) => ({
    id: String(31 + i), clientMessageId: `reply-${i}`, conversationId: '21', sender: 'agent',
    text: `Reply ${i}`, attachments: [], createdAt: new Date(1700000001000 + i).toISOString(),
  })));
  await refresh(page);
  await page.locator('[data-support-unread]').filter({ hasText: '12' }).waitFor({ state: 'visible' });
  sameRect(await launcherRect(page), expected, 'unread badge');
  assert.deepEqual(fixture.errors, []);
});
