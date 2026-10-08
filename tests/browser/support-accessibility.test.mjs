import { trackCoverage, requireSupportPortal } from '../helpers/browser.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat, access } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

const dist = resolve(process.env.TEST_DIST_DIR || 'dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const locales = ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4k+kBAAOCAX62ByEmAAAAAElFTkSuQmCC', 'base64');
let server, browser, base, portal;
const portalPath = (locale, desk = false) => `${locale}/${portal}${desk ? '/desk' : ''}/`;
function requirePortal(t) { return requireSupportPortal(t, portal); }
before(async () => {
  for (const entry of await readdir(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      if ((await readFile(resolve(dist, entry.name, 'index.html'), 'utf8')).includes('data-support-login')) portal = entry.name;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  server = createServer(async (req, res) => {
    try {
      let path = resolve(dist, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (path !== dist && !path.startsWith(dist + '/')) { res.writeHead(403).end(); return; }
      if ((await stat(path)).isDirectory()) path += '/index.html';
      res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      res.end(await readFile(path));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function contextFor(t, options = {}, engine = browser) {
  const context = await engine.newContext({ reducedMotion: 'reduce', ...options });
  await trackCoverage(context, options);
  t.after(() => context.close());
  const errors = [];
  context.on('page', page => { page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message)); });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return { context, errors };
}
async function operator(context, locale = '/zh') {
  const page = await context.newPage();
  await page.goto(base + portalPath(locale));
  await page.locator('#support-name').fill('A long support operator name');
  await page.locator('#support-email').fill('support@example.invalid');
  await page.locator('[data-support-login-form] [type=submit]').click();
  await page.waitForURL(url => url.pathname.replace(/\/$/, '') === portalPath(locale, true).replace(/\/$/, ''));
  await page.locator('[data-support-search]').waitFor({ state: 'visible' });
  return page;
}
async function seedAndSelect(page) {
  await page.locator('[data-support-seed]').first().click();
  await page.locator('[data-support-conversation=demo-alex]').waitFor();
  await page.locator('[data-support-conversation=demo-alex]').click();
  await page.locator('[data-support-chat]').waitFor({ state: 'visible' });
}
async function customer(context, locale = '/zh') {
  const page = await context.newPage();
  await page.goto(base + locale + '/app/start/');
  await page.locator('#auth-email').fill('accessibility@example.invalid');
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-act=ob-skip]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('[data-support-open]').click();
  return page;
}
async function assertUsableSurface(page, selector, description) {
  const result = await page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight, overflow: element.scrollWidth - element.clientWidth };
  });
  assert.ok(result.left >= -1 && result.right <= result.viewportWidth + 1, `${description} fits horizontally: ${JSON.stringify(result)}`);
  assert.ok(result.top >= -1 && result.bottom <= result.viewportHeight + 1, `${description} fits vertically: ${JSON.stringify(result)}`);
  assert.ok(result.overflow <= 1, `${description} has no internal horizontal overflow`);
}

test('all six locales keep operator controls and the customer widget usable at 320px', async t => {
  if (!requirePortal(t)) return;
  for (const locale of locales) {
    const { context, errors } = await contextFor(t, { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
    const desk = await operator(context, locale);
    assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${locale || 'English'} inbox fits`);
    await seedAndSelect(desk);
    await desk.locator('[data-support-text]').fill('a'.repeat(3600));
    await desk.locator('[data-support-character-count]').waitFor({ state: 'visible' });
    await assertUsableSurface(desk, '[data-support-composer]', `${locale || 'English'} mobile composer`);
    for (const selector of ['[data-support-back]', '[data-support-details]', '[data-support-status]', '[data-support-attach]', '[data-support-send]']) {
      const dimensions = await desk.locator(selector).evaluate(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; });
      assert.ok(dimensions.width >= 44 && dimensions.height >= 44, `${locale || 'English'} ${selector} has a 44px touch target`);
    }
    await desk.locator('[data-support-details]').click();
    await assertUsableSurface(desk, '[data-support-detail-panel]', `${locale || 'English'} details`);
    await desk.keyboard.press('Escape');
    assert.equal(await desk.locator('[data-support-details]').getAttribute('aria-expanded'), 'false');
    const userPage = await customer(context, locale);
    await assertUsableSurface(userPage, '#support-panel', `${locale || 'English'} customer panel`);
    await assertUsableSurface(userPage, '[data-support-form]', `${locale || 'English'} customer composer`);
    for (const selector of ['[data-support-close]', '[data-support-send]', '.support-attach']) {
      const dimensions = await userPage.locator(selector).evaluate(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height }; });
      assert.ok(dimensions.width >= 44 && dimensions.height >= 44, `${locale || 'English'} customer ${selector} has a 44px touch target`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('short landscape and 200% equivalent viewports keep history and send controls visible', async t => {
  if (!requirePortal(t)) return;
  for (const viewport of [{ width: 844, height: 390 }, { width: 1000, height: 320 }, { width: 768, height: 384 }, { width: 640, height: 360 }]) {
    const { context, errors } = await contextFor(t, { viewport, ...(viewport.width === 844 ? { isMobile: true, hasTouch: true } : {}) });
    const desk = await operator(context, '/es');
    await seedAndSelect(desk);
    await desk.locator('[data-support-status]').click();
    await desk.locator('[data-support-resolved-notice]').waitFor({ state: 'visible' });
    await desk.locator('[data-support-file]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
    await desk.locator('[data-support-attachment]').waitFor({ state: 'visible' });
    const text = 'Respuesta de prueba '.repeat(190);
    await desk.locator('[data-support-text]').fill(text);
    await desk.locator('[data-support-character-count]').waitFor({ state: 'visible' });
    await assertUsableSurface(desk, '[data-support-composer]', `${viewport.width}×${viewport.height} operator composer`);
    const history = await desk.locator('[data-support-messages]').boundingBox();
    assert.ok(history.height >= 60, `${viewport.width}×${viewport.height} retains a readable message viewport (${history.height}px)`);
    await desk.locator('[data-support-send]').focus();
    await assertUsableSurface(desk, '[data-support-send]', `${viewport.width}×${viewport.height} focused send control`);
    await desk.locator('[data-support-send]').click();
    await desk.locator('[data-support-message]').filter({ hasText: text.trim() }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
});

test('mobile conversation navigation and the customer-details drawer keep keyboard focus visible', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await contextFor(t, { viewport: { width: 320, height: 568 } });
  const desk = await operator(context);
  await desk.locator('[data-support-seed]').first().click();
  const conversation = desk.locator('[data-support-conversation=demo-alex]');
  await conversation.focus();
  await conversation.press('Enter');
  await desk.locator('[data-support-chat]').waitFor({ state: 'visible' });
  assert.equal(await desk.locator('[data-support-messages]').evaluate(element => document.activeElement === element), true, 'keyboard conversation selection moves focus into visible history');
  const detailsButton = desk.locator('[data-support-details]');
  await detailsButton.focus();
  await detailsButton.press('Enter');
  await desk.locator('[data-support-detail-panel]').waitFor({ state: 'visible' });
  assert.equal(await desk.locator('[data-support-details-close]').evaluate(element => document.activeElement === element), true, 'opening the covering drawer moves focus to its close control');
  for (let i = 0; i < 6; i++) {
    await desk.keyboard.press('Tab');
    assert.equal(await desk.locator('[data-support-detail-panel]').evaluate(element => element.contains(document.activeElement)), true, 'Tab stays in the covering details drawer');
  }
  await desk.keyboard.press('Escape');
  assert.equal(await detailsButton.evaluate(element => document.activeElement === element), true, 'Escape returns focus to the details trigger');
  await desk.locator('[data-support-back]').focus();
  await desk.locator('[data-support-back]').press('Enter');
  assert.equal(await conversation.evaluate(element => document.activeElement === element), true, 'returning to the inbox restores the selected customer');
  assert.deepEqual(errors, []);
});

test('image dialogs contain keyboard focus and restore their trigger for customer and operator', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await contextFor(t, { viewport: { width: 320, height: 568 } });
  const customerPage = await customer(context);
  await customerPage.locator('[data-support-file]').setInputFiles({ name: 'keyboard-image.png', mimeType: 'image/png', buffer: png });
  await customerPage.locator('[data-support-preview]').waitFor({ state: 'visible' });
  await customerPage.locator('[data-support-send]').click();
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'accessibility@example.invalid' }).click();
  await desk.locator('[data-support-image]').waitFor();
  await customerPage.locator('[data-support-message]').filter({ has: customerPage.locator('[data-support-image]') }).locator('[data-support-receipt][data-read=true]').waitFor();
  for (const page of [customerPage, desk]) {
    await page.bringToFront();
    const trigger = page.locator('[data-support-image]').first();
    await trigger.focus();
    await trigger.press('Enter');
    await page.locator('.support-image-viewer').waitFor({ state: 'visible' });
    await page.locator('.support-image-viewer img').evaluate(image => image.decode());
    await assertUsableSurface(page, '.support-image-viewer', 'image dialog');
    assert.equal(await page.locator('.support-image-viewer').evaluate(element => element.contains(document.activeElement)), true);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.support-image-viewer').evaluate(element => element.contains(document.activeElement)), true, 'native modal prevents keyboard access to covered chat');
    const other = page === customerPage ? desk : customerPage;
    const incoming = page === customerPage ? 'Reply while viewing an image' : 'Question while viewing an image';
    await other.locator('[data-support-text]').fill(incoming);
    await other.locator('[data-support-send]').click();
    await page.locator('[data-support-message]').filter({ hasText: incoming }).waitFor({ state: 'attached' });
    await page.bringToFront();
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'Escape restores the image trigger even after an incoming message replaces the history markup');
    assert.equal(await page.locator('.support-image-viewer img').getAttribute('src'), null, 'closing releases the image URL');
  }
  assert.deepEqual(errors, []);
});

test('long unbroken customer names remain contained in message metadata and customer details', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await contextFor(t, { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  const userPage = await customer(context);
  const longName = 'CustomerName'.repeat(5).slice(0, 40);
  await userPage.locator('[data-support-close]').click();
  await userPage.evaluate(() => { location.hash = '#/settings/0'; });
  await userPage.locator('[data-form=profile] [name=name]').fill(longName);
  await userPage.locator('[data-form=profile] .btn.pri').click();
  await userPage.waitForFunction(() => document.querySelector('#fx')?.getAttribute('aria-busy') !== 'true');
  await userPage.locator('[data-support-open]').click();
  await userPage.locator('[data-support-text]').fill('Long profile layout');
  await userPage.locator('[data-support-send]').click();
  await userPage.locator('[data-support-message]').filter({ hasText: 'Long profile layout' }).waitFor();
  const desk = await operator(context);
  await desk.locator('[data-support-conversation]').filter({ hasText: 'accessibility@example.invalid' }).click();
  for (const page of [userPage, desk]) {
    await page.waitForFunction(name => Array.from(document.querySelectorAll('[data-support-messages] .support-message-meta span')).some(element => element.textContent === name), longName);
    const history = page.locator('[data-support-messages]');
    const dimensions = await history.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth,
      authors: Array.from(element.querySelectorAll('.support-message-meta')).map(meta => ({ width: meta.getBoundingClientRect().width, scrollWidth: meta.scrollWidth })) }));
    assert.ok(dimensions.scrollWidth <= dimensions.width + 1, `${page === userPage ? 'Customer' : 'Operator'} message author names do not create horizontal scrolling: ${JSON.stringify(dimensions)}`);
  }
  await desk.locator('[data-support-details]').click();
  const panel = desk.locator('[data-support-detail-panel]');
  assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'long customer names remain inside the details drawer');
  assert.deepEqual(errors, []);
});

function luminance(rgb) {
  const channels = rgb.map(value => { const scaled = value / 255; return scaled <= .04045 ? scaled / 12.92 : ((scaled + .055) / 1.055) ** 2.4; });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
async function textContrast(locator) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const colors = await locator.evaluate(element => {
      // Receipt and presence updates can replace inbox nodes between resolving
      // the locator and evaluating it. Measure a fresh attached node instead.
      if (!element.isConnected) return null;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas color conversion is unavailable');
      const parse = color => {
        // Use the browser's CSS parser for rgb(), color(), oklch(), etc. An
        // invalid value leaves fillStyle unchanged and must fail the test.
        context.fillStyle = '#000'; context.fillStyle = color;
        const parsed = context.fillStyle;
        context.fillStyle = '#fff'; context.fillStyle = color;
        if (context.fillStyle !== parsed) throw new Error(`Unsupported computed color: ${color}`);
        context.clearRect(0, 0, 1, 1);
        context.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
        return [r, g, b, a / 255];
      };
      const blend = (source, background) => source.slice(0, 3).map((channel, index) => channel * source[3] + background[index] * (1 - source[3]));
      const layers = [];
      for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) layers.push(parse(getComputedStyle(ancestor).backgroundColor));
      const background = layers.reverse().reduce((result, layer) => blend(layer, result), [255, 255, 255]);
      return { foreground: blend(parse(getComputedStyle(element).color), background), background };
    });
    if (!colors) continue;
    const a = luminance(colors.foreground), b = luminance(colors.background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }
  assert.fail('The contrast target kept detaching during measurement');
}
test('small operator text, resolved status and primary actions meet 4.5:1 text contrast', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await contextFor(t);
  const desk = await operator(context);
  await seedAndSelect(desk);
  await desk.locator('[data-support-text]').fill('Accessible contrast');
  const selectors = ['.support-sidebar-heading', '.support-sidebar-note p', '.support-agent-profile small', '.support-conversation-email', '.support-conversation-preview', '.support-message-meta span', '.support-message-body p', '[data-support-send]', '.support-conversation-state.is-resolved'];
  for (const selector of selectors) {
    const ratio = await textContrast(desk.locator(selector).first());
    assert.ok(ratio >= 4.5, `${selector} contrast is ${ratio.toFixed(2)}:1`);
  }
  await desk.locator('[data-support-status]').click();
  await desk.locator('[data-support-resolved-notice]').waitFor({ state: 'visible' });
  const ratio = await textContrast(desk.locator('[data-support-resolved-notice]'));
  assert.ok(ratio >= 4.5, `resolved notice contrast is ${ratio.toFixed(2)}:1`);
  assert.deepEqual(errors, []);
});

test('keyboard input focus remains visible and reduced motion suppresses interaction transitions', async t => {
  if (!requirePortal(t)) return;
  const { context, errors } = await contextFor(t);
  const desk = await operator(context);
  await seedAndSelect(desk);
  await desk.locator('[data-support-search]').focus();
  const searchFocus = await desk.locator('.support-search-box').evaluate(element => ({ border: getComputedStyle(element).borderColor, shadow: getComputedStyle(element).boxShadow }));
  assert.notEqual(searchFocus.shadow, 'none', 'the search field exposes a visible focus boundary');
  await desk.locator('[data-support-text]').focus();
  const composerFocus = await desk.locator('[data-support-composer]').evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: parseFloat(getComputedStyle(element).outlineWidth) }));
  assert.equal(composerFocus.style, 'solid');
  assert.ok(composerFocus.width >= 2, 'textarea keyboard focus has a visible 2px composer outline');
  for (const selector of ['.support-conversation', '[data-support-composer]', '[data-support-send]']) {
    const durations = await desk.locator(selector).first().evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(parseFloat));
    assert.ok(durations.every(duration => duration === 0), `${selector} respects reduced motion`);
  }
  assert.deepEqual(errors, []);
});

for (const [name, engine] of [['Firefox', firefox], ['WebKit', webkit]]) {
  test(`${name} customer and operator chat smoke test when the browser runtime is installed`, async t => {
    if (!requirePortal(t)) return;
    try { await access(engine.executablePath()); } catch (error) {
      if (process.env.TEST_REQUIRE_BROWSERS === '1') throw error;
      t.skip(`${name} browser runtime is not installed; no compatibility pass is claimed`); return;
    }
    let instance;
    try { instance = await engine.launch({ headless: true, timeout: 30000 }); }
    catch (error) {
      if (process.env.TEST_REQUIRE_BROWSERS !== '1' && /sandbox_extension_issue_file_to_process|RenderCompositorSWGL|Host system is missing dependencies/i.test(error.message)) {
        t.diagnostic(error.message.match(/sandbox_extension_issue_file_to_process[^\n]*|RenderCompositorSWGL[^\n]*|Host system is missing dependencies[^\n]*/i)?.[0] || 'Browser host requirements unavailable');
        t.skip(`${name} runtime cannot launch in this host session because its sandbox or graphics requirements are unavailable; compatibility remains unverified`);
        return;
      }
      throw error;
    }
    t.after(() => instance.close());
    const { context, errors } = await contextFor(t, { viewport: { width: 390, height: 844 } }, instance);
    const userPage = await customer(context);
    await userPage.locator('[data-support-text]').fill(`${name} customer question`);
    await userPage.locator('[data-support-send]').click();
    const desk = await operator(context);
    await desk.locator('[data-support-conversation]').filter({ hasText: 'accessibility@example.invalid' }).click();
    await desk.locator('[data-support-message]').filter({ hasText: `${name} customer question` }).waitFor();
    await desk.locator('[data-support-text]').fill(`${name} operator reply`);
    await desk.locator('[data-support-send]').click();
    await userPage.locator('[data-support-message]').filter({ hasText: `${name} operator reply` }).waitFor();
    await userPage.bringToFront();
    await userPage.locator('#support-panel [data-support-availability-dot][data-state=online]').waitFor({ state: 'attached' });
    await userPage.locator('[data-support-file]').setInputFiles({ name: 'cross-browser.png', mimeType: 'image/png', buffer: png });
    await userPage.locator('[data-support-preview]').waitFor({ state: 'visible' });
    await userPage.locator('[data-support-send]').click();
    await desk.bringToFront();
    const image = desk.locator('[data-support-image]').first();
    await image.waitFor();
    await image.focus();
    await image.press('Enter');
    await desk.locator('.support-image-viewer').waitFor({ state: 'visible' });
    await desk.locator('.support-image-viewer img').evaluate(element => element.decode());
    assert.equal(await desk.locator('.support-image-viewer img').evaluate(element => element.naturalWidth), 1);
    await desk.keyboard.press('Escape');
    assert.equal(await image.evaluate(element => document.activeElement === element), true, `${name} restores modal focus`);
    await desk.locator('[data-support-details]').focus();
    await desk.locator('[data-support-details]').press('Enter');
    await desk.locator('[data-support-detail-panel]').waitFor({ state: 'visible' });
    await desk.keyboard.press('Tab');
    assert.equal(await desk.locator('[data-support-detail-panel]').evaluate(element => element.contains(document.activeElement)), true, `${name} keeps focus in the covering details drawer`);
    await desk.keyboard.press('Escape');
    await assertUsableSurface(desk, '[data-support-composer]', `${name} mobile composer`);
    assert.deepEqual(errors, []);
  });
}
