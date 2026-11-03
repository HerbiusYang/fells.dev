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

test('all six plan languages debit USD quota at Fells selling prices and reserve official prices for reference',async()=>{
  const {pricingDebitNoteOf}=await import('../src/i18n/pricing.ts');
  for(const [locale,rules] of Object.entries(businessRules)){
    const note=pricingDebitNoteOf(locale);assert.match(note,/Fells/);assert.match(note,/USD/);assert.ok(rules.tokenPlan.includes(note));
  }
  assert.equal(pricingDebitNoteOf('zh-CN'),pricingDebitNoteOf('zh'));assert.equal(pricingDebitNoteOf('zh-TW'),pricingDebitNoteOf('zh-hant'));assert.equal(pricingDebitNoteOf('xx'),pricingDebitNoteOf('en'));
});
