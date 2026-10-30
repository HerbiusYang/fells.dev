import test from 'node:test';
import assert from 'node:assert/strict';
import { accountUXWords } from '../src/i18n/account-ux.ts';
import { authUXWords, githubAuthError } from '../src/i18n/auth-ux.ts';
test('all six account and authentication interfaces have complete localized copy and actionable OAuth errors', () => {
  const base = Object.keys(accountUXWords('en')).sort(), authKeys = Object.keys(authUXWords('en')).sort();
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) {
    const account = accountUXWords(language), auth = authUXWords(language);
    assert.deepEqual(Object.keys(account).sort(), base); assert.deepEqual(Object.keys(auth).sort(), authKeys);
    for (const value of Object.values(account)) if (typeof value === 'string') assert.ok(value.length); else for (const text of Object.values(value)) assert.ok(typeof text === 'string' && text.length);
    assert.equal(Object.keys(account.modelDiagnostics).length, 6); assert.equal(Object.keys(account.couponStates).length, 4);
    assert.match(auth.passwordHint, /\{min\}/);
    assert.ok(new Set(['taken', 'denied', 'state', 'exchange', 'signup_closed', 'disabled', 'expired', 'server'].map(code => githubAuthError(language, code))).size >= 7);
    if (language !== 'en') { assert.notEqual(account.chatWelcome, accountUXWords('en').chatWelcome); assert.notEqual(auth.forgot, authUXWords('en').forgot); }
  }
});
