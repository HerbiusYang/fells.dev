import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnsentChatDrafts } from '../src/lib/unsent-chat-drafts.ts';

test('confirmed unsent text restores an empty editor and separately retains an occupied next draft', () => {
  const recovery = createUnsentChatDrafts();
  assert.equal(recovery.retain('a', 'first', 'Original A', ''), 'Original A');
  assert.deepEqual(recovery.list('a'), []);
  assert.equal(recovery.retain('a', 'same-text', 'Original A', 'Original A'), 'Original A');
  assert.deepEqual(recovery.list('a'), []);
  assert.equal(recovery.retain('a', 'second', 'Original B', 'Next C'), 'Next C');
  assert.deepEqual(recovery.list('a'), [{ requestID: 'second', body: 'Original B' }]);
  assert.equal(recovery.edit('a', 'second', 'Next C'), 'Original B');
  assert.deepEqual(recovery.list('a'), [{ requestID: 'second', body: 'Next C' }]);
  assert.equal(recovery.edit('a', 'second', ''), 'Next C');
  assert.deepEqual(recovery.list('a'), []);
});

test('repeated confirmation cannot duplicate or resurrect a restored request', () => {
  const recovery = createUnsentChatDrafts();
  recovery.retain('a', 'request', 'Unsent A', 'Next B');
  recovery.retain('a', 'request', 'Unsent A', 'Next B');
  assert.equal(recovery.list('a').length, 1);
  assert.equal(recovery.edit('a', 'request', ''), 'Unsent A');
  assert.equal(recovery.retain('a', 'request', 'Unsent A', ''), '');
  assert.deepEqual(recovery.list('a'), []);
});

test('multiple failed sends remain separate and chat removal or session cleanup removes recovery state', () => {
  const recovery = createUnsentChatDrafts();
  recovery.retain('a', 'one', 'A', 'B'); recovery.retain('a', 'two', 'B', 'C');
  recovery.retain('b', 'one', 'Other account-scoped chat', 'Other draft');
  assert.deepEqual(recovery.list('a').map(value => value.body), ['A', 'B']);
  assert.equal(recovery.edit('b', 'two', 'Other draft'), undefined);
  recovery.remove('a'); assert.deepEqual(recovery.list('a'), []); assert.equal(recovery.list('b').length, 1);
  recovery.clear(); assert.deepEqual(recovery.list('b'), []);
});
