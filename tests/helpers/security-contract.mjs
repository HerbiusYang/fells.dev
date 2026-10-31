import assert from 'node:assert/strict';

/** Shared inputs describe the synthetic provider and seeded price, never a debit read from the product. */
export function parseSecurityFixture(ready) {
  const fixture = ready?.security;
  assert.equal(fixture?.schemaVersion, 1, 'A versioned security fixture is required');
  assert.equal(fixture.synthetic, true);
  assert.equal(fixture.realProviderCallsAllowed, false);
  for (const field of ['username', 'otherUsername']) assert.match(fixture[field], /^[a-z0-9_-]{3,32}$/);
  assert.notEqual(fixture.username, fixture.otherUsername);
  assert.equal(typeof fixture.password, 'string'); assert.ok(fixture.password.length >= 12);
  assert.equal(typeof fixture.model, 'string'); assert.ok(fixture.model.length > 0 && fixture.model.length <= 200);
  assert.doesNotMatch(fixture.model, /[\u0000-\u001f\u007f]/);
  assert.equal(typeof fixture.reply, 'string'); assert.ok(fixture.reply.length > 0 && fixture.reply.length <= 32768);
  for (const value of [fixture.usage?.inputTokens, fixture.usage?.outputTokens, fixture.price?.inputMicroPerMillion, fixture.price?.outputMicroPerMillion]) {
    assert.ok(Number.isSafeInteger(value) && value > 0, 'Synthetic usage and price must be positive safe integers');
  }
  const numerator = BigInt(fixture.usage.inputTokens) * BigInt(fixture.price.inputMicroPerMillion)
    + BigInt(fixture.usage.outputTokens) * BigInt(fixture.price.outputMicroPerMillion);
  // Deliberately use exact micro amounts so this independent check needs no
  // copy of the production billing rounding implementation.
  assert.equal(numerator % 1_000_000n, 0n, 'Fixture prices must produce an exact micro debit');
  const expectedChargeMicro = numerator / 1_000_000n;
  assert.ok(expectedChargeMicro <= BigInt(Number.MAX_SAFE_INTEGER));
  return { ...fixture, expectedChargeMicro: Number(expectedChargeMicro) };
}

export function signInDestinationMatches(value, origin, sessionChanged = false) {
  const url = new URL(value), expected = new URL(origin);
  return url.origin === expected.origin && !url.username && !url.password
    && /^\/app\/start\/?$/.test(url.pathname)
    && (!sessionChanged || url.searchParams.getAll('session').length === 1 && url.searchParams.get('session') === 'changed');
}
