import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { png } from '../fixtures/support-images.mjs';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { API_READ_TIMEOUT_MS } from '../../src/lib/app-http.ts';
const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true,true,true,false], onboarded: true, answers: [[],[],[],[]], promoClosed: true, sbHidden: false };
const workspace = { id: 'files-space', name: 'Files', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const supported = { model: 'server/native-files', label: 'Native files', format: 'anthropic-messages', formats: ['anthropic-messages'], attachments: true, vision: true, documents: true };
const plain = { model: 'server/plain-text', label: 'Plain text', format: 'openai-completions', formats: ['openai-completions'] };
const image = { name: 'sample.png', mimeType: 'image/png', buffer: png };
async function open(t, options = {}, configure, path = '/app/#/new') {
  const session = await fixture.setup(t, { viewport: { width: 390, height: 800 } });
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, chatModels: [supported, plain], workspaces: [{ ...workspace }], ...options });
  await backend.install(session.context); await configure?.({ ...session, backend });
  await session.page.goto(session.base + path);
  await session.page.locator('#fx-input:not([disabled])').waitFor();
  return { ...session, backend };
}
const chat = (id, ws = workspace.id, model = supported.model) => ({ id, ws, title: id, agent: 'lite', model, created: 1700000000000, messages: [] });
const pending = (chatID, name = 'previous.txt', bytes = Buffer.from('Previously uploaded notes')) => ({ id: 'pending-server', chat_id: chatID, name, mime_type: 'text/plain', kind: 'text', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), created: 1700000000001, bytes });

