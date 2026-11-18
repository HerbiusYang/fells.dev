import test from 'node:test';
import assert from 'node:assert/strict';
import { businessRules } from '../src/i18n/business-rules.ts';

test('all six customer languages state the API funding order and Token Plan period', () => {
  const independent = { en: 'independent', zh: '独立', 'zh-hant': '獨立', ja: '独立', ko: '독립', es: 'independiente' };
  for (const [locale, rules] of Object.entries(businessRules)) {
    for (const field of ['modes', 'payg', 'clients']) {
      const copy = rules[field];
      assert.ok(copy.includes('Token Plan'), `${locale}.${field}: plan first`);
      assert.ok(copy.indexOf('Token Plan') < copy.indexOf(independent[locale]), `${locale}.${field}: independent allowance follows plan`);
    }
    assert.match(rules.tokenPlan, /30/);
    assert.match(rules.tokenPlanCapacity, /30/);
  }
});

test('all six languages debit Token Plan and free API quota at the official price with no discount',async()=>{
  const {pricingDebitNoteOf}=await import('../src/i18n/pricing.ts');
  const {tokenPlanTermWordsOf}=await import('../src/i18n/token-plan-terms.ts');
  const official={en:/official price/,zh:/官方原价/,'zh-hant':/官方原價/,ja:/公式価格/,ko:/공식 가격/,es:/precio oficial/};
  for(const [locale,rules] of Object.entries(businessRules)){
    const note=pricingDebitNoteOf(locale);assert.match(note,official[locale]);assert.match(note,/USD/);assert.doesNotMatch(note,/Fells/);
    assert.ok(rules.tokenPlan.includes(note),`${locale}: Token Plan states the official price`);
    assert.ok(rules.payg.includes(note),`${locale}: free API quota states the official price`);
    assert.ok(rules.tokenPlan.includes(tokenPlanTermWordsOf(locale).nonRefundable),`${locale}: Token Plan is non-refundable`);
    assert.match(rules.tokenPlan,/GLM/);assert.match(rules.tokenPlan,/Kimi/);
    assert.doesNotMatch(rules.payg,/GLM|Kimi/,`${locale}: Token Plan bonus wording stays out of free API quota`);
  }
  assert.equal(pricingDebitNoteOf('zh-CN'),pricingDebitNoteOf('zh'));assert.equal(pricingDebitNoteOf('zh-TW'),pricingDebitNoteOf('zh-hant'));assert.equal(pricingDebitNoteOf('xx'),pricingDebitNoteOf('en'));
});
