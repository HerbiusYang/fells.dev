import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { summarizeBrowserCoverage } from '../scripts/browser-coverage.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fells-coverage-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist'), coverage = join(root, 'coverage'), report = join(root, 'report.json');
  await mkdir(dist); await mkdir(coverage);
  const source = 'x'.repeat(100);
  await writeFile(join(dist, 'app.js'), source);
  const snapshot = (ranges, text = source) => [{ source: text, functions: ranges.map(range => ({ ranges: [range] })) }];
  const range = (startOffset, endOffset, count) => ({ startOffset, endOffset, count });
  return { dist, coverage, report, source, snapshot, range };
}

test('coverage subtracts uncalled nested code before merging execution across snapshots', async t => {
  const f = await fixture(t), r = f.range;
  await writeFile(join(f.coverage, 'first.json'), JSON.stringify(f.snapshot([r(0, 100, 1), r(10, 40, 0)])));
  assert.equal((await summarizeBrowserCoverage(f.dist, f.coverage, f.report)).covered, 70);
  await writeFile(join(f.coverage, 'second.json'), JSON.stringify(f.snapshot([r(0, 100, 1), r(10, 40, 1)])));
  assert.equal((await summarizeBrowserCoverage(f.dist, f.coverage, f.report, 100)).percent, 100);
  // A taken inner block can contribute coverage inside an untaken outer range.
  await rm(join(f.coverage, 'second.json'));
  await writeFile(join(f.coverage, 'first.json'), JSON.stringify(f.snapshot([r(0, 100, 1), r(10, 60, 0), r(20, 30, 1)])));
  assert.equal((await summarizeBrowserCoverage(f.dist, f.coverage, f.report)).covered, 60);
});

test('coverage includes untouched assets and executable inline MIME types, and deduplicates scripts', async t => {
  const f = await fixture(t), inline = 'let ready = true;';
  await writeFile(join(f.dist, 'copy.js'), f.source);
  await writeFile(join(f.dist, 'page.html'), `<script type="application/javascript">${inline}</script><script type="module">${inline}</script><script type="application/ld+json">{}</script><script type="importmap">{}</script><script src="app.js"></script>`);
  await writeFile(join(f.dist, 'empty.js'), '');
  await writeFile(join(f.coverage, 'snapshot.json'), JSON.stringify(f.snapshot([f.range(0, 100, 1)])));
  const report = await summarizeBrowserCoverage(f.dist, f.coverage, f.report);
  assert.equal(report.total, 100 + inline.length);
  assert.equal(report.covered, 100);
  assert.equal(report.files.length, 3);
  assert.equal(report.files.find(file => file.total === inline.length).covered, 0);
  assert.equal(report.files.find(file => file.total === 0).percent, 100);
  await assert.rejects(summarizeBrowserCoverage(f.dist, f.coverage, f.report, 100), /below 100/);
  await writeFile(join(f.coverage, 'retired.json'), JSON.stringify([{ url: '/app.js', functions: [{ ranges: [f.range(0, 100, 1)] }] }]));
  const withRetired = await summarizeBrowserCoverage(f.dist, f.coverage, f.report);
  assert.equal(withRetired.unattributedEntries, 1);
  assert.equal(withRetired.covered, report.covered, 'missing sources cannot increase measured coverage');
});

test('coverage fails closed for invalid thresholds or a changed collector format', async t => {
  const f = await fixture(t);
  for (const minimum of [NaN, -1, 101]) await assert.rejects(summarizeBrowserCoverage(f.dist, f.coverage, f.report, minimum), /between 0 and 100/);
  await writeFile(join(f.coverage, 'broken.json'), JSON.stringify([{ text: f.source, ranges: [] }]));
  await assert.rejects(summarizeBrowserCoverage(f.dist, f.coverage, f.report), /Invalid Playwright V8/);
});