for (const scope of ['existing chat', 'new draft']) test(`an open file chooser keeps its original input through an account refresh: ${scope}`, async t => {
  const existing = scope === 'existing chat';
  const { page, backend, errors } = await open(t, { chats: existing ? [chat('picker-a')] : [] }, undefined, existing ? '/app/#/chat/picker-a' : '/app/#/new');
  const picker = page.locator('[data-form=send] [data-file-pick]:not([disabled])');
  await picker.waitFor(); await page.locator('#fx-input').fill('Keep my attachment caption');
  const choosing = page.waitForEvent('filechooser'); await picker.click();
  const chooser = await choosing, original = chooser.element();
  if (existing) backend.state.chats[0].title = 'Refreshed while the file chooser is open';
  else { backend.state.profile.name = 'Account refreshed while choosing'; backend.state.apiAllowance.micro = 8_500_000; }
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  if (existing) await page.locator('.bar').filter({ hasText: 'Refreshed while the file chooser is open' }).waitFor();
  else await page.locator('.chat-billing-note').filter({ hasText: '$8.50' }).waitFor();
  assert.equal(await original.evaluate(input => input.isConnected && input === document.querySelector('[data-chat-file-input]')), true, 'background render keeps the chooser target itself');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep my attachment caption');
  const upload = page.waitForRequest(request => request.method() === 'POST' && /^\/api\/app\/chats\/[^/]+\/attachments$/.test(new URL(request.url()).pathname));
  await chooser.setFiles(image); await upload; await page.locator('[data-file-state=ready]').waitFor();
  assert.equal(backend.state.attachmentUploads.length, 1);
  assert.equal(backend.state.chats.length, 1);
  assert.equal(backend.state.attachmentUploads[0].chat_id, backend.state.chats[0].id);
  assert.equal(backend.state.attachmentUploads[0].sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const scope of ['chat', 'workspace']) test(`an old file chooser cannot migrate its input across a ${scope} switch`, async t => {
  const second = { ...workspace, id: 'picker-second-space', name: 'Picker second workspace' };
  const { page, backend, errors } = await open(t, { workspaces: [workspace, second], chats: [chat('picker-a'), chat('picker-b')] }, async ({ page }) => page.setViewportSize({ width: 1280, height: 900 }), scope === 'chat' ? '/app/#/chat/picker-a' : '/app/#/');
  await page.locator('[data-file-pick]:not([disabled])').waitFor();
  const choosing = page.waitForEvent('filechooser'); await page.locator('[data-file-pick]').click();
  const chooser = await choosing, original = chooser.element();
  if (scope === 'chat') await page.locator('[data-go="chat/picker-b"]').click();
  else {
    await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id="picker-second-space"]').click();
    await page.locator('#fx:not([aria-busy=true])').waitFor();
    assert.equal(new URL(page.url()).hash, '#/', 'the workspace guard is tested even when the route is unchanged');
  }
  await page.locator('#fx-input:not([disabled])').waitFor();
  assert.equal(await original.evaluate(input => input.isConnected), false);
  assert.equal(await original.evaluate(input => input === document.querySelector('[data-chat-file-input]')), false);
  // Engines may reject selection on a detached target or deliver its isolated
  // change event. Neither outcome may attach it to the newly selected draft.
  try { await chooser.setFiles(image); }
  catch (error) { assert.match(error.message, /not attached|not connected|detached/i); }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(await page.locator('[data-file-state]').count(), 0);
  assert.equal(backend.state.attachmentUploads.length, 0);
  assert.equal(backend.state.chats.length, 2, 'a stale chooser cannot create a chat in another workspace');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a replacement session clears an open file chooser without uploading into the new account', async t => {
  const { page, backend, errors } = await open(t, { chats: [chat('picker-a')] }, async ({ context }) => {
    await context.route(/\/app\/start\/?(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sign in</title><h1>Sign in</h1>' }));
  }, '/app/#/chat/picker-a');
  await page.locator('[data-file-pick]:not([disabled])').waitFor();
  const choosing = page.waitForEvent('filechooser'); await page.locator('[data-file-pick]').click();
  await choosing;
  backend.state.sessionID = 'd'.repeat(64); backend.state.userID = 43;
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.waitForURL(/\/app\/start\/?(?:\?session=changed)?$/);
  assert.equal(await page.locator('[data-chat-file-input],[data-form=send]').count(), 0);
  assert.equal(backend.state.attachmentUploads.length, 0);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

for (const path of ['/app/', '/app/#/']) test(`${path} creates a private chat for its first attachment`, async t => {
  const { page, backend, errors } = await open(t, {}, undefined, path);
  await page.locator('[data-chat-file-input]').setInputFiles(image);
  await page.locator('[data-file-state=ready]').waitFor();
  assert.equal(backend.state.chats.length, 1); assert.equal(backend.state.attachmentUploads.length, 1);
  assert.equal(backend.state.chatAttachments[0].chat_id, backend.state.chats[0].id);
  await page.locator('.send').click(); await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.deepEqual(backend.state.generations[0].attachment_ids, [backend.state.chatAttachments[0].id]);
  assert.deepEqual(errors, []);
});

test('a timed-out upload stays with A while B and another workspace can send, and retry reads its committed file', async t => {
  let release, committed, failReconcile = false;
  const gate = new Promise(resolve => { release = resolve; }), recorded = new Promise(resolve => { committed = resolve; });
  const second = { ...workspace, id: 'second-space', name: 'Second workspace' };
  const { page, backend, errors } = await open(t, { workspaces: [workspace, second], chats: [chat('upload-a'), chat('text-b', workspace.id, plain.model), chat('text-c', second.id, plain.model)] }, async ({ context, page, backend }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.install({ time: new Date('2026-10-29T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-29T00:00:01Z'));
    await context.route('**/api/app/chats/upload-a/attachments', async route => {
      if (route.request().method() === 'GET' && failReconcile) return route.fulfill({ status: 503, json: { error: 'Synthetic reconciliation failure' } });
      if (route.request().method() !== 'POST') return route.fallback();
      const file = { id: 'committed-a', chat_id: 'upload-a', name: image.name, mime_type: 'image/png', kind: 'image', size: png.length, sha256: createHash('sha256').update(png).digest('hex'), created: Date.now(), bytes: png };
      backend.state.chatAttachments.push(file); backend.state.attachmentUploads.push(file); committed();
      await gate;
      const { chat_id, bytes, ...metadata } = file;
      await route.fulfill({ status: 201, json: { attachment: metadata } }).catch(() => {}); // The client may have already aborted its wait.
    });
  }, '/app/#/chat/upload-a');
  try {
    t.diagnostic('upload-a: waiting for the enabled user picker');
    const picker = page.locator('[data-form=send][data-chat="upload-a"] [data-file-pick]:not([disabled])');
    await picker.waitFor();
    const choosing = page.waitForEvent('filechooser'); await picker.click(); const chooser = await choosing;
    const upload = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/app/chats/upload-a/attachments');
    t.diagnostic('upload-a: choosing a real file and waiting for its bounded POST');
    let commitDeadline;
    const recordedInTime = new Promise((resolve, reject) => {
      commitDeadline = setTimeout(() => reject(new Error('upload-a POST handler did not record the committed file within the existing 8s action deadline')), 8_000);
      recorded.then(resolve, reject);
    });
    try { await Promise.all([chooser.setFiles(image), upload, recordedInTime]); }
    finally { clearTimeout(commitDeadline); }
    await page.locator('[data-file-state=uploading]').waitFor();
    assert.equal(backend.state.attachmentUploads.length, 1);
    t.diagnostic('upload-a: POST committed, response held');
    await page.locator('[data-go="chat/text-b"]').click();
    await page.locator('#fx-input').fill('Independent B message'); await page.locator('.send:not([disabled])').click();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    t.diagnostic('text-b: completed independently');
    await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id="second-space"]').click();
    await page.locator('#fx:not([aria-busy=true])').waitFor();
    await page.locator('[data-go="chat/text-c"]').click();
    await page.locator('#fx-input').fill('Independent other workspace'); await page.locator('.send:not([disabled])').click();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    t.diagnostic('text-c: completed in the other workspace');
    assert.deepEqual(backend.state.generations.map(run => run.chat_id), ['text-b', 'text-c']);
    for (const run of backend.state.generations) assert.equal(Object.hasOwn(run, 'attachment_ids'), false);
    await page.clock.runFor(60_001);
    t.diagnostic('upload-a: advanced the original upload deadline');
    await page.locator('[data-act=switcher]').click(); await page.locator(`[data-act=switch][data-id="${workspace.id}"]`).click();
    await page.locator('#fx:not([aria-busy=true])').waitFor();
    await page.locator('[data-go="chat/upload-a"]').click();
    await page.locator('[data-file-state=failed]').waitFor();
    assert.equal(await page.locator('[data-file-skip]').count(), 0, 'a known unconfirmed upload cannot be skipped');
    failReconcile = true;
    await page.locator('[data-file-retry]').click();
    await page.locator('.chat-file-notice').filter({ hasText: 'could not be checked' }).waitFor();
    t.diagnostic('upload-a: failed reconciliation kept its ambiguous file');
    assert.equal(await page.locator('[data-file-skip]').count(), 0, 'a reconciliation error cannot turn an ambiguous local upload into text-only');
    assert.equal(backend.state.attachmentUploads.length, 1);
    failReconcile = false;
    await page.locator('[data-file-retry]').click(); await page.locator('[data-file-state=ready]').waitFor();
    t.diagnostic('upload-a: recovered the same committed file');
    assert.equal(backend.state.attachmentUploads.length, 1, 'retry recovers the committed SHA before any second POST');
    assert.equal(backend.state.chatAttachments[0].chat_id, 'upload-a');
    assert.equal(backend.state.chatAttachments[0].message_id, undefined);
    assert.equal(backend.state.generations.length, 2); assert.deepEqual(errors, []);
  } finally { release(); }
});

test('failed recovery permits one explicit text-only message, but selecting files must recover every pending file', async t => {
  let failRead = true;
  const oldFile = pending('recover-chat');
  const { page, backend, errors } = await open(t, { chats: [chat('recover-chat', workspace.id, plain.model)], chatAttachments: [oldFile] }, async ({ context }) => {
    await context.route('**/api/app/chats/recover-chat/attachments', route => route.request().method() === 'GET' && failRead ? route.fulfill({ status: 503, json: { error: 'Synthetic attachment read failure' } }) : route.fallback());
  }, '/app/#/chat/recover-chat');
  await page.locator('[data-file-skip]').waitFor(); assert.equal(await page.locator('.send').isDisabled(), true);
  await page.locator('[data-file-skip]').click();
  await page.locator('.chat-file-notice').filter({ hasText: 'only text' }).waitFor();
  await page.locator('#fx-input').fill('Explicit text only'); await page.locator('.send').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(Object.hasOwn(backend.state.generations[0], 'attachment_ids'), false);
  assert.equal(oldFile.message_id, undefined); assert.equal(backend.state.attachmentDeletes.length, 0);
  await page.locator('[data-file-skip]').waitFor(); assert.equal(await page.locator('.send').isDisabled(), true, 'text-only consent applies to one dispatch');
  await page.locator('[data-act=model]').click(); await page.locator('[data-act=pick-model][data-name="server/native-files"]').click();
  await page.locator('[data-chat-file-input]').setInputFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('Newly selected notes') });
  await page.locator('[data-file-state=failed]').waitFor();
  assert.equal(await page.locator('[data-file-skip]').count(), 0, 'even a not-yet-uploaded local entry must be retained and cannot be skipped');
  assert.equal(await page.locator('.chat-file-info b').innerText(), 'new.txt');
  assert.equal(backend.state.attachmentUploads.length, 0);
  failRead = false;
  await page.locator('[data-file-retry]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-file-state=ready]').length === 2);
  assert.deepEqual(new Set(await page.locator('.chat-file-info b').allTextContents()), new Set(['new.txt', 'previous.txt']));
  await page.locator('#fx-input').fill('Use both visible files'); await page.locator('.send').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(backend.state.generations[1].attachment_ids.length, 2);
  assert.ok(backend.state.generations[1].attachment_ids.includes(oldFile.id));
  assert.equal(backend.state.attachmentUploads.length, 1); assert.deepEqual(errors, []);
});

test('retry restores server-pending attachments without uploading a replacement', async t => {
  let failRead = true;
  const oldFile = pending('retry-chat');
  const { page, backend, errors } = await open(t, { chats: [chat('retry-chat')], chatAttachments: [oldFile] }, async ({ context }) => {
    await context.route('**/api/app/chats/retry-chat/attachments', route => route.request().method() === 'GET' && failRead ? route.fulfill({ status: 503, json: { error: 'Synthetic attachment read failure' } }) : route.fallback());
  }, '/app/#/chat/retry-chat');
  await page.locator('[data-file-skip]').waitFor(); failRead = false;
  await page.locator('[data-file-restore]').click(); await page.locator('[data-file-state=ready]').waitFor();
  await page.locator('#fx-input').fill('Recovered file'); await page.locator('.send').click();
  await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.deepEqual(backend.state.generations[0].attachment_ids, [oldFile.id]);
  assert.equal(backend.state.attachmentUploads.length, 0); assert.deepEqual(errors, []);
});

test('a hung recovery becomes an explicit text-only choice after the shared GET deadline', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; }), oldFile = pending('hung-chat');
  const { page, backend, errors } = await open(t, { chats: [chat('hung-chat')], chatAttachments: [oldFile] }, async ({ context, page }) => {
    await page.clock.install({ time: new Date('2026-10-29T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-29T00:00:01Z'));
    await context.route('**/api/app/chats/hung-chat/attachments', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      await gate;
      await route.fulfill({ json: { attachments: [] } }).catch(() => {});
    });
  }, '/app/#/chat/hung-chat');
  try {
    await page.locator('.chat-file-notice').filter({ hasText: 'Checking pending' }).waitFor();
    await page.clock.runFor(API_READ_TIMEOUT_MS + 1);
    await page.locator('[data-file-skip]').click();
    await page.locator('#fx-input').fill('Chosen without unchecked files'); await page.locator('.send').click();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    assert.equal(Object.hasOwn(backend.state.generations[0], 'attachment_ids'), false);
    assert.equal(oldFile.message_id, undefined); assert.equal(backend.state.attachmentDeletes.length, 0);
    release();
    assert.equal(backend.state.generations.length, 1); assert.deepEqual(errors, []);
  } finally { release(); }
});

