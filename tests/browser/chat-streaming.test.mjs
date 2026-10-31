import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

// Browser/HTTP protocol tests, not provider acceptance. Account APIs are
// synthetic; events use a real same-origin HTTP response whose chunks and EOF
// are independently controlled. route.fulfill cannot establish that property.
const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const workspace = { id: 'stream-space', name: 'Synthetic stream workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
const conversation = (id = 'stream-chat', messages = []) => ({ id, ws: workspace.id, title: id, agent: 'lite', model: 'server/text-model-v2', created: 1700000000000, messages });
const frame = (type, value) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;

async function open(t, { width = 1440, history = [], extraChats = [], live = true, clock = false } = {}) {
  const session = await fixture.setup(t, { viewport: { width, height: 900 } });
  if (clock) {
    await session.page.clock.install({ time: new Date('2026-10-31T00:00:00Z') }); await session.page.clock.pauseAt(new Date('2026-10-31T00:00:01Z'));
    await session.context.addInitScript(() => {
      window.__streamHTTPText = '';
      const fetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await fetch(...args), url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.href);
        if (url.pathname.endsWith('/events') && response.body) {
          const getReader = response.body.getReader.bind(response.body);
          response.body.getReader = (...options) => {
            const reader = getReader(...options), read = reader.read.bind(reader), decoder = new TextDecoder();
            reader.read = async () => { const chunk = await read(); if (chunk.value) window.__streamHTTPText += decoder.decode(chunk.value, { stream: true }); return chunk; };
            return reader;
          };
        }
        return response;
      };
    });
  }
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, generationStatus: 'running', workspaces: [structuredClone(workspace)], chats: [conversation('stream-chat', history), ...extraChats] });
  await backend.install(session.context);
  const connections = [], pending = new Map(), cancels = [], statusReads = [];
  let activeRun, streamStatus = 200;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (/^\/api\/app\/chats\/[^/]+\/runs\/[^/]+\/events$/.test(url.pathname)) {
      const record = { url, headers: request.headers, response, closed: false };
      connections.push(record); response.on('close', () => { record.closed = true; });
      pending.get(connections.length - 1)?.(record);
      if (streamStatus !== 200 || !backend.state.signedIn || request.headers['x-fells-expected-user'] !== String(backend.state.userID) || request.headers['x-fells-expected-session'] !== backend.state.sessionID) {
        response.writeHead(streamStatus !== 200 ? streamStatus : 401, { 'content-type': 'application/json' }); response.end('{"error":"Synthetic stream authorization refused"}'); return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      response.flushHeaders(); response.write(': synthetic HTTP stream connected\n\n'); return;
    }
    try {
      const upstream = await fetch(session.base + request.url);
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.writeHead(502); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { for (const connection of connections) connection.response.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  // Preserve the production static headers/CSP on the loopback proxy. Only the
  // events transport bypasses account mocks; no cross-origin exception is used.
  await session.context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.fallback();
    return !url.pathname.startsWith('/api/app/') || url.pathname.endsWith('/events') ? route.continue() : route.fallback();
  });
  await session.context.route('**/api/app/chats/*/generate', async route => {
    const input = route.request().postDataJSON(), chatID = new URL(route.request().url()).pathname.split('/')[4];
    assert.equal(input.stream_updates, true); assert.equal(input.billing_mode, 'account_allowance'); assert.equal(Object.hasOwn(input, 'key_id'), false);
    assert.equal(route.request().headers().prefer, 'respond-async');
    backend.state.generations.push({ ...input, chat_id: chatID });
    const chat = backend.state.chats.find(chat => chat.id === chatID); chat.messages.push(['you', input.body]); delete chat.message_metadata;
    activeRun = { id: 'synthetic-stream-run', chat_id: chatID, request_id: input.request_id, status: 'running', message_id: `${chatID}-m${chat.messages.length}`, created: Date.now(), updated: Date.now() };
    backend.state.chatRuns[input.request_id] = activeRun;
    return route.fulfill({ status: 202, json: { run: activeRun } });
  });
  await session.context.route('**/api/app/chats/*/runs/*/cancel', route => {
    assert.equal(route.request().method(), 'POST'); assert.deepEqual(route.request().postDataJSON(), {});
    cancels.push({ path: new URL(route.request().url()).pathname, headers: route.request().headers() });
    return route.fulfill({ status: 409, json: { error: 'Cancellation is not offered for this financial stream' } });
  });
  await session.context.route(/\/api\/app\/chats\/[^/]+\/runs\/[^/?]+(?:\?.*)?$/, route => { statusReads.push(route.request().method()); return route.fallback(); });
  await session.page.goto(base + '/app/#/chat/stream-chat'); await session.page.locator('#fx-input:not([disabled])').waitFor();
  const connection = index => connections[index] ? Promise.resolve(connections[index]) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(index); reject(new Error(`Synthetic stream connection ${index} was not opened`)); }, 8000);
    pending.set(index, record => { clearTimeout(timer); pending.delete(index); resolve(record); });
  });
  const snapshot = (connection, seq = 0, text = '', options = {}) => connection.response.write(frame('snapshot', { seq, text, progress: 'generating', run: activeRun, live, cancel_available: false, ...options }));
  const complete = (connection, text, seq) => {
    const chat = backend.state.chats.find(chat => chat.id === activeRun.chat_id); chat.messages.push(['assistant', text]); delete chat.message_metadata;
    activeRun = { ...activeRun, status: 'completed', assistant_message_id: `${chat.id}-m${chat.messages.length}`, updated: Date.now() };
    backend.state.chatRuns[activeRun.request_id] = activeRun;
    connection.response.end(frame('terminal', { seq, run: activeRun }));
  };
  const send = async body => { await session.page.locator('#fx-input').fill(body); await session.page.locator('[data-form=send] .send').click(); return connection(0); };
  return { ...session, base, backend, connections, cancels, statusReads, connection, snapshot, complete, send, run: () => activeRun, rejectStreams: status => { streamStatus = status; } };
}

