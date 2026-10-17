import assert from 'node:assert/strict';

// Only disposable loopback fixtures may seed a legacy session. Access fixtures
// supply their own identity; this helper never overrides missing/denied users.
export async function prepareSupportOperator(context, { base, email, password }) {
  const origin = new URL(base);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
  assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
  const headers = { Origin: origin.origin, 'X-Fells-Support-Audience': 'operator' };
  const access = process.env.FELLS_ACCESS_BROWSER_TEST === '1';
  if (!access) {
    assert.ok(['FELLS_LIVE_TEST', 'FELLS_DEEP_FIXES_TEST', 'FELLS_LIFECYCLE_LIVE', 'FELLS_RECOVERY_LIVE'].some(flag => process.env[flag] === '1'), 'Legacy login is restricted to explicitly enabled isolated fixtures');
    assert.ok(email && password, 'Synthetic operator credentials are required');
    const login = await context.request.post(new URL('/api/support/session', origin).href, { headers, data: { email, password } });
    assert.equal(login.status(), 200, 'Seed isolated legacy operator session');
  }
  const reply = await context.request.get(new URL('/api/support/session', origin).href, { headers });
  assert.equal(reply.status(), 200, 'Restore the fixture operator session');
  const result = await reply.json();
  assert.equal(result.ok, true); assert.ok(result.data?.sessionId && result.data.operator?.id);
  if (access) assert.equal(result.data.authMethod, 'access');
  return result.data;
}
