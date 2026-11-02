import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
import { acceptSiteConfirm } from '../helpers/site-confirm.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start()); after(() => fixture.stop());
const preferences = { theme: 'light', prefs: { agent: '', send: 0 }, notifs: [true, true, true, false], onboarded: true, answers: [[], [], [], []], promoClosed: true, sbHidden: false };
const workspace = { id: 'discard-files', name: 'Selected workspace', region: 'auto', tz: 'UTC', created: 1700000000000, role: 'owner' };
const otherWorkspace = { ...workspace, id: 'keep-files', name: 'Other workspace' };
const model = { model: 'synthetic/native-files', label: 'Synthetic file model', format: 'anthropic-messages', formats: ['anthropic-messages'], attachments: true, vision: true, documents: true };
const chat = (id, ws = workspace.id) => ({ id, ws, title: id, agent: 'lite', model: model.model, created: 1700000000000, messages: [] });
const file = (id, chatID, name = 'private.txt', bytes = Buffer.from('Synthetic private file')) => ({ id, chat_id: chatID, name, mime_type: 'text/plain', kind: 'text', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), created: 1700000000001, bytes });
const publicFile = ({ chat_id, bytes, ...metadata }) => metadata;

async function open(t, configure, options = {}) {
  const f = await fixture.setup(t, { viewport: { width: 1280, height: 900 } });
  const backend = createAppBackend({ preferences, modelChat: true, chatModels: [model], workspaces: [workspace, otherWorkspace], chats: [chat('discarded'), chat('retained', otherWorkspace.id)], ...options });
  await backend.install(f.context); await configure?.({ ...f, backend });
  await f.page.goto(f.base + '/app/#/chat/discarded');
  await f.page.locator('[data-form=send][data-chat=discarded] #fx-input').waitFor();
  await f.page.locator('.sb [data-go=members] .end').filter({ hasText: /^1\/32$/ }).waitFor();
  return { ...f, backend };
}

async function clear(page) {
  await page.locator('.sb [data-act=clear-chats]').click(); await acceptSiteConfirm(page);
  await page.waitForFunction(() => document.querySelector('#fx')?.dataset.route === '#/new');
  await page.locator('.sb .empty-note').waitFor();
}

async function recreate(page, backend) {
  backend.state.chats.push(chat('discarded'));
  await page.evaluate(() => dispatchEvent(new Event('focus')));
  await page.locator('.sb [data-go="chat/discarded"]').click();
  await page.locator('[data-form=send][data-chat=discarded] [data-file-pick]:not([disabled])').waitFor();
  await page.locator('[data-form=send][data-chat=discarded] .send:not([disabled])').waitFor();
}

test('clearing chats discards their saved attachment drafts while retaining another workspace draft', async t => {
  const oldFile = file('old-file', 'discarded'), retainedFile = file('retained-file', 'retained', 'keep.txt');
  const { page, backend, errors } = await open(t, undefined, { chatAttachments: [oldFile, retainedFile] });
  await page.locator('[data-file-state=ready]').waitFor();
  await page.locator('#fx-input').fill('Deleted draft text');
  await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id=keep-files]').click();
  await page.locator('.sb [data-go="chat/retained"]').click();
  await page.locator('[data-file-state=ready]').waitFor();
  await page.locator('#fx-input').fill('Keep this other draft');
  await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id=discard-files]').click();
  await page.locator('.sb [data-go="chat/discarded"]').click();
  await page.locator('[data-file-state=ready]').waitFor();
  await clear(page);
  await recreate(page, backend);
  assert.equal(await page.locator('.chat-file').count(), 0, 'a reused ID must restore its new empty attachment list');
  assert.equal(await page.locator('#fx-input').inputValue(), '');
  assert.deepEqual(backend.state.chatAttachments.map(value => value.id), ['retained-file']);
  await page.locator('[data-act=switcher]').click(); await page.locator('[data-act=switch][data-id=keep-files]').click();
  await page.locator('.sb [data-go="chat/retained"]').click();
  await page.locator('[data-file-state=ready]').waitFor();
  assert.equal(await page.locator('.chat-file-info b').innerText(), 'keep.txt');
  assert.equal(await page.locator('#fx-input').inputValue(), 'Keep this other draft');
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a restore response delayed past deletion cannot refill a recreated conversation attachment draft', async t => {
  let release, entered, reads = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const stale = file('stale-restored-file', 'discarded');
  const { page, backend, errors } = await open(t, async ({ context }) => {
    await context.route('**/api/app/chats/discarded/attachments', async route => {
      if (route.request().method() !== 'GET' || ++reads > 1) return route.fallback();
      entered(); await gate;
      await route.fulfill({ status: 200, json: { attachments: [publicFile(stale)] } }).catch(() => {});
    });
  });
  await started; await clear(page); await recreate(page, backend);
  release(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.ok(reads >= 2, 'the recreated ID must issue its own authoritative attachment read');
  assert.equal(await page.locator('.chat-file').count(), 0);
  assert.equal(await page.locator('.chat-file-notice').count(), 0);
  assert.equal(backend.state.attachmentUploads.length, 0); assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('a selected file still hashing when its conversation is cleared never starts a late upload', async t => {
  const { page, backend, errors } = await open(t, async ({ page }) => {
    await page.addInitScript(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = async (...args) => {
        if (window.holdDiscardedFileHash) {
          window.holdDiscardedFileHash = false; window.discardedFileHashEntered = true;
          await new Promise(resolve => { window.releaseDiscardedFileHash = resolve; });
          const result = await digest(...args); window.discardedFileHashFinished = true; return result;
        }
        return digest(...args);
      };
    });
  });
  t.after(() => page.evaluate(() => window.releaseDiscardedFileHash?.()).catch(() => {}));
  await page.locator('[data-file-pick]:not([disabled])').waitFor();
  await page.evaluate(() => { window.holdDiscardedFileHash = true; });
  await page.locator('[data-chat-file-input]').setInputFiles({ name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic delayed file') });
  await page.waitForFunction(() => window.discardedFileHashEntered === true);
  await clear(page); await recreate(page, backend);
  await page.evaluate(() => window.releaseDiscardedFileHash());
  await page.waitForFunction(() => window.discardedFileHashFinished === true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(backend.state.attachmentUploads.length, 0);
  assert.equal(await page.locator('.chat-file').count(), 0);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});

test('clearing during a committed upload discards its late reply and cancels the remaining upload queue', async t => {
  let release, entered, posts = 0;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const bytes = Buffer.from('First synthetic upload'), committed = file('committed-before-clear', 'discarded', 'first.txt', bytes);
  const { page, backend, errors } = await open(t, async ({ context, backend }) => {
    await context.route('**/api/app/chats/discarded/attachments', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts++;
      if (posts > 1) return route.fallback();
      backend.state.chatAttachments.push(committed); backend.state.attachmentUploads.push(committed); entered(); await gate;
      await route.fulfill({ status: 201, json: { attachment: publicFile(committed) } }).catch(() => {});
    });
  });
  await page.locator('[data-file-pick]:not([disabled])').waitFor();
  await page.locator('[data-chat-file-input]').setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: bytes },
    { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('Must not upload after deletion') },
  ]);
  await started; await clear(page); await recreate(page, backend);
  release(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  assert.equal(posts, 1); assert.equal(backend.state.attachmentUploads.length, 1);
  assert.equal(backend.state.chatAttachments.length, 0);
  assert.equal(await page.locator('.chat-file').count(), 0);
  assert.equal(await page.locator('.chat-file-notice').count(), 0);
  assert.equal(backend.state.generations.length, 0); assert.deepEqual(errors, []);
});