const stream = page => page.locator('[data-chat-stream]');
const stopped = page => page.locator('[data-act=chat-stop]');
async function rendered(page, text) { await stream(page).filter({ hasText: text }).waitFor(); }
async function settled(page, text) {
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(await page.locator('.msg-body').last().innerText(), text);
  assert.equal(await stream(page).count(), 0);
}
async function until(predicate, message) {
  const deadline = Date.now() + 8000;
  do { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < deadline);
  assert.fail(message);
}

for (const width of [1440, 320]) test(`real HTTP chunks render before EOF without interrupting a ${width}px next-message composition`, async t => {
  const f = await open(t, { width }), { page, backend, errors } = f;
  const first = await f.send('A synthetic streaming instruction'); f.snapshot(first);
  assert.equal(first.headers['x-fells-expected-user'], '42'); assert.equal(first.headers['x-fells-expected-session'], 'c'.repeat(64));
  const input = page.locator('#fx-input'); await input.fill('Draft before candidate');
  await input.evaluate(input => {
    window.__streamEditor = { input, form: input.closest('form'), dock: input.closest('.dock'), blur: 0, ended: 0 };
    input.addEventListener('blur', () => window.__streamEditor.blur++); input.addEventListener('compositionend', () => window.__streamEditor.ended++);
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中文' })); input.value = 'Keep 中文 candidate'; input.setSelectionRange(5, 7);
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', isComposing: true }));
  });
  const part = Buffer.from(frame('delta', { seq: 1, text: '**First 中文**\n\n- Item one\n' }));
  const cut = part.indexOf(Buffer.from('中文')) + 1;
  first.response.write(part.subarray(0, cut));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.doesNotMatch(await page.locator('.main').innerText(), /First 中文/, 'an incomplete SSE frame is not rendered');
  first.response.write(part.subarray(cut));
  await rendered(page, 'First 中文'); assert.equal(first.response.writableEnded, false, 'first text is visible while provider-like HTTP response is still open');
  assert.equal(await page.locator('[data-chat-run]').count(), 0, 'ordinary live text uses the compact stage instead of a duplicate result card');
  assert.equal(backend.state.chats[0].messages.some(([who]) => who === 'assistant'), false, 'no saved final assistant exists yet');
  assert.equal(await stream(page).locator('strong').innerText(), 'First 中文');
  first.response.write(frame('delta', { seq: 1, text: ' DUPLICATE MUST NOT APPEAR' }));
  first.response.write(frame('progress', { seq: 2, progress: 'searching' }));
  await page.locator('[data-chat-stream-status]').filter({ hasText: 'Searching the web' }).waitFor();
  first.response.write(frame('delta', { seq: 3, text: '\n<script>window.__streamXSS=true</script>\n[unsafe](javascript:alert(1))' }));
  await rendered(page, 'unsafe'); assert.doesNotMatch(await stream(page).innerText(), /DUPLICATE/);
  assert.equal(await page.evaluate(() => window.__streamXSS), undefined); assert.equal(await stream(page).locator('script, [href^="javascript:"]').count(), 0);
  assert.deepEqual(await input.evaluate(input => ({ same: input === window.__streamEditor.input, form: input.closest('form') === window.__streamEditor.form, dock: input.closest('.dock') === window.__streamEditor.dock, focused: input === document.activeElement, value: input.value, start: input.selectionStart, end: input.selectionEnd, blur: window.__streamEditor.blur, ended: window.__streamEditor.ended })),
    { same: true, form: true, dock: true, focused: true, value: 'Keep 中文 candidate', start: 5, end: 7, blur: 0, ended: 0 });
  assert.equal(backend.state.generations.length, 1); assert.equal(await stopped(page).count(), 0); assert.deepEqual(f.cancels, []);
  await mkdir('test-results/package-audit', { recursive: true }); await page.screenshot({ path: `test-results/package-audit/chat-streaming-${width}.png`, animations: 'disabled' });
  await input.evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' })));
  f.complete(first, 'Saved final streaming answer', 4); await settled(page, 'Saved final streaming answer');
  assert.equal(await input.inputValue(), 'Keep 中文 candidate'); assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
});

