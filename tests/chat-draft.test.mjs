import test from 'node:test';
import assert from 'node:assert/strict';
import { retainChatDraft, readChatDraft, clearChatDraft } from '../src/lib/chat-draft.ts';
test('relogin drafts are private to the same account and retain only the unsent text and navigation context', t => {
  const previous = globalThis.sessionStorage, values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  t.after(() => { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; });
  retainChatDraft(42, '#/chat/own-chat', 'own-workspace', 'Unsent text');
  assert.equal(readChatDraft(7), null, 'another sign-in cannot restore this account’s draft');
  assert.deepEqual(Object.keys(readChatDraft(42)).sort(), ['route', 'savedAt', 'text', 'userId', 'workspace']);
  assert.equal(readChatDraft(42).text, 'Unsent text');
  clearChatDraft(); assert.equal(readChatDraft(42), null);
  retainChatDraft(42, '#/new', 'own-workspace', ''); assert.equal(values.size, 0);
});
