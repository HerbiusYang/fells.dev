import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupportPortalPath } from '../src/lib/support-portal-config.ts';

test('missing or blank private portal configuration disables the operator routes', () => {
  for (const value of [undefined, null, '', '   ', '\n\t']) {
    assert.equal(parseSupportPortalPath(value), null);
  }
});

test('private portal configuration accepts exactly 48 lowercase hexadecimal characters', () => {
  const value = '0123456789abcdef'.repeat(3);
  assert.equal(parseSupportPortalPath(value), value);
});

test('predictable, malformed and unsafe private portal configuration fails without echoing its value', () => {
  for (const value of [
    'support', 'support/login', '0123456789abcdef'.repeat(4),
    'a'.repeat(47), 'a'.repeat(49), 'A'.repeat(48), 'g'.repeat(48),
    '/' + 'a'.repeat(48), '../' + 'a'.repeat(48),
    ' ' + 'a'.repeat(48), 'a'.repeat(48) + ' ',
    '\u0000' + 'a'.repeat(48), { path: 'a'.repeat(48) }, 123, false,
  ]) {
    assert.throws(() => parseSupportPortalPath(value), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(String(value)), false, 'invalid configuration errors do not echo the supplied value');
      return true;
    });
  }
});