test('incoming chunks respect a reader who scrolled upwards and the latest-message control still works', async t => {
  const history = Array.from({ length: 30 }, (_, index) => ['assistant', `Older synthetic answer ${index}\n\n${'Paragraph for real scrolling. '.repeat(12)}`]);
  const f = await open(t, { history }), { page } = f, first = await f.send('Append below this long history'); f.snapshot(first);
  first.response.write(frame('delta', { seq: 1, text: 'First visible live fragment' })); await rendered(page, 'First visible live fragment');
  await page.locator('[data-thread]').hover(); await page.mouse.wheel(0, -100000);
  await page.waitForFunction(() => document.querySelector('[data-thread]').scrollTop < 10);
  const top = await page.locator('[data-thread]').evaluate(element => element.scrollTop);
  const selected = await page.locator('.msg-body').first().evaluate(element => {
    const text = element.querySelector('p')?.firstChild ?? element.firstChild;
    const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 8);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.__streamHistorySelection = { element, text, selected: selection.toString() }; return selection.toString();
  });
  first.response.write(frame('delta', { seq: 2, text: '\n\nAnother live fragment below the viewport' })); await rendered(page, 'Another live fragment');
  assert.ok(Math.abs(await page.locator('[data-thread]').evaluate(element => element.scrollTop) - top) <= 1);
  assert.deepEqual(await page.locator('.msg-body').first().evaluate(element => ({ same: element === window.__streamHistorySelection.element, connected: window.__streamHistorySelection.text.isConnected, anchor: getSelection().anchorNode === window.__streamHistorySelection.text, selected: getSelection().toString() })),
    { same: true, connected: true, anchor: true, selected });
  await page.locator('[data-chat-latest]').click(); await page.waitForFunction(() => { const el = document.querySelector('[data-thread]'); return el.scrollHeight - el.scrollTop - el.clientHeight <= 64; });
  assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.errors, []);
});

