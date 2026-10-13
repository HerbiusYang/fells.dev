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
