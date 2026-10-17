import test from 'node:test';
import assert from 'node:assert/strict';
import { supportLifecycleCopy } from '../src/i18n/support-lifecycle.ts';
import { supportCasesCopy } from '../src/i18n/support-cases.ts';
import { supportOrdersCopy } from '../src/i18n/support-orders.ts';
import { supportCopy } from '../src/i18n/support.ts';
import { businessRules, businessRulesOf } from '../src/i18n/business-rules.ts';
import { supportLifecycleMarkup, supportDisputeForm } from '../src/lib/support-lifecycle.ts';
import { supportQuoteMarkup } from '../src/scripts/support-order-quote.ts';

const id = '00000000-0000-4000-8000-000000000090', deadline = '2026-10-29T12:34:56Z';
const order = { id, amountMicro: 22000000, planCode: 'original-code', version: 9 };

test('language aliases and unsupported locales retain complete customer policy and support labels', () => {
  for (const getCopy of [supportLifecycleCopy, supportCasesCopy, supportOrdersCopy, supportCopy]) {
    assert.deepEqual(getCopy('zh'), getCopy('zh-CN'));
    assert.deepEqual(getCopy('zh-hant'), getCopy('zh-TW'));
    const fallback = getCopy('fr');
    if (getCopy === supportLifecycleCopy) {
      assert.equal(fallback.policy, getCopy('en').policy);
      assert.equal(fallback.orderHistory, getCopy('en').orderHistory);
      assert.ok(Object.values(fallback).every(value => typeof value === 'string' && value.length > 0), 'unsupported language keeps every policy label available');
    } else assert.deepEqual(fallback, getCopy('en'), 'unsupported language falls back to complete English copy');
  }
  for (const [language, expected] of [['ZH-TW', 'zh-hant'], ['zh-Hant-HK', 'zh-hant'], ['zh-CN', 'zh'], ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['es-MX', 'es'], ['fr-FR', 'en']]) {
    assert.equal(businessRulesOf(language), businessRules[expected]);
  }
  const monthStatements = [
    ['en', /per Los Angeles month/, /Los Angeles calendar month/],
    ['zh-CN', /洛杉矶自然月/, /洛杉矶自然月/],
    ['zh-TW', /洛杉磯自然月/, /洛杉磯自然月/],
    ['ja', /ロサンゼルス暦月/, /ロサンゼルス暦月/],
    ['ko', /로스앤젤레스 달력 월/, /로스앤젤레스 달력 월/],
    ['es', /mes natural de Los Ángeles/, /mes natural de Los Ángeles/],
    ['fr', /per Los Angeles month/, /Los Angeles calendar month/],
  ];
  for (const [language, rewardMonth, compensationMonth] of monthStatements) {
    const policy = supportLifecycleCopy(language);
    assert.match(policy.rewardPolicy, rewardMonth, `${language}: reward cap uses the Los Angeles month`);
    assert.match(policy.caps, compensationMonth, `${language}: compensation cap uses the Los Angeles calendar month`);
    assert.ok(policy.historySyncPending.length > 0);
    assert.ok(policy.policyShort.includes('14'));
    assert.ok(policy.channelFrozen.length > 0);
    assert.ok(policy.acceptRewardLoss.length > 0);
  }
});

test('waiting, delivery deadlines and closure provenance stay distinct from personal confirmation', () => {
  const copy = supportLifecycleCopy('en');
  assert.equal(supportLifecycleMarkup({}, 'en'), '');
  for (const waitingOn of ['team', 'customer', 'none', 'owner']) {
    const markup = supportLifecycleMarkup({ waitingOn }, 'en');
    assert.ok(markup.includes(waitingOn === 'customer' ? copy.customer : waitingOn === 'none' ? copy.none : copy.team));
    assert.match(markup, new RegExp(`data-waiting-on="${waitingOn}"`));
  }
  const delivered = supportLifecycleMarkup({ acceptanceDeadline: deadline }, 'en');
  assert.match(delivered, /data-acceptance-deadline/);
  assert.match(delivered, /datetime="2026-10-29T12:34:56Z"/);
  for (const acceptanceKind of ['system_timeout', 'system_no_objection']) {
    for (const acceptanceDeadline of [deadline, null]) {
      const markup = supportLifecycleMarkup({ acceptanceKind, acceptanceDeadline }, 'en');
      assert.match(markup, /data-system-closure/);
      assert.doesNotMatch(markup, /data-personal-acceptance|data-acceptance-deadline/);
      assert.equal(markup.includes('<time'), acceptanceDeadline !== null);
    }
  }
  const personal = supportLifecycleMarkup({ acceptanceKind: 'customer', acceptanceDeadline: deadline }, 'en');
  assert.match(personal, /data-personal-acceptance/);
  assert.doesNotMatch(personal, /data-system-closure|data-acceptance-deadline/);
  for (const disputeReason of ['', '<img src=x onerror=unsafe>']) {
    const disputed = supportLifecycleMarkup({ disputedAt: deadline, disputeReason, acceptanceDeadline: deadline }, 'en');
    assert.match(disputed, /data-dispute-state/);
    assert.doesNotMatch(disputed, /data-acceptance-deadline|<img/);
    if (disputeReason) assert.match(disputed, /&lt;img/);
  }
});

