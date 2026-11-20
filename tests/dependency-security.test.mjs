import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { verifiedBackport } from '../scripts/audit-dependencies.mjs';

// Exercise the version Astro actually uses, rather than a separate direct dependency.
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro'));
const storageRequire = createRequire(astroRequire.resolve('unstorage'));
const watcherRequire = createRequire(storageRequire.resolve('anymatch'));
for (const [name, matcher] of [['Astro', astroRequire('picomatch')], ['anymatch', watcherRequire('picomatch')]]) {
  test(name + ' bounds repetition of a wildcard segment and preserves ordinary file matching', () => {
    for (const [repeat, close] of [['+', ')'], ['*', ')?']]) {
      const pattern = 'assets/' + repeat + '(page*)/index.html';
      const closing = matcher.parse(pattern).tokens.find(token => token.extglob && token.value === ')');
      assert.equal(closing.output, close);
      assert.ok(matcher(pattern)('assets/page-list/index.html'));
      assert.equal(matcher(pattern)('assets/home/index.html'), false);
      assert.equal(matcher(pattern)('assets//index.html'), repeat === '*');
    }
    assert.ok(matcher('src/**/*.astro')('src/components/Example.astro'));
    assert.ok(matcher('+(a|b).js')('abba.js'));
    assert.ok(matcher('+(docs/*/)guide.md')('docs/en/docs/api/guide.md'));
  });
}

test('only the reviewed advisory and exact installed parser copies qualify for the backport', () => {
  const finding = { github_advisory_id: 'GHSA-fc5q-39xc-vjpf', module_name: 'picomatch', severity: 'high', findings: [
    { version: '4.0.7', paths: ['.>astro>picomatch'] },
    { version: '2.3.2', paths: ['.>astro>unstorage>anymatch>picomatch'] },
  ] };
  const report = { advisories: { pico: finding } };
  assert.ok(verifiedBackport(report));
  assert.equal(verifiedBackport({}), false);
  assert.equal(verifiedBackport({ advisories: { pico: finding, other: {} } }), false);
  assert.equal(verifiedBackport({ advisories: { other: { ...finding, github_advisory_id: 'another-advisory' } } }), false);
  for (const changed of [
    { version: '2.3.2', paths: ['.>astro>picomatch'] },
    { version: '4.0.6', paths: ['.>astro>picomatch'] },
    { version: '4.0.7', paths: [] },
  ]) assert.equal(verifiedBackport({ advisories: { pico: { ...finding, findings: [changed] } } }), false);
});

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
