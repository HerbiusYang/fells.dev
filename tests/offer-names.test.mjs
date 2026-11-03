import test from 'node:test';
import assert from 'node:assert/strict';
import { localOfferName } from '../src/lib/offer-names.ts';

test('canonical Chinese offer names follow the page language', () => {
  assert.equal(localOfferName('四人共享', 'en'), '4-person share');
  assert.equal(localOfferName('双人共享', 'ja'), '2人シェア');
  assert.equal(localOfferName('独享', 'ko'), '단독 사용');
  assert.equal(localOfferName('8 人共享', 'es'), 'Compartido entre 8');
  assert.equal(localOfferName('体验包', 'zh-TW'), '體驗包');
  assert.equal(localOfferName('双人共享', 'zh-TW'), '雙人共享');
  assert.equal(localOfferName('四人共享', 'zh-CN'), '四人共享');
  assert.equal(localOfferName('体验包', 'en'), 'Trial pack');
});

test('operator-entered names are shown as entered', () => {
  assert.equal(localOfferName('Token Plan 4000', 'zh-CN'), 'Token Plan 4000');
  assert.equal(localOfferName('四人共享 Pro', 'en'), '四人共享 Pro');
  assert.equal(localOfferName(undefined, 'en'), '');
});
