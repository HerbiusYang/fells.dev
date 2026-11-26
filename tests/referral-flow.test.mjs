import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReferralParam } from '../src/lib/referral-link.ts';
import { rebateCreditRef, renderInviteDialogBody } from '../src/lib/referral-view.ts';
import { referralWordsOf } from '../src/i18n/referral.ts';
import { ledgerKind } from '../src/i18n/wallet-ledger.ts';

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cny = (yuan) => `¥${yuan.toFixed(2)}`;
const dfmt = (ms) => new Date(ms).toISOString().slice(0, 10);

test('cleanReferralParam accepts valid invite codes and rejects unsafe input', () => {
  for (const [raw, want] of [
    ['  AB12CD34  ', 'AB12CD34'],
    ['friend-code', 'friend-code'],
    ['VALID_123', 'VALID_123'],
    ['', ''],
    ['has space', ''],
    ['<script>', ''],
    ['a'.repeat(65), ''],
  ]) {
    assert.equal(cleanReferralParam(raw), want, raw);
  }
});

test('rebateCreditRef produces the backend-required rebate-credit prefix', () => {
  const key = '00000000-0000-4000-8000-000000000042';
  assert.equal(rebateCreditRef(key), `rebate-credit:${key}`);
});

test('referralWordsOf covers all six locales with complete labels', () => {
  for (const locale of ['en', 'zh', 'zh-CN', 'zh-hant', 'zh-TW', 'ja', 'ko', 'es', 'fr']) {
    const words = referralWordsOf(locale);
    assert.ok(words.authLabel.length > 0, locale);
    assert.ok(words.copyCode.length > 0 && words.copyLink.length > 0, locale);
    assert.ok(words.kinds.referral_bonus.length > 0, locale);
  }
  assert.equal(referralWordsOf('fr').authLabel, referralWordsOf('en').authLabel);
});

test('renderInviteDialogBody renders code, rates, min top-up, team, balances, pending bonuses and ledger safely', () => {
  const html = renderInviteDialogBody({
    referral: {
      active: true,
      name: 'Q4 Referral',
      reward_terms: '好友首次付费 14 天后，你和好友各得 ¥100',
      referee_reward_terms: '首次付费 14 天后，你得 ¥100',
      bonus_min_topup_micro: 99_000_000,
      stat: { code: 'AB12CD34', invited: 5, converted: 3, rewards: 2, pending: 1 },
      pending_bonuses: [{ referee: '<guest>', referrer_micro: 50_000_000, due_at: 1800000000 }],
    },
    rebates: {
      active: true,
      percents: [1.5, 0.5, 0.25],
      team: [4, 2, 1],
      hold_days: 0,
      window_months: 0,
      summary: {
        payable_micro: 12_500_000,
        held_micro: 3_000_000,
        pending_bonus_micro: 50_000_000,
        accrued_micro: 40_000_000,
        credited_micro: 20_000_000,
        paid_micro: 4_500_000,
      },
      entries: [
        { kind: 'referral_bonus', level: 1, referee: 'bob', created_at: 1790000000, delta_micro: 50_000_000 },
        { kind: 'credit', level: 0, referee: '', created_at: 1790000100, delta_micro: -20_000_000 },
      ],
    },
    href: 'https://fells.dev/zh/app/start/?ref=AB12CD34#signup',
    copiedMsg: '已复制',
    notOffered: '推荐奖励暂未开放。',
    words: referralWordsOf('zh-CN'),
    cny,
    dfmt,
    esc,
  });

  assert.match(html, /AB12CD34/);
  assert.match(html, /单笔最低实付：¥99\.00/);
  assert.match(html, /1级 1\.5% \/ 2级 0\.5% \/ 3级 0\.25%/);
  assert.match(html, /1级 4 · 2级 2 · 3级 1/);
  assert.match(html, /¥12\.50/);
  assert.match(html, /挂账中 ¥3\.00/);
  assert.match(html, /待到期固定奖励 ¥50\.00/);
  assert.match(html, /无挂账期/);
  assert.match(html, /计酬期不限/);
  assert.match(html, /&lt;guest&gt;/);
  assert.doesNotMatch(html, /<guest>/);
  assert.match(html, /推荐固定奖励/);
  assert.doesNotMatch(html, /data-act="rebate-credit"[^>]*disabled/);
});

test('renderInviteDialogBody shows fallback copy and disables transfer when inactive and payable is zero', () => {
  const html = renderInviteDialogBody({
    referral: { active: false, stat: { code: 'ONLYCODE', invited: 0, converted: 0 } },
    rebates: { active: false, summary: { payable_micro: 0 }, hold_days: 30, window_months: 12 },
    href: 'https://fells.dev/app/start/?ref=ONLYCODE#signup',
    copiedMsg: 'Copied',
    notOffered: 'No referral reward is currently offered.',
    words: referralWordsOf('en'),
    cny,
    dfmt,
    esc,
  });
  assert.match(html, /No referral reward is currently offered\./);
  assert.match(html, /Hold period: 30 days/);
  assert.match(html, /earning window: 12 months/);
  assert.match(html, /data-act="rebate-credit"\s+disabled/);
});

test('wallet ledger classifies referral grants, rebate credits and their reversals cleanly', () => {
  for (const lang of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) {
    const credit = ledgerKind('rebate', lang);
    const refund = ledgerKind('refund', lang);
    assert.equal(ledgerKind('rebate_credit', lang), credit, lang);
    assert.equal(ledgerKind('referral_grant', lang), credit, lang);
    assert.equal(ledgerKind('referral_grant_reverse', lang), refund, lang);
    assert.equal(ledgerKind('rebate_credit_reverse', lang), refund, lang);
  }
});
