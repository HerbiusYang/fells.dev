import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const buildDirectory = () => resolve(process.env.TEST_DIST_DIR || 'dist');

export function requireSupportPortal(t, portal) {
  if (portal) return true;
  assert.notEqual(process.env.TEST_REQUIRE_SUPPORT_PORTAL, '1', 'The complete support suite requires a configured operator build');
  t.skip('Operator pages are intentionally absent in the unconfigured build');
  return false;
}

// Record actual browser execution, including navigations and pages opened by a test.
// The collector is enabled only by the coverage runner; normal tests have no overhead.
export async function trackCoverage(context, options = {}) {
  const directory = process.env.TEST_BROWSER_COVERAGE_DIR;
  if (!directory || options.javaScriptEnabled === false || context.browser()?.browserType().name() !== 'chromium') return;
  if (context.__fellsCoverage) return;
  context.__fellsCoverage = true;
  const pages = new Map();
  const newPage = context.newPage.bind(context), close = context.close.bind(context);
  async function collect(page, restart = false) {
    if (!pages.has(page)) return;
    const entries = await page.coverage.stopJSCoverage();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, randomUUID() + '.json'), JSON.stringify(entries));
    if (restart) await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true });
    else pages.delete(page);
  }
  context.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true });
    pages.set(page, true);
    // Flush before explicit test navigations so Chrome cannot discard an earlier
    // document's profile during garbage collection. Click navigations retain the
    // normal Playwright resetOnNavigation:false behavior.
    for (const method of ['goto', 'reload', 'goBack', 'goForward']) {
      const navigate = page[method].bind(page);
      page[method] = async (...navigationArgs) => { await collect(page, true); return navigate(...navigationArgs); };
    }
    const pageClose = page.close.bind(page);
    page.close = async (...closeArgs) => { await collect(page); return pageClose(...closeArgs); };
    return page;
  };
  context.close = async (...args) => {
    // Collection failures must fail the suite instead of producing inflated coverage.
    try { for (const page of [...pages.keys()]) await collect(page); }
    finally { await close(...args); }
  };
}

export function createBrowserFixture(engine = chromium) {
  let server, browser, base, portal;
  const dist = buildDirectory();
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.map': 'application/json' };
  return {
    async start() {
      for (const entry of await readdir(dist, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try { if ((await readFile(join(dist, entry.name, 'index.html'), 'utf8')).includes('data-support-login')) portal = entry.name; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const text = await readFile(join(dist, '_headers'), 'utf8');
      const headers = Object.fromEntries([...text.matchAll(/^  ([^:]+): (.+)$/gm)].map(([, key, value]) => [key, value]));
      server = createServer(async (request, response) => {
        try {
          let path = resolve(dist, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
          if (path !== dist && !path.startsWith(dist + '/')) { response.writeHead(403).end(); return; }
          if ((await stat(path)).isDirectory()) path += '/index.html';
          response.writeHead(200, { ...headers, 'content-type': mime[extname(path)] || 'application/octet-stream' });
          response.end(await readFile(path));
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      browser = await engine.launch({ headless: true, timeout: 30000, ...(engine === chromium && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    },
    async stop() {
      await browser?.close();
      if (server) await new Promise(resolve => server.close(resolve));
    },
    async setup(t, options = {}) {
      const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
      await trackCoverage(context, options);
      t.after(() => context.close());
      const errors = [];
      context.on('page', page => { page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message)); });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage();
      return { context, page, base, portal, errors };
    },
  };
}

export async function enterPreview(page, base, locale = '', email = 'audit@example.invalid') {
  await page.goto(base + locale + '/app/start/');
  await page.locator('#auth-email').fill(email);
  await page.locator('[data-auth-form] [type=submit]').click();
  await page.locator('[data-act=ob-skip]').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
}

export async function createWorkspace(page, name = 'Audit workspace') {
  await page.locator('[data-act=new-ws]').first().click();
  await page.locator('[data-form=new-ws] [name=name]').fill(name);
  await page.locator('[data-form=new-ws] .btn.pri').click();
  await page.locator('.scrim').waitFor({ state: 'detached' });
  await page.locator('#fx-input').waitFor();
}
