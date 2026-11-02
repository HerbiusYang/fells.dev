import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const load = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`);
const { renderSubscriptionOverview } = await load('../src/lib/subscription-overview.ts');
const { subscriptionOverviewWords } = await load('../src/i18n/subscription-overview.ts');
const now = Date.parse('2026-11-01T12:00:00Z'), seconds = now / 1000;
const render = value => renderSubscriptionOverview(value, subscriptionOverviewWords('en'), { locale: 'en', now, formatTime: time => new Date(time).toISOString() });
const overview = windows => ({ state: 'ready', read_at: seconds - 10, windows });

test('optional overview is absent on old responses; empty or malformed windows remain unavailable', () => {
  for (const value of [undefined, null, [], false, 'unknown']) assert.equal(render(value), '');
  for (const windows of [undefined, null, [], {}, [null, false, 'bad']]) {
    const html = render(overview(windows));
    assert.match(html, /No reading available/); assert.doesNotMatch(html, /0\.0%/);
  }
});

test('reported zero is distinct from missing, null, strings, nonfinite or out-of-range percentages', () => {
  assert.match(render(overview([{ used_pct: 0 }])), />0\.0%</);
  for (const value of [undefined, null, '0', -1, 101, NaN, Infinity]) {
    const html = render(overview([{ used_pct: value }]));
    assert.match(html, />—</); assert.doesNotMatch(html, /0\.0%/);
  }
  assert.match(render(overview([{ used_pct: 17.25 }])), />17\.3%</);
});

test('server reset and locally elapsed expected reset cannot paint obsolete zero or usage as current', () => {
  const server = render(overview([{ used_pct: 0, reset: true, reset_at: seconds + 60 }]));
  assert.match(server, /Previous window expired/); assert.match(server, />—</); assert.doesNotMatch(server, /0\.0%/);
  const elapsed = render(overview([{ used_pct: 93, reset_at: seconds - 1 }]));
  assert.match(elapsed, /Expected reset time passed/); assert.doesNotMatch(elapsed, /Previous window expired|93\.0%/);
  const current = render(overview([{ used_pct: 0, reset_at: seconds + 60 }]));
  assert.match(current, />0\.0%</); assert.match(current, /Expected reset:/);
});

test('shared subscriptions display the server-normalized percentage without dividing by seats again', () => {
  const html = render(overview([
    { basis: 'share', used_pct: 36, own_pct: 18, entitled_pct: 50, account_pct: 52 },
    { basis: 'account', used_pct: 90, own_pct: 10, entitled_pct: 50, account_pct: 95 },
  ]));
  assert.match(html, />36\.0%</); assert.match(html, />90\.0%</);
  assert.doesNotMatch(html, />18\.0%|>52\.0%|>95\.0%/);
});

test('recorded server states are preserved and a missing or future reading time does not claim freshness', () => {
  for (const state of ['ready', 'tight', 'full', 'scoped_full', 'pending', 'unknown']) {
    assert.match(render({ ...overview([]), state }), new RegExp(subscriptionOverviewWords('en').states[state]));
  }
  for (const read_at of [undefined, null, 0, '1', NaN, Infinity, seconds + 1, 1e20]) {
    const html = render({ ...overview([]), read_at });
    assert.match(html, /Reading time unavailable/); assert.doesNotMatch(html, /Reading time:/);
  }
  assert.match(render(overview([])), /Reading time: 2026-11-01T11:59:50.000Z/);
});

test('scope, unknown kind and formatter text are escaped; rendering cannot mutate the snapshot', () => {
  const value = Object.freeze({ state: 'unknown', windows: Object.freeze([Object.freeze({ scope: '<img src=x onerror=alert(1)>', used_pct: 0 }), Object.freeze({ kind: '"<script>x</script>', used_pct: 2 })]) });
  const html = renderSubscriptionOverview(value, subscriptionOverviewWords('en'), { locale: 'en', now, formatTime: () => '<time>' });
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(html, /&quot;&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script|data-act=|<button/);
  assert.equal(value.windows[0].used_pct, 0);
  assert.match(renderSubscriptionOverview({ ...overview([]), read_at: seconds }, subscriptionOverviewWords('en'), { locale: 'en', now, formatTime: () => '<time>' }), /&lt;time&gt;/);
});

test('all supported locales distinguish server expiry, estimated expiry and unavailable readings', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'zh-hant', 'ja', 'ko', 'es']) {
    const words = subscriptionOverviewWords(locale);
    for (const value of Object.values(words)) if (typeof value === 'string') assert.ok(value.length);
    assert.notEqual(words.serverReset, words.expectedResetPassed);
    for (const value of Object.values(words.states)) assert.ok(value.length);
  }
  assert.equal(subscriptionOverviewWords('zh-TW'), subscriptionOverviewWords('zh-hant'));
  assert.equal(subscriptionOverviewWords('unknown'), subscriptionOverviewWords('en'));
});