test('EOF reconnects by sequence and a document reload recovers the same paid run without duplicate text or POST', async t => {
  const f = await open(t), { page } = f, first = await f.send('Recover only this paid request'); f.snapshot(first);
  first.response.write(frame('delta', { seq: 1, text: 'Original partial' })); await rendered(page, 'Original partial'); first.response.end();
  const second = await f.connection(1); assert.equal(second.url.searchParams.get('after'), '1');
  f.snapshot(second, 2, 'Original partial recovered'); second.response.write(frame('delta', { seq: 1, text: ' DUPLICATED' }));
  second.response.write(frame('delta', { seq: 3, text: ' once' })); await rendered(page, 'Original partial recovered once');
  assert.doesNotMatch(await stream(page).innerText(), /DUPLICATED/);
  await page.reload(); const third = await f.connection(2); f.snapshot(third, 3, 'Original partial recovered once');
  await rendered(page, 'Original partial recovered once'); assert.equal(f.backend.state.generations.length, 1);
  f.complete(third, 'Recovered final answer', 4); await settled(page, 'Recovered final answer');
  assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.cancels, []); assert.deepEqual(f.errors, []);
});

test('a live=false snapshot falls back to existing status reads without resubmitting generation', async t => {
  const f = await open(t, { live: false }), { page } = f, first = await f.send('Use supported observation only');
  f.snapshot(first, 0, '', { cancel_available: false });
  await page.locator('[data-act=chat-check]').waitFor(); assert.equal(await stopped(page).count(), 0);
  const chat = f.backend.state.chats[0], run = f.run(); chat.messages.push(['assistant', 'Reply from the ordinary status endpoint']);
  f.backend.state.chatRuns[run.request_id] = { ...run, status: 'completed', assistant_message_id: `${chat.id}-m${chat.messages.length}` };
  first.response.end(); await settled(page, 'Reply from the ordinary status endpoint');
  assert.ok(f.statusReads.length > 0); assert.ok(f.statusReads.every(method => method === 'GET'));
  assert.equal(f.backend.state.generations.length, 1); assert.equal(f.connections.length, 1); assert.deepEqual(f.errors, []);
});

test('an observer disconnect offers no unsafe Stop and never cancels or resubmits the paid generation', async t => {
  const f = await open(t), { page } = f, first = await f.send('Keep observing the original request'); f.snapshot(first);
  first.response.write(frame('delta', { seq: 1, text: 'Partial before observer disconnect' })); await rendered(page, 'Partial before');
  assert.equal(await stopped(page).count(), 0); first.response.end();
  const second = await f.connection(1); f.snapshot(second, 1, 'Partial before observer disconnect');
  await rendered(page, 'Partial before'); assert.equal(await stopped(page).count(), 0); assert.deepEqual(f.cancels, []);
  assert.equal(f.backend.state.generations.length, 1); assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0);
  f.complete(second, 'The original generation completed normally', 2); await settled(page, 'The original generation completed normally');
  assert.deepEqual(f.cancels, []); assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.errors, []);
});

test('real heartbeat bytes extend the idle deadline and a silent connection reconnects without another paid request', async t => {
  const f = await open(t, { clock: true }), { page } = f, first = await f.send('Bound only the observation connection');
  f.snapshot(first, 0, 'Connected snapshot received over HTTP');
  const readBytes = text => until(() => page.evaluate(text => window.__streamHTTPText.includes(text), text), 'Browser did not read the controlled HTTP bytes');
  await readBytes('Connected snapshot received over HTTP'); await page.clock.runFor(32); await rendered(page, 'Connected snapshot received over HTTP');
  await page.clock.runFor(20000); assert.equal(f.connections.length, 1);
  first.response.write(': keepalive\n\n'); await readBytes(': keepalive');
  await page.clock.runFor(20000); assert.equal(f.connections.length, 1, 'heartbeat extends the deadline beyond thirty seconds from headers');
  await page.clock.runFor(10001); await until(() => first.closed, 'Idle observer did not close its HTTP response');
  await page.clock.runFor(301); const second = await f.connection(1); f.snapshot(second, 0, 'Recovered after a silent observation connection');
  await readBytes('Recovered after a silent observation connection'); await page.clock.runFor(32); await rendered(page, 'Recovered after a silent observation connection');
  assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.cancels, []); assert.equal(await stopped(page).count(), 0);
  f.complete(second, 'The same paid request completed', 1); await readBytes('terminal');
  await until(() => page.evaluate(() => document.querySelector('.thread')?.dataset.runStatus === 'completed' && [...document.querySelectorAll('.msg-body')].at(-1)?.textContent === 'The same paid request completed'), 'The original paid request did not finish its authenticated hydration');
  await settled(page, 'The same paid request completed');
  assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.errors, []);
});

