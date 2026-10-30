import test from 'node:test';
import assert from 'node:assert/strict';
import { api, APIError } from '../src/lib/app-http.ts';
import { accountErrorMessage, accountLanguage } from '../src/i18n/api-errors.ts';

for (const [language, expected] of [['en', 'en'], ['zh-CN', 'zh-CN'], ['zh-TW', 'zh-TW'], ['ja', 'ja'], ['ko', 'ko'], ['es', 'es']]) test(`API language and coded errors follow the page locale: ${language}`, async t => {
  const previous = globalThis.fetch, previousDocument = globalThis.document, previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  t.after(() => { globalThis.fetch = previous; if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; if (previousNavigator === undefined) delete globalThis.navigator; else Object.defineProperty(globalThis, 'navigator', previousNavigator); });
  globalThis.document = { documentElement: { lang: language } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } });
  globalThis.fetch = async (_path, options) => {
    assert.equal(options.headers.get('Accept-Language'), expected);
    return Response.json({ error_key: 'terms_changed', error: '服务器中文原文', transaction_rejected: true, current_price_micro: 99 }, { status: 409, headers: { 'Retry-After': '2' } });
  };
  await assert.rejects(api('/api/app/plans/buy', { body: {} }), error => {
    assert.ok(error instanceof APIError); assert.equal(error.code, 'terms_changed');
    assert.equal(error.message, accountErrorMessage(language, 'terms_changed', '', 409));
    assert.equal(error.transactionRejected, true); assert.equal(error.retryAfter, 2); assert.equal(error.details.current_price_micro, 99);
    return true;
  });
});
test('unsupported locales and unknown codes cannot inject a language or prototype entry', () => {
  assert.equal(accountLanguage('not-a-locale\r\nsecret'), 'en');
  assert.equal(typeof accountErrorMessage('ja', '__proto__', 'internal server text', 503), 'string');
  assert.notEqual(accountErrorMessage('es', 'unknown', '服务器中文原文', 400), '服务器中文原文');
  assert.notEqual(accountErrorMessage('en', 'unknown', '服务器中文原文', 400), '服务器中文原文');
});
