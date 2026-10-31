import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSecurityFixture, signInDestinationMatches } from './helpers/security-contract.mjs';

const ready = () => ({ security: { schemaVersion: 1, synthetic: true, realProviderCallsAllowed: false,
  username: 'synthetic-first', otherUsername: 'synthetic-other', password: 'synthetic-password',
  model: 'synthetic-model', reply: 'Synthetic reply', usage: { inputTokens: 7, outputTokens: 3 },
  price: { inputMicroPerMillion: 1_000_000, outputMicroPerMillion: 1_000_000 } } });

test('security debit is independently calculated from shared provider usage and seeded prices', () => {
  assert.equal(parseSecurityFixture(ready()).expectedChargeMicro, 10);
  const different = ready(); different.security.usage.inputTokens = 8; different.security.usage.outputTokens = 5;
  different.security.price.outputMicroPerMillion = 2_000_000;
  assert.equal(parseSecurityFixture(different).expectedChargeMicro, 18);
});

test('security fixture rejects unsafe, incomplete or inexact metering inputs', () => {
  for (const change of [f => { f.realProviderCallsAllowed = true; }, f => { f.schemaVersion = 2; },
    f => { f.usage.inputTokens = -1; }, f => { f.price.inputMicroPerMillion = 0.1; },
    f => { f.price.inputMicroPerMillion = 1; }, f => { f.otherUsername = f.username; }]) {
    const value = ready(); change(value.security); assert.throws(() => parseSecurityFixture(value));
  }
});

test('sign-in assertions retain origin and path boundaries while checking the actual session change reason', () => {
  const base = 'http://127.0.0.1:18080';
  assert.equal(signInDestinationMatches(base + '/app/start/', base), true);
  assert.equal(signInDestinationMatches(base + '/app/start/?session=changed', base, true), true);
  for (const path of ['/app/start/', '/app/start/?session=wrong', '/app/start/?session=changed&session=changed', '/other/?session=changed']) {
    assert.equal(signInDestinationMatches(base + path, base, true), false);
  }
  assert.equal(signInDestinationMatches('http://127.0.0.1:18081/app/start/?session=changed', base, true), false);
});
