import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupportPortalPath } from '../src/lib/support-portal-config.ts';

test('missing or blank private portal configuration disables the operator routes', () => {
  for (const value of [undefined, null, '', '   ', '\n\t']) {
    assert.equal(parseSupportPortalPath(value), null);
  }
});

test('private portal configuration accepts two to five lowercase words joined by hyphens', () => {
  for (const value of [
    'quiet-pine', 'velvet-harbor-study', 'soft-fern-river-house',
    'misty-forest-paper-stone-lantern', 'aa-bb',
    'abcdefghijklmnop-abcdefghijklmnop',
  ]) {
    assert.equal(parseSupportPortalPath(value), value);
  }
});

test('existing public page and locale paths cannot be configured as the private portal', () => {
  for (const value of ['developer-api', 'zh-hant']) {
    assert.throws(() => parseSupportPortalPath(value), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /must not match a public page/);
      assert.equal(error.message.includes(value), false, 'reserved path errors do not echo the supplied value');
      return true;
    });
  }
});

test('malformed and unsafe private portal configuration fails without echoing its value', () => {
  for (const value of [
    'support', 'support/login',
    '0123456789abcdef'.repeat(3), '0123456789abcdef'.repeat(4),
    'a-birch', 'birch-b', 'abcdefghijklmnopq-birch', 'birch-abcdefghijklmnopq',
    'one-two-three-four-five-six', 'Quiet-pine', 'quiet-Pine',
    'quiet--pine', '-quiet-pine', 'quiet-pine-', 'quiet_pine', 'quiet-pine2',
    '/quiet-pine', '../quiet-pine', 'quiet/pine', 'quiet-pine/desk',
    ' quiet-pine', 'quiet-pine ', 'quiet-pine\n', '\u0000quiet-pine',
    { path: 'quiet-pine' }, 123, false,
  ]) {
    assert.throws(() => parseSupportPortalPath(value), error => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(String(value)), false, 'invalid configuration errors do not echo the supplied value');
      return true;
    });
  }
});
