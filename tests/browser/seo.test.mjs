import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';

const fixture = createBrowserFixture();
before(() => fixture.start());
after(() => fixture.stop());

test('public SEO excludes stale commercial offers and private account routes', async t => {
  const { page, base, errors } = await fixture.setup(t);
  await page.goto(base + '/');
  const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent())['@graph'];
  const application = graph.find(item => item['@type'] === 'SoftwareApplication');
  assert.equal(Object.hasOwn(application, 'offers'),false,'static pages must not publish configured or stale prices as purchasable offers');
  assert.doesNotMatch(JSON.stringify(graph),/Haiku 5\.5|Fable 5\.5|3988|\{pct\}|\{zhe\}/);
  assert.equal(await page.locator('link[rel=alternate][hreflang="zh-CN"]').getAttribute('href'), 'https://fells.dev/zh/');
  assert.equal(await page.locator('link[href*="fonts.googleapis.com"],link[href*="fonts.gstatic.com"]').count(), 0);
  const robots = await (await page.request.get(base + '/robots.txt')).text();
  assert.match(robots, /Disallow: \/support\//);
  const sitemapIndex = await (await page.request.get(base + '/sitemap-index.xml')).text();
  assert.match(sitemapIndex, /sitemap-0\.xml/);
  const sitemap = await (await page.request.get(base + '/sitemap-0.xml')).text();
  assert.match(sitemap, /https:\/\/fells\.dev\/zh\/faq\//);
  for (const policy of ['terms', 'privacy', 'refund']) for (const prefix of ['', 'zh/', 'zh-hant/', 'ja/', 'ko/', 'es/']) assert.ok(sitemap.includes(`https://fells.dev/${prefix}${policy}/`), `${prefix}${policy} is a real public policy route`);
  assert.doesNotMatch(sitemap, /\/support\/|\/app\/|\/checkout\//);
  await page.goto(base + '/faq/');
  const faq = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent())['@graph'].find(item => item['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, await page.locator('.list details').count(), 'JSON-LD and visible FAQ retain all business-policy questions');
  await page.goto(base + '/support/desk/');
  assert.equal(await page.locator('script[type="application/ld+json"]').count(), 0);
  assert.match(await page.locator('meta[name=robots]').getAttribute('content'), /noindex/);
  assert.deepEqual(errors, []);
});
