import test from 'node:test';
import assert from 'node:assert/strict';
import { planTerms, bonusModelsLabel, termLabel, tokenPlanTermWordsOf } from '../src/i18n/token-plan-terms.ts';

test('plan terms accept the public snake_case and support camelCase shapes, sorted and deduplicated', () => {
  const snake = planTerms({ price_micro: 1288000000, terms: [
    { months: 12, price_micro: 15456000000, bonus_pct: 100, bonus_usd_micro: 1000000000 },
    { months: 1, price_micro: 1288000000, bonus_pct: 30, bonus_usd_micro: 300000000 },
    { months: 1, price_micro: 1, bonus_pct: 0, bonus_usd_micro: 0 },
  ] });
  assert.deepEqual(snake.map(term => [term.months, term.priceMicro, term.bonusPct, term.bonusUsdMicro]), [[1, 1288000000, 30, 300000000], [12, 15456000000, 100, 1000000000]]);
  const camel = planTerms({ priceMicro: 99000000, terms: [{ months: 1, priceMicro: 99000000, bonusPct: 30, bonusUsdMicro: 30000000 }] });
  assert.deepEqual(camel, [{ months: 1, priceMicro: 99000000, bonusPct: 30, bonusUsdMicro: 30000000 }]);
});

test('a server without terms sells monthly only at the listed price with no bonus; malformed terms are ignored', () => {
  assert.deepEqual(planTerms({ price_micro: 2288000000 }), [{ months: 1, priceMicro: 2288000000, bonusPct: 0, bonusUsdMicro: 0 }]);
  const bad = planTerms({ price_micro: 5, terms: [{ months: 0, price_micro: 1, bonus_pct: 0, bonus_usd_micro: 0 }, { months: 25, price_micro: 1, bonus_pct: 0, bonus_usd_micro: 0 }, { months: 3, price_micro: -1, bonus_pct: 0, bonus_usd_micro: 0 }, { months: 6, price_micro: 1.5, bonus_pct: 0, bonus_usd_micro: 0 }, null, 'x'] });
  assert.deepEqual(bad, [{ months: 1, priceMicro: 5, bonusPct: 0, bonusUsdMicro: 0 }]);
});

test('bonus model globs become vendor names and fall back to GLM and Kimi', () => {
  assert.equal(bonusModelsLabel(['glm-*', 'kimi-*', 'k3', 'k3-*'], 'zh'), 'GLM、Kimi');
  assert.equal(bonusModelsLabel(['glm-*', 'kimi-*'], 'en'), 'GLM, Kimi');
  assert.equal(bonusModelsLabel(['deepseek-*', 'custom-model-*'], 'en'), 'DeepSeek, custom-model');
  assert.equal(bonusModelsLabel(undefined, 'ja'), 'GLM、Kimi');
  // The exact production scope (2026-11-18) and morph-prefixed model families.
  assert.equal(bonusModelsLabel(['*glm*', '*kimi*', 'k3', 'k3-*'], 'en'), 'GLM, Kimi');
  assert.equal(bonusModelsLabel(['*glm*', '*kimi*', 'k3', 'k3-*'], 'zh'), 'GLM、Kimi');
  assert.equal(bonusModelsLabel(['morph-glm*', 'morph-kimi*', 'morph-k3*'], 'en'), 'GLM, Kimi');
  assert.equal(bonusModelsLabel(['morph-glm52-744b', 'morph-glm53flash', 'morph-kimik31'], 'zh-hant'), 'GLM、Kimi');
  assert.equal(bonusModelsLabel(['*deepseek*', '?qwen-*', 'minimax-*'], 'en'), 'DeepSeek, Qwen, MiniMax');
});

test('every language names monthly, quarterly, half-yearly and yearly terms and states the owner decisions', () => {
  for (const locale of ['en', 'zh', 'zh-hant', 'ja', 'ko', 'es']) {
    const words = tokenPlanTermWordsOf(locale);
    assert.deepEqual(Object.keys(words.terms).map(Number), [1, 3, 6, 12], locale);
    assert.ok(new Set([1, 3, 6, 12].map(months => termLabel(months, locale))).size === 4, locale);
    assert.match(termLabel(24, locale), /24/, locale);
    assert.match(words.termsNote, /30/); assert.match(words.termsNote, /40/); assert.match(words.termsNote, /60/); assert.match(words.termsNote, /100/);
    assert.match(words.generalQuota, /Gemini/); assert.match(words.generalQuota, /Claude/); assert.match(words.generalQuota, /GPT/); assert.match(words.generalQuota, /Grok/);
    assert.match(words.bonusNote, /\{pct\}/); assert.match(words.bonusNote, /\{models\}/);
  }
  assert.equal(tokenPlanTermWordsOf('zh-CN'), tokenPlanTermWordsOf('zh'));
  assert.equal(tokenPlanTermWordsOf('zh-TW'), tokenPlanTermWordsOf('zh-hant'));
  assert.equal(tokenPlanTermWordsOf('xx'), tokenPlanTermWordsOf('en'));
});