test('a file-capable model sends the first plain-text message without waiting on irrelevant attachment recovery', async t => {
  const { page, backend, errors } = await open(t);
  await page.locator('#fx-input').fill('Plain text on the first click');
  await page.locator('.send').click(); await page.locator('.thread[data-run-status=completed]').waitFor();
  assert.equal(backend.state.chats.length, 1); assert.equal(backend.state.generations.length, 1);
  assert.equal(backend.state.generations[0].body, 'Plain text on the first click');
  assert.equal(Object.hasOwn(backend.state.generations[0], 'attachment_ids'), false);
  assert.equal(backend.state.attachmentUploads.length, 0); assert.deepEqual(errors, []);
});

test('upload waits for a private chat and confirmation, then binds real image bytes to one generation and history', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
  const { page, backend, errors } = await open(t, { assistantReply: '**Attachment received**\n\n- Private image\n- Server-owned reply' }, async ({ context }) => {
    await context.route('**/api/app/chats/*/attachments', async route => { if (route.request().method() === 'POST') { started(); await gate; } await route.fallback(); });
  });
  try {
    await page.locator('#fx-input').fill('Inspect the picture');
    await page.locator('[data-chat-file-input]').setInputFiles(image); await began;
    assert.equal(backend.state.chats.length, 1); assert.equal(backend.state.chats[0].messages.length, 0);
    assert.equal(backend.state.generations.length, 0); assert.equal(await page.locator('.send').isDisabled(), true);
    await page.locator('[data-file-state=uploading]').waitFor();
    release(); await page.locator('[data-file-state=ready]').waitFor();
    assert.equal(await page.locator('#fx-input').inputValue(), 'Inspect the picture');
    const id = backend.state.chatAttachments[0].id;
    await page.locator('.send').click(); await page.locator('.thread[data-run-status=completed]').waitFor();
    assert.equal(backend.state.generations.length, 1); assert.deepEqual(backend.state.generations[0].attachment_ids, [id]);
    assert.equal(backend.state.generations[0].billing_mode, 'account_allowance');
    assert.equal(await page.locator('[data-chat-files] .chat-file').count(), 0);
    const preview = page.locator('.chat-message-files [data-file-preview]'); await preview.waitFor();
    const path = await preview.getAttribute('data-file-preview'); assert.match(path, /^\/api\/app\/chats\/[a-zA-Z0-9_-]+\/attachments\/file-\d+$/);
    await preview.click(); await page.locator('.chat-file-dialog[open]').waitFor();
    assert.equal(await page.locator('.chat-file-dialog img').getAttribute('src'), path);
    await page.keyboard.press('Escape'); await page.locator('.chat-file-dialog').waitFor({ state: 'detached' });
    await page.reload(); await page.locator('.chat-message-files img').waitFor();
    assert.equal(await page.locator('.chat-message-files img').getAttribute('src'), path);
    assert.equal(await page.locator('.chat-markdown strong').innerText(), 'Attachment received');
    await mkdir('test-results/claude-onboarding', { recursive: true });
    await page.screenshot({ path: 'test-results/claude-onboarding/chat-attachments-mobile.png', animations: 'disabled' });
    assert.equal(backend.state.attachmentUploads.length, 1); assert.deepEqual(errors, []);
  } finally { release(); }
});

