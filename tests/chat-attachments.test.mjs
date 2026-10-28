import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentFileKind, attachmentSupported, CHAT_ATTACHMENT_BYTES, chatAttachmentPath, parseChatAttachment, inspectAttachmentFile, listChatAttachments, uploadChatAttachment, deleteChatAttachment } from '../src/lib/chat-attachments.ts';
import { png } from './fixtures/support-images.mjs';
import { chatAttachmentWords } from '../src/i18n/chat-attachments.ts';
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const metadata = { id: 'file-1', name: 'sample.png', mime_type: 'image/png', kind: 'image', size: png.length, sha256: 'a'.repeat(64), created: 1700000000000 };
const identity = { userId: 42, sessionId: 'c'.repeat(64) };
test('attachment controls and terminal refusal/output-limit explanations cover all six locales', () => {
  const languages = ['en','zh-CN','zh-TW','ja','ko','es'];
  assert.equal(new Set(languages.map(language => chatAttachmentWords(language).add)).size, 6);
  for (const language of languages) for (const field of ['add','help','uploading','retry','remove','preview','unsupported','emptyPrompt','refused','outputLimit']) assert.ok(chatAttachmentWords(language)[field]?.trim(), `${language}: ${field}`);
});
test('attachment metadata is bounded, typed and uses only generated private paths', () => {
  assert.deepEqual(parseChatAttachment({ ...metadata, url: 'https://tracker.invalid/file' }), metadata);
  assert.equal(chatAttachmentPath('chat-1', metadata.id), '/api/app/chats/chat-1/attachments/file-1');
  for (const id of ['../other', 'javascript:x', '', 'a/b']) assert.throws(() => chatAttachmentPath(id, metadata.id));
  for (const patch of [{ mime_type: 'image/svg+xml' }, { kind: 'text' }, { size: CHAT_ATTACHMENT_BYTES + 1 }, { size: 0 }, { sha256: 'bad' }, { name: 'bad\nname' }, { created: -1 }, { message_id: '../m' }]) assert.throws(() => parseChatAttachment({ ...metadata, ...patch }));
  assert.equal(attachmentSupported(undefined, 'image'), false);
  assert.equal(attachmentSupported({ attachments: true }, 'image'), false);
  assert.equal(attachmentSupported({ vision: true }, 'image'), true);
  assert.equal(attachmentSupported({ documents: true }, 'document'), true);
  assert.equal(attachmentSupported({ attachments: true }, 'text'), true);
});
test('client rejects executable formats, MIME mismatches, oversized files and forged image metadata', async () => {
  for (const file of [{ name: 'x.svg', type: 'image/svg+xml', size: 5 }, { name: 'x.html', type: 'text/html', size: 5 }, { name: 'x.png', type: 'text/html', size: 5 }, { name: 'x.txt', type: 'text/plain', size: CHAT_ATTACHMENT_BYTES + 1 }]) assert.equal(attachmentFileKind(file), null);
  await assert.rejects(inspectAttachmentFile(new File(['<svg onload=evil>'], 'x.png', { type: 'image/png' })), /invalid_file/);
  const image = await inspectAttachmentFile(new File([png], 'x.png', { type: 'image/png' }));
  assert.equal(image.kind, 'image'); assert.match(image.sha256, /^[a-f0-9]{64}$/);
});
test('multipart upload, recovery and removal all carry the captured customer session', async () => {
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, ...options });
    assert.equal(options.headers.get('X-Fells-Expected-User'), '42');
    assert.equal(options.headers.get('X-Fells-Expected-Session'), identity.sessionId);
    assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(options.method === 'POST' ? { attachment: metadata } : options.method === 'DELETE' ? { deleted: true } : { attachments: [metadata] }), { status: options.method === 'POST' ? 201 : 200 });
  };
  assert.deepEqual(await uploadChatAttachment(identity, 'chat-1', new File([png], 'sample.png', { type: 'image/png' })), metadata);
  assert.equal(calls[0].body instanceof FormData, true); assert.deepEqual([...calls[0].body.keys()], ['file']);
  assert.equal(calls[0].headers.has('Content-Type'), false, 'fetch supplies the multipart boundary');
  assert.deepEqual(await listChatAttachments(identity, 'chat-1'), [metadata]);
  await deleteChatAttachment(identity, 'chat-1', metadata.id);
  assert.equal(calls.length, 3);
  await assert.rejects(listChatAttachments({ ...identity, sessionId: 'bad' }, 'chat-1'));
  assert.equal(calls.length, 3, 'invalid identities never dispatch');
});
