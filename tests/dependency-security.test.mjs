import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

// Exercise the version Astro actually uses, rather than a separate direct dependency.
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro'));
const CachePolicy = astroRequire('http-cache-semantics');
const request = { url: 'https://audit.invalid/private', method: 'GET', headers: {} };
const staleRequest = { ...request, headers: { 'cache-control': 'max-stale=31536000' } };

for (const [name, headers] of Object.entries({
  'session cookies': { 'cache-control': 'max-age=3600', 'set-cookie': 'session=synthetic-audit-cookie' },
  'no-store responses': { 'cache-control': 'no-store' },
  'private responses': { 'cache-control': 'private,max-age=3600' },
  'no-cache responses': { 'cache-control': 'no-cache,max-age=3600' },
  'mixed-case private responses': { 'cache-control': 'Private,Max-Age=3600' },
  'mixed-case no-store responses': { 'cache-control': 'No-Store' },
  'mixed-case no-cache responses': { 'cache-control': 'No-Cache,Max-Age=3600' },
  'proxy revalidation': { 'cache-control': 'Proxy-Revalidate,max-age=1' },
  'mandatory revalidation': { 'cache-control': 'Must-Revalidate,max-age=1' },
  'shared expiration': { 'cache-control': 'public,S-Maxage=1,max-age=3600' },
  'zero shared expiration': { 'cache-control': 'public,s-maxage=0,max-age=3600' },
})) {
  test(`stale directives cannot bypass cache protection for ${name}`, () => {
    const policy = new CachePolicy(request, { status: 200, headers: {
      ...headers, 'cache-control': headers['cache-control'] + ',stale-while-revalidate=60,stale-if-error=60',
    } });
    const createdAt = policy.toObject().t;
    policy.now = () => createdAt + 2000;
    assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), false);
    assert.equal(policy.evaluateRequest(staleRequest).response, undefined);
    assert.equal(policy.evaluateRequest(request).response, undefined, 'background revalidation cannot expose the protected body');
    assert.equal(policy.timeToLive(), 0, 'Astro TTL caches cannot extend the protected body');
    const result = policy.revalidatedPolicy(request, { status: 500, headers: {} });
    assert.notEqual(result.policy, policy, 'an origin error cannot reuse the protected body');
    assert.equal(result.modified, true);
  });
}

test('explicitly public expired responses retain legitimate max-stale behavior', () => {
  const policy = new CachePolicy(request, { status: 200, headers: { 'cache-control': 'public,max-age=1' } });
  const createdAt = policy.now();
  policy.now = () => createdAt + 2000;
  assert.equal(policy.satisfiesWithoutRevalidation(staleRequest), true);
});

test('public stale extensions remain available for a matching request but never another Vary variant', () => {
  const first = { ...request, headers: { cookie: 'user=synthetic-A' } };
  const other = { ...request, headers: { cookie: 'user=synthetic-B' } };
  const policy = new CachePolicy(first, { status: 200, headers: {
    vary: 'cookie', 'cache-control': 'public,max-age=1,stale-while-revalidate=60,stale-if-error=60',
  } });
  const createdAt = policy.toObject().t;
  policy.now = () => createdAt + 2000;
  assert.ok(policy.evaluateRequest(first).response);
  assert.equal(policy.evaluateRequest(other).response, undefined);
  assert.equal(policy.revalidatedPolicy(first, { status: 500, headers: {} }).policy, policy);
  assert.notEqual(policy.revalidatedPolicy(other, { status: 500, headers: {} }).policy, policy);
  assert.notEqual(policy.revalidatedPolicy({ ...first, url: 'https://audit.invalid/other' }, { status: 500, headers: {} }).policy, policy);
});

test('shared expiration allows fresh public data without extending it, while private caches keep their own freshness', () => {
  const headers = { 'cache-control': 'public,s-maxage=1,max-age=3600,stale-while-revalidate=60,stale-if-error=60' };
  const shared = new CachePolicy(request, { status: 200, headers });
  const createdAt = shared.toObject().t;
  shared.now = () => createdAt;
  assert.equal(shared.satisfiesWithoutRevalidation(request), true);
  assert.equal(shared.timeToLive(), 1000);
  const privateCache = new CachePolicy(request, { status: 200, headers }, { shared: false });
  privateCache.now = () => privateCache.toObject().t + 2000;
  assert.equal(privateCache.satisfiesWithoutRevalidation(request), true);
});