test('lost upload acknowledgement is reconciled before retry, survives reload and can be removed without generating', async t => {
  const { page, backend, errors } = await open(t, { loseAttachmentResponse: true });
  await page.locator('[data-chat-file-input]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic notes') });
  await page.locator('[data-file-state=failed]').waitFor();
  assert.equal(await page.locator('.send').isDisabled(), true);
  await page.locator('[data-file-retry]').click(); await page.locator('[data-file-state=ready]').waitFor();
  assert.equal(backend.state.attachmentUploads.length, 1, 'retry finds the committed upload by hash instead of sending it twice');
  await page.reload(); await page.locator('[data-file-state=ready]').waitFor();
  await page.locator('[data-file-remove]').click(); await page.locator('.chat-file').waitFor({ state: 'detached' });
  assert.equal(backend.state.chatAttachments.length, 0); assert.equal(backend.state.attachmentDeletes.length, 1);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('account refresh while the first file hash is pending retains the same draft selection after composer replacement', async t => {
  let releaseInvoices;
  const invoicesGate = new Promise(resolve => { releaseInvoices = resolve; });
  const { page, backend, errors } = await open(t, {}, async ({ context, page }) => {
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = async (...args) => {
        if (window.__holdAttachmentHash) {
          window.__holdAttachmentHash = false;
          window.__attachmentHashEntered = true;
          await new Promise(resolve => { window.__releaseAttachmentHash = resolve; });
        }
        return digest(...args);
      };
      document.addEventListener('change', event => {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-file-input]'))
          window.__attachmentOrigin = event.target.closest('[data-form=send]');
      }, true);
    });
    await context.route('**/api/app/invoices', async route => {
      await invoicesGate;
      await route.fallback();
    });
  });
  try {
    await page.evaluate(() => { document.activeElement?.blur(); window.__holdAttachmentHash = true; });
    await page.locator('[data-chat-file-input]').setInputFiles({ name: 'selected-before-refresh.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic selected file') });
    await page.waitForFunction(() => window.__attachmentHashEntered === true);
    const invoicePublished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/app/invoices');
    releaseInvoices(); await invoicePublished;
    await page.waitForFunction(() => window.__attachmentOrigin?.isConnected === false);
    assert.equal(backend.state.attachmentUploads.length, 0, 'hash validation still gates the write');
    await page.evaluate(() => window.__releaseAttachmentHash());
    await page.locator('[data-file-state=ready]').waitFor();
    assert.equal(await page.locator('.chat-file-info b').innerText(), 'selected-before-refresh.txt');
    assert.equal(backend.state.chats.length, 1);
    assert.equal(backend.state.attachmentUploads.length, 1, 'a valid redraw neither discards nor duplicates the selection');
    assert.equal(backend.state.generations.length, 0);
    assert.deepEqual(errors, []);
  } finally {
    releaseInvoices();
    await page.evaluate(() => window.__releaseAttachmentHash?.()).catch(() => {});
  }
});

