import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { png } from '../fixtures/support-images.mjs';
const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'system', prefs: { agent: '', send: 0 }, notifs: [true,true,true,false], onboarded: true, answers: [[],[],[],[]], promoClosed: true, sbHidden: false };
const workspace = { id: 'files-space', name: 'Files', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const supported = { model: 'server/native-files', label: 'Native files', format: 'anthropic-messages', formats: ['anthropic-messages'], attachments: true, vision: true, documents: true };
const plain = { model: 'server/plain-text', label: 'Plain text', format: 'openai-completions', formats: ['openai-completions'] };
const image = { name: 'sample.png', mimeType: 'image/png', buffer: png };
async function open(t, options = {}, configure) {
  const session = await fixture.setup(t, { viewport: { width: 390, height: 800 } });
  const backend = createAppBackend({ preferences: structuredClone(preferences), modelChat: true, chatModels: [supported, plain], workspaces: [{ ...workspace }], ...options });
  await backend.install(session.context); await configure?.({ ...session, backend });
  await session.page.goto(session.base + '/app/#/new');
  await session.page.locator('[data-file-pick]:not([disabled])').waitFor();
  return { ...session, backend };
}

test('upload waits for a private chat and confirmation, then binds real image bytes to one generation and history', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { started = resolve; });
  const { page, backend, errors } = await open(t, {}, async ({ context }) => {
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
