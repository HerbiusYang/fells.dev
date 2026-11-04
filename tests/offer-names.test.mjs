import test from 'node:test';
import assert from 'node:assert/strict';
import { localOfferName, localOfferDescription } from '../src/lib/offer-names.ts';

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

test('family offer names and descriptions follow the page language', () => {
  assert.equal(localOfferName('Ultra 双人共享', 'en'), 'Ultra 2-person share');
  assert.equal(localOfferName('Max 独享', 'zh-TW'), 'Max 獨享');
  assert.equal(localOfferName('Pro 体验', 'ja'), 'Pro スターター');
  assert.equal(localOfferName('Ultra 四人共享', 'zh-CN'), 'Ultra 四人共享');
  assert.equal(localOfferName('Ultra 体验', 'en'), 'Ultra 体验', 'an unknown tier stays as entered');
  assert.equal(localOfferDescription('ultra', 2, 'zh-CN'), '两人共用一个 Ultra 账号，每周限额各得一半');
  assert.equal(localOfferDescription('ultra', 4, 'zh-CN'), '四人共用一个 Ultra 账号，每周限额各得四分之一');
  assert.equal(localOfferDescription('max', 2, 'zh-CN'), '两人共用一个 Max 账号，5 小时限额和每周限额各得一半');
  assert.equal(localOfferDescription('max', 1, 'zh-CN'), '一个 Max 账号，只分配给你一人');
  assert.equal(localOfferDescription('pro', 1, 'zh-CN'), '5 小时限额和每周限额等于一个 Claude Pro 账号');
  assert.equal(localOfferDescription('ultra', 2, 'en'), 'Two people share one Ultra account; each gets half the weekly limit');
  assert.equal(localOfferDescription('', 2, 'en'), '', 'unclassified accounts keep the share text');
  assert.equal(localOfferDescription('gold', 1, 'en'), '');
  assert.equal(localOfferDescription('max', 3, 'en'), '');
});
