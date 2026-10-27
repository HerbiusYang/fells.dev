import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { normalState, STATUS_PATH } from '../../edge/maintenance/state.mjs';

const buildDirectory = () => resolve(process.env.TEST_DIST_DIR || 'dist');

// Apply the deployment headers to every fixture server. Otherwise contract
// tests can pass while the same business flow is blocked in the deployed UI.
export async function readBuildHeaders(dist = buildDirectory()) {
  const text = await readFile(join(dist, '_headers'), 'utf8');
  let applies = false;
  const headers = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) { applies = line.trim() === "/*"; continue; }
    const field = /^  ([^:]+): (.+)$/.exec(line);
    if (applies && field) headers[field[1]] = field[2];
  }
  return headers;
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
      portal = 'support';
      const headers = await readBuildHeaders(dist);
      const maintenanceStatus = JSON.stringify(normalState());
      server = createServer(async (request, response) => {
        try {
          const pathname = new URL(request.url, 'http://localhost').pathname;
          // The deployed edge owns this route independently of static files
          // and account APIs. Specific maintenance scenarios can override it.
          if (pathname === STATUS_PATH) {
            const allowed = request.method === 'GET' || request.method === 'HEAD';
            response.writeHead(allowed ? 200 : 405, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(!allowed ? { Allow: 'GET, HEAD' } : {}) });
            response.end(request.method === 'HEAD' ? undefined : allowed ? maintenanceStatus : JSON.stringify({ error: 'Method not allowed' }));
            return;
          }
          let path = resolve(dist, '.' + decodeURIComponent(pathname));
          if (path !== dist && !path.startsWith(dist + '/')) { response.writeHead(403).end(); return; }
          if ((await stat(path)).isDirectory()) path += '/index.html';
          response.writeHead(200, { ...headers, 'content-type': mime[extname(path)] || 'application/octet-stream' });
          response.end(await readFile(path));
        } catch { response.writeHead(404, headers).end(); }
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