test('reward displays the actual credited amount and explains cap exhaustion without fabricating a reward', () => {
  for (const item of [{ rewardStatus: 'monthly_cap_reached' }, { rewardReason: 'monthly_cap_reached' }]) {
    const markup = supportLifecycleMarkup(item, 'en');
    assert.match(markup, /data-reward-none/);
    assert.doesNotMatch(markup, /data-reward-received/);
  }
  for (const rewardAllowanceMicro of [undefined, 0]) assert.doesNotMatch(supportLifecycleMarkup({ rewardAllowanceMicro, rewardStatus: 'ineligible' }, 'en'), /data-reward/);
  const credited = supportLifecycleMarkup({ rewardAllowanceMicro: 1230000, rewardStatus: 'awarded' }, 'en');
  assert.match(credited, /data-reward-received/);
  assert.match(credited, /\$1\.23/);
  assert.ok(credited.includes(supportLifecycleCopy('en').rewardRights));
  assert.ok(credited.includes(supportLifecycleCopy('en').rewardRefundPolicy));
});

test('order and case problem forms require a description and preserve their original escaped identity', () => {
  for (const kind of ['order', 'case']) {
    const markup = supportDisputeForm(kind, 'id"><script>unsafe</script>', 'en');
    assert.match(markup, new RegExp(`data-${kind}-dispute="id&quot;&gt;&lt;script&gt;`));
    assert.match(markup, /name="reason" required maxlength="4000"/);
    assert.match(markup, /data-dispute-cancel/);
    assert.doesNotMatch(markup, /<script>/);
  }
});

test('revised quote consent retains original paid price, complete rights and captured evidence without accepting delivery', () => {
  assert.equal(supportQuoteMarkup(order, 'en', 'customer'), '');
  assert.equal(supportQuoteMarkup({ ...order, quoteReconfirmation: { state: 'confirmed' } }, 'en', 'customer'), '');
  const quoteReconfirmation = { state: 'pending', reason: 'Missing <legacy> quota', evidence: { messageText: 'Agreed <message>', attachmentName: 'proof <1>.png' }, quoteSnapshot: { amountMicro: 99000000, serviceDays: 30, tokenPlan: { name: 'Revised <plan>', quota_usd_micro: 5000000, burst_usd_micro: 12000000 } } };
  const markup = supportQuoteMarkup({ ...order, quoteReconfirmation }, 'en', 'customer');
  assert.match(markup, /22\.00/); assert.doesNotMatch(markup, /99\.00/);
  assert.match(markup, /Revised &lt;plan&gt;/); assert.match(markup, /Agreed &lt;message&gt;/); assert.match(markup, /proof &lt;1&gt;\.png/);
  assert.match(markup, /5\.00/); assert.match(markup, /12\.00/);
  assert.match(markup, /not additional/);
  assert.match(markup, /data-order-confirm-quote/);
  assert.doesNotMatch(markup, /data-order-accept|data-case-accept|data-order-requote/);
  assert.match(markup, /does not confirm delivery or issue a reward/);
});

test('legacy paid quote is read-only to staff while manual records keep escaped evidence choices', () => {
  const quoteReconfirmation = { state: 'required', reason: '', quoteSnapshot: null };
  const markup = supportQuoteMarkup({ ...order, quoteReconfirmation }, 'en', 'operator', [{ id: '31', text: '<customer>'.repeat(12) }, { id: '32', text: '' }]);
  assert.match(markup, /original-code/);
  assert.doesNotMatch(markup, /data-order-requote/);
  const manual = supportQuoteMarkup({ ...order, product:'other',quoteReconfirmation }, 'en', 'operator', [{id:'31',text:'<customer>'.repeat(12)},{id:'32',text:''}]);
  assert.match(manual,/data-order-requote/);
  assert.match(manual, /name="version" value="9"/);
  assert.match(manual, /value="31"/); assert.match(manual, /value="32"/);
  assert.match(manual, /&lt;customer&gt;/); assert.match(manual, /📎/);
  assert.doesNotMatch(markup, /data-order-confirm-quote|<customer>/);
  const sparse = supportQuoteMarkup({ ...order, planCode: '', quoteReconfirmation: { state: 'pending', quoteSnapshot: { serviceDays: 'unknown', tokenPlan: { name: 12 }, evidence: { messageText: 'Captured legacy evidence' } } } }, 'en', 'customer');
  assert.match(sparse, /Captured legacy evidence/);
  assert.doesNotMatch(sparse, /Guaranteed API allowance|Total flexible limit|unknown|undefined/);
});
