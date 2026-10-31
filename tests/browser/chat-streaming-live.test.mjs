import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// The joint runner enables this separate suite and requires five passes with
// zero skips. Ordinary static browser jobs do not have the real Go/PG fixture.
test('real Go/PG browser streaming sees provider text before EOF, restores the same run and completes two deliberate requests', { timeout: 180000 }, async t => {
  if (process.env.FELLS_CHAT_STREAMING_LIVE !== '1') { t.skip('Requires isolated Go/PostgreSQL and the loopback streaming provider'); return; }
  assert.equal(process.platform, 'linux');
  assert.ok(process.env.GITHUB_ACTIONS === 'true' || process.env.FELLS_LOCAL_SYNTHETIC_ACCEPTANCE === '1', 'Requires GitHub CI or explicit local synthetic acceptance');
  const ready = JSON.parse(await readFile(process.env.FELLS_PACKAGE_FIXTURE_FILE, 'utf8')), fixture = ready.chatStreaming;
  assert.equal(ready.disposableDatabase, true); assert.equal(ready.realAccessVerification, true); assert.equal(fixture?.schemaVersion, 1); assert.equal(fixture.synthetic, true); assert.equal(fixture.realProviderCallsAllowed, false);
  assert.equal(fixture.initialAllowanceMicro, 10_000_000); assert.equal(fixture.expectedChargeMicroPerCall, 10);
  const publicURL = new URL(ready.publicBase); assert.equal(publicURL.protocol, 'http:'); assert.equal(publicURL.hostname, '127.0.0.1'); assert.ok(publicURL.port);
  for (const path of [fixture.statePath, fixture.releasePath]) assert.match(path, /^\/__chat_stream_fixture\/[a-z-]+$/);
  const evidence = resolve(process.env.FELLS_ACCESS_EVIDENCE_DIR); await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  t.after(() => browser.close());
  const errors = [], paid = [], cancellations = [], screenshots = [], checks = [];
  let phase = 'sign in', page;
  const record = { schemaVersion: 1, status: 'running', executionKind: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'local-synthetic', scope: 'Synthetic real Go handlers, disposable PostgreSQL, real gateway and loopback Anthropic SSE provider; no external provider or payment', checks, screenshots };
  async function login(username, password, width) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce', colorScheme: 'light' });
    await context.route('**/*', route => new URL(route.request().url()).origin === publicURL.origin ? route.continue() : route.abort());
    const current = await context.newPage(); current.setDefaultTimeout(15000);
    current.on('pageerror', error => errors.push(error.message));
    current.on('dialog', async dialog => { errors.push('Unexpected native ' + dialog.type()); await dialog.dismiss(); });
    current.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.endsWith('/generate')) paid.push({ path, body: request.postDataJSON() });
      if (request.method() === 'POST' && path.endsWith('/cancel')) cancellations.push({ path, body: request.postDataJSON() });
    });
    await current.goto(new URL('/zh/app/start/', publicURL).href);
    await current.locator('#auth-email').fill(username); await current.locator('#auth-password').fill(password); await current.locator('[data-auth-form] [type=submit]').click();
    await current.waitForURL(url => /^\/zh\/app\/?$/.test(url.pathname));
    await current.locator('#fx:not([aria-busy=true])').waitFor();
    let reply = await context.request.get(new URL('/api/app/bootstrap', publicURL).href); assert.equal(reply.status(), 200); let bootstrap = await reply.json();
    if (!bootstrap.agreement.accepted) {
      const agreement = current.locator('[data-form=agreement]'); await agreement.locator('[name=consent]').check();
      const accepted = current.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/app/agreement/accept');
      await agreement.locator('button').click(); assert.equal((await accepted).status(), 200); await agreement.waitFor({ state: 'detached' });
      reply = await context.request.get(new URL('/api/app/bootstrap', publicURL).href); assert.equal(reply.status(), 200); bootstrap = await reply.json();
      assert.equal(bootstrap.agreement.accepted, true);
    }
    return { context, page: current, headers: { Origin: publicURL.origin, 'X-Fells-Expected-User': String(bootstrap.user.id), 'X-Fells-Expected-Session': bootstrap.session_id }, bootstrap };
  }
  const capture = async name => { const file = `chat-streaming-live-${name}.png`; await page.screenshot({ path: resolve(evidence, file), fullPage: true, animations: 'disabled' }); screenshots.push(file); };
  try {
    const owner = await login(fixture.username, fixture.password, 1440); page = owner.page;
    assert.equal(String(owner.bootstrap.user.id), fixture.customerId);
    const readState = async () => { const response = await owner.context.request.get(new URL(fixture.statePath, publicURL).href, { headers: owner.headers }); assert.equal(response.status(), 200); return response.json(); };
    const untilState = async predicate => {
      const deadline = Date.now() + 15000;
      do { const state = await readState(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 50)); } while (Date.now() < deadline);
      assert.fail('Loopback provider did not reach its expected state');
    };
    await page.goto(new URL(`/zh/app/#/chat/${encodeURIComponent(fixture.chatId)}`, publicURL).href); await page.locator('#fx-input:not([disabled])').waitFor();
    phase = 'first real generation';
    const generate = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/generate'));
    await page.locator('#fx-input').fill('Synthetic real streaming acceptance'); await page.locator('[data-form=send] .send').click();
    const ack = await generate; assert.equal(ack.status(), 202); const run = (await ack.json()).run;
    assert.equal(paid.length, 1); assert.equal(paid[0].body.stream_updates, true); assert.equal(paid[0].body.model, fixture.model);
    assert.equal(paid[0].body.billing_mode, 'account_allowance'); assert.equal(Object.hasOwn(paid[0].body, 'key_id'), false);
    await page.locator('[data-chat-stream]').filter({ hasText: fixture.expectedFirstText }).waitFor();
    assert.equal(await page.locator('[data-chat-run]').count(), 0, 'real live text does not duplicate the large pending card');
    const beforeEOF = await untilState(state => state.calls.length === 1 && state.calls[0].firstChunk); assert.equal(beforeEOF.calls.length, 1); assert.equal(beforeEOF.calls[0].stream, true); assert.equal(beforeEOF.calls[0].firstChunk, true); assert.equal(beforeEOF.calls[0].completed, false); assert.equal(beforeEOF.calls[0].canceled, false);
    assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0); assert.equal(await page.locator('[data-act=chat-stop]').count(), 0); await capture('1440-before-provider-eof');
    checks.push('The browser displays real loopback provider text while that upstream response remains open');
    phase = 'reload same paid run'; await page.reload(); await page.locator('[data-chat-stream]').filter({ hasText: fixture.expectedFirstText }).waitFor();
    assert.equal(paid.length, 1); assert.equal((await readState()).calls.length, 1); assert.deepEqual(cancellations, []);
    const release = await owner.context.request.post(new URL(fixture.releasePath, publicURL).href, { headers: owner.headers, data: { call: 1 } }); assert.equal(release.status(), 200);
    await page.locator('.thread[data-run-status=completed]').waitFor(); assert.equal(await page.locator('.msg-body').last().innerText(), fixture.expectedFinalText);
    const runPath = `/api/app/chats/${encodeURIComponent(fixture.chatId)}/runs/${encodeURIComponent(run.request_id)}`;
    const receipt = await owner.context.request.get(new URL(runPath, publicURL).href, { headers: owner.headers }); assert.equal(receipt.status(), 200); const completed = (await receipt.json()).run;
    assert.equal(completed.status, 'completed'); assert.equal(completed.request_id, run.request_id); assert.ok(completed.assistant_message_id);
    const afterEOF = await readState(); assert.equal(afterEOF.calls.length, 1); assert.equal(afterEOF.calls[0].completed, true); assert.equal(afterEOF.calls[0].canceled, false);
    const firstLedger = await untilState(state => state.allowanceMicro === fixture.initialAllowanceMicro - fixture.expectedChargeMicroPerCall && state.unresolvedBillingEvents === 0);
    record.firstLedger = { allowanceMicro: firstLedger.allowanceMicro, unresolvedBillingEvents: firstLedger.unresolvedBillingEvents };
    checks.push('Reload reconnects to the same paid request; provider EOF precedes a verified stored assistant receipt');
    phase = 'foreign observer refused';
    const other = await login(fixture.otherUsername, fixture.otherPassword ?? fixture.password, 320);
    const foreign = await other.context.request.get(new URL(runPath + '/events?after=0', publicURL).href, { headers: other.headers, timeout: 15000 });
    assert.ok([403, 404].includes(foreign.status())); assert.doesNotMatch(await foreign.text(), new RegExp(fixture.expectedFirstText)); await other.context.close();
    checks.push('Another real customer cannot observe the first customer run or its transient text');
    phase = 'second explicit request after normal completion'; await page.setViewportSize({ width: 320, height: 950 });
    const secondGenerate = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/generate'));
    await page.locator('#fx-input').fill('Synthetic second deliberate streaming request'); await page.locator('[data-form=send] .send').click();
    const secondACK = await secondGenerate; assert.equal(secondACK.status(), 202); const secondRun = (await secondACK.json()).run;
    assert.notEqual(secondRun.request_id, run.request_id);
    await page.locator('[data-chat-stream]').filter({ hasText: fixture.expectedFirstText }).waitFor();
    assert.equal(await page.locator('[data-act=chat-stop]').count(), 0); await capture('320-second-before-provider-eof');
    const secondBeforeEOF = await readState(); assert.equal(secondBeforeEOF.calls.length, 2); assert.equal(secondBeforeEOF.calls[1].completed, false); assert.equal(secondBeforeEOF.calls[1].canceled, false);
    const releaseSecond = await owner.context.request.post(new URL(fixture.releasePath, publicURL).href, { headers: owner.headers, data: { call: 2 } }); assert.equal(releaseSecond.status(), 200);
    await page.locator('.thread[data-run-status=completed]').waitFor(); assert.equal(await page.locator('.msg-body').last().innerText(), fixture.expectedFinalText);
    const finished = await untilState(state => state.calls.length === 2 && state.calls[1].completed && state.allowanceMicro === fixture.initialAllowanceMicro - 2 * fixture.expectedChargeMicroPerCall && state.unresolvedBillingEvents === 0);
    assert.ok(finished.calls.every(call => call.stream && call.completed && !call.canceled)); assert.equal(paid.length, 2); assert.deepEqual(cancellations, []);
    const secondReceipt = await owner.context.request.get(new URL(`/api/app/chats/${encodeURIComponent(fixture.chatId)}/runs/${encodeURIComponent(secondRun.request_id)}`, publicURL).href, { headers: owner.headers });
    assert.equal(secondReceipt.status(), 200); assert.equal((await secondReceipt.json()).run.status, 'completed');
    checks.push('A second explicit request also completes normally; observer recovery offers no unsafe Stop or cancel and neither run is resubmitted');
    checks.push('Both real provider usage receipts debit exactly one charge each and leave no unresolved billing event');
    assert.deepEqual(errors, []);
    record.status = 'passed'; record.providerCalls = finished.calls; record.paidGenerations = paid.map(item => ({ path: item.path, requestId: item.body.request_id })); record.cancelRequests = cancellations.length;
    record.finalLedger = { allowanceMicro: finished.allowanceMicro, unresolvedBillingEvents: finished.unresolvedBillingEvents }; record.errors = errors;
    await writeFile(resolve(evidence, 'chat-streaming-live.json'), JSON.stringify(record, null, 2) + '\n');
  } catch (error) {
    if (page && !page.isClosed()) await capture('failure').catch(() => {});
    await writeFile(resolve(evidence, 'chat-streaming-live-failure.json'), JSON.stringify({ ...record, status: 'failed', phase, errors }, null, 2) + '\n'); throw error;
  }
});