test('an unknown terminal receipt keeps partial text distinct from a saved completed assistant', async t => {
  const f = await open(t), { page } = f, first = await f.send('Keep an uncertain result honest'); f.snapshot(first);
  first.response.write(frame('delta', { seq: 1, text: 'Partial text is not a saved final answer' })); await rendered(page, 'Partial text is not');
  const run = { ...f.run(), status: 'unknown', error_code: 'billing_unresolved' }; f.backend.state.chatRuns[run.request_id] = run;
  first.response.end(frame('terminal', { seq: 2, run }));
  await page.locator('[data-run-status=unknown]').waitFor();
  assert.equal(await page.locator('[data-act=chat-check]').count(), 1, 'an uncertain receipt retains the necessary result-check action');
  assert.equal(await page.locator('.thread[data-run-status=completed]').count(), 0);
  assert.equal(f.backend.state.chats[0].messages.some(([who]) => who === 'assistant'), false);
  assert.equal(await page.locator('[data-form=send] .send').isDisabled(), true);
  assert.equal(await stopped(page).count(), 0); assert.deepEqual(f.cancels, []); assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.errors, []);
});

for (const change of ['expired', 'replacement']) test(`an ${change} account cannot retain or resume private streaming text`, async t => {
  const f = await open(t), { page } = f;
  await f.context.route(/\/app\/start\/?(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
  const first = await f.send('Private instruction'); f.snapshot(first); first.response.write(frame('delta', { seq: 1, text: 'Private transient answer' })); await rendered(page, 'Private transient answer');
  if (change === 'expired') f.rejectStreams(401);
  else { f.backend.state.userID = 43; f.backend.state.sessionID = 'd'.repeat(64); }
  first.response.end();
  await page.waitForURL(url => /\/app\/start\/?$/.test(url.pathname));
  if (change === 'expired') assert.ok(f.connections.length >= 2, 'the observer received a real HTTP 401');
  assert.doesNotMatch(await page.locator('body').innerText(), /Private transient answer|Private instruction/);
  assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.cancels, []); assert.deepEqual(f.errors, []);
});

test('late frames from a previous conversation never replace the active conversation or its draft', async t => {
  const f = await open(t, { extraChats: [conversation('other-stream-chat', [['assistant', 'Other conversation history']])] }), { page } = f;
  const first = await f.send('Stream in the original conversation'); f.snapshot(first); first.response.write(frame('delta', { seq: 1, text: 'Old private fragment' })); await rendered(page, 'Old private fragment');
  await page.locator('[data-go="chat/other-stream-chat"]').click(); await page.locator('.msg-body').filter({ hasText: 'Other conversation history' }).waitFor();
  await page.locator('#fx-input').fill('Draft belongs to the other conversation');
  first.response.write(frame('delta', { seq: 2, text: ' LATE OLD ANSWER' }));
  f.complete(first, 'Old finished answer', 3);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(new URL(page.url()).hash, '#/chat/other-stream-chat');
  assert.doesNotMatch(await page.locator('.main').innerText(), /Old private fragment|LATE OLD ANSWER|Old finished answer/);
  assert.equal(await page.locator('#fx-input').inputValue(), 'Draft belongs to the other conversation');
  assert.equal(await page.locator('#fx-input').evaluate(input => input === document.activeElement), true);
  assert.equal(f.backend.state.generations.length, 1); assert.deepEqual(f.cancels, []); assert.deepEqual(f.errors, []);
});
