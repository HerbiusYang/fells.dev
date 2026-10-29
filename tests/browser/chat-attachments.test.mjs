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
  let release, started, failReconcile = false;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
  const second = { ...workspace, id: 'second-space', name: 'Second workspace' };
  const { page, backend, errors } = await open(t, { workspaces: [workspace, second], chats: [chat('upload-a'), chat('text-b', workspace.id, plain.model), chat('text-c', second.id, plain.model)] }, async ({ context, page, backend }) => {
    await page.clock.install({ time: new Date('2026-10-29T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-29T00:00:01Z'));
    await context.route('**/api/app/chats/upload-a/attachments', async route => {
      if (route.request().method() === 'GET' && failReconcile) return route.fulfill({ status: 503, json: { error: 'Synthetic reconciliation failure' } });
      if (route.request().method() !== 'POST') return route.fallback();
      const file = { id: 'committed-a', chat_id: 'upload-a', name: image.name, mime_type: 'image/png', kind: 'image', size: png.length, sha256: createHash('sha256').update(png).digest('hex'), created: Date.now(), bytes: png };
      backend.state.chatAttachments.push(file); backend.state.attachmentUploads.push(file); started();
      await gate;
      const { chat_id, bytes, ...metadata } = file;
      await route.fulfill({ status: 201, json: { attachment: metadata } }).catch(() => {}); // The client may have already aborted its wait.
    });
  }, '/app/#/chat/upload-a');
  try {
    await page.locator('[data-chat-file-input]').setInputFiles(image); await began;
    await page.locator('[data-go="chat/text-b"]').click();
    await page.locator('#fx-input').fill('Independent B message'); await page.locator('.send:not([disabled])').click();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id="second-space"]').click();
    await page.locator('#fx:not([aria-busy=true])').waitFor();
    await page.locator('[data-go="chat/text-c"]').click();
    await page.locator('#fx-input').fill('Independent other workspace'); await page.locator('.send:not([disabled])').click();
    await page.locator('.thread[data-run-status=completed]').waitFor();
    assert.deepEqual(backend.state.generations.map(run => run.chat_id), ['text-b', 'text-c']);
    for (const run of backend.state.generations) assert.equal(Object.hasOwn(run, 'attachment_ids'), false);
    await page.clock.runFor(60_001);
    await page.locator('[data-act=switcher]').click(); await page.locator(`[data-act=switch][data-id="${workspace.id}"]`).click();
    await page.locator('#fx:not([aria-busy=true])').waitFor();
    await page.locator('[data-go="chat/upload-a"]').click();
    await page.locator('[data-file-state=failed]').waitFor();
    assert.equal(await page.locator('[data-file-skip]').count(), 0, 'a known unconfirmed upload cannot be skipped');
    failReconcile = true;
    await page.locator('[data-file-retry]').click();
    await page.locator('.chat-file-notice').filter({ hasText: 'could not be checked' }).waitFor();
    assert.equal(await page.locator('[data-file-skip]').count(), 0, 'a reconciliation error cannot turn an ambiguous local upload into text-only');
    assert.equal(backend.state.attachmentUploads.length, 1);
    failReconcile = false;
    await page.locator('[data-file-retry]').click(); await page.locator('[data-file-state=ready]').waitFor();
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
