import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatRefusal } from '../src/lib/chat-refusal.ts';

test('typed refusal diagnostics preserve only bounded public fields, including future categories', () => {
  assert.deepEqual(parseChatRefusal({ type: 'refusal', category: null, explanation: null }), { type: 'refusal' });
  assert.deepEqual(parseChatRefusal({ type: 'refusal', category: 'future_category', explanation: 'Synthetic provider explanation\nwith another line', content: 'private partial', thinking: 'discard', recommended_model: 'do-not-follow' }), { type: 'refusal', category: 'future_category', explanation: 'Synthetic provider explanation\nwith another line' });
  const html = '<img src=x onerror=evil()><script>evil()</script>';
  assert.deepEqual(parseChatRefusal({ type: 'refusal', category: '<b>category</b>', explanation: html }), { type: 'refusal', category: '<b>category</b>', explanation: html }, 'HTML remains text for the escaped renderer');
  assert.equal(parseChatRefusal({ type: 'refusal', category: 'x'.repeat(80), explanation: 'x'.repeat(4096) }).explanation.length, 4096);
});

test('malformed, untyped, control-bearing and oversized diagnostics never enter the reply UI', () => {
  for (const value of [undefined, null, [], 'refusal', {}, { type: 'error' }, { type: 'Refusal' },
    { type: 'refusal', category: 17 }, { type: 'refusal', explanation: {} },
    { type: 'refusal', category: 'x'.repeat(81) }, { type: 'refusal', explanation: 'x'.repeat(4097) },
    { type: 'refusal', category: '界'.repeat(27) }, { type: 'refusal', explanation: '界'.repeat(1366) },
    ...['\n', '\r', '\0'].map(control => ({ type: 'refusal', category: 'category' + control })),
    { type: 'refusal', explanation: 'private\0body' }]) {
    assert.equal(parseChatRefusal(value), undefined);
  }
});
