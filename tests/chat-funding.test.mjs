import test from 'node:test';
import assert from 'node:assert/strict';
import { chatFundingWordsOf } from '../src/i18n/chat-funding.ts';
import { businessRulesOf } from '../src/i18n/business-rules.ts';

test('conversation funding terms are complete in every supported language and regional alias', () => {
  const fields = Object.keys(chatFundingWordsOf('en'));
  for (const [language, expected] of [['en-US', 'en'], ['zh-CN', 'zh'], ['zh-TW', 'zh-hant'], ['zh-Hant-HK', 'zh-hant'], ['ja-JP', 'ja'], ['ko-KR', 'ko'], ['es-MX', 'es'], ['fr-FR', 'en']]) {
    const copy = chatFundingWordsOf(language);
    assert.equal(copy, chatFundingWordsOf(expected));
    assert.deepEqual(Object.keys(copy), fields);
    assert.ok(fields.every(field => typeof copy[field] === 'string' && copy[field].trim()), language);
    assert.match(copy.order, /Token Plan/);
    assert.match(copy.account, /API/);
    assert.doesNotMatch(businessRulesOf(language).webAccount, /does not.*generate|不会.*生成|不會.*產生|生成は行いません|생성하지 않습니다|ni genera respuestas/);
  }
});