test('paste/drop, four-file limit, active-model capability and filename escaping are enforced before send', async t => {
  const { page, backend, errors } = await open(t);
  await page.locator('[data-chat-file-input]').setInputFiles({ name: '<img onerror=evil>.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic content') });
  await page.locator('[data-file-state=ready]').waitFor();
  assert.equal(await page.locator('.chat-file-info img').count(), 0);
  assert.match(await page.locator('.chat-file-info b').innerText(), /<img/);
  await page.locator('#fx-input').evaluate((element, bytes) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'clipboard.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, [...png]);
  await page.waitForFunction(() => document.querySelectorAll('[data-file-state=ready]').length === 2);
  await page.locator('.composer').evaluate(element => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['drop'], 'drop.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await page.waitForFunction(() => document.querySelectorAll('[data-file-state=ready]').length === 3);
  await page.locator('[data-chat-file-input]').setInputFiles([{ name: 'four.txt', mimeType: 'text/plain', buffer: Buffer.from('4') }, { name: 'five.txt', mimeType: 'text/plain', buffer: Buffer.from('5') }]);
  await page.locator('.chat-file-notice').filter({ hasText: '4 files' }).waitFor();
  assert.equal(backend.state.attachmentUploads.length, 3);
  await page.locator('[data-act=model]').click(); await page.locator('[data-act=pick-model][data-name="server/plain-text"]').click();
  assert.equal(await page.locator('.send').isDisabled(), true); assert.equal(await page.locator('[data-file-unsupported=true]').count(), 3);
  assert.equal(await page.locator('[data-file-pick]').isDisabled(), true);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});
