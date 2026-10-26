import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExchangeHistory } from '../src/lib/exchange-history.ts';
import { exchangeHistoryWordsOf } from '../src/i18n/exchange-history.ts';

const sourceURL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
const history = (days = 30) => ({
  days, source: 'ECB', source_url: sourceURL, as_of: '2026-10-23',
  fetched_at: '2026-10-24T00:00:00Z', fresh_until: '2026-10-25T00:00:00Z', stale: true, fee_bps: 10,
  points: [
    { date: '2026-10-21', reference_rate: '7.10000000', exchange_rate: '7.10710000' },
    { date: '2026-10-22', reference_rate: '7.20000000', exchange_rate: '7.20720000' },
    { date: '2026-10-23', reference_rate: '7.30000000', exchange_rate: '7.30730000' },
  ],
});

for (const days of [7, 30, 90]) test(`ECB ${days}-day history preserves publication dates and exact eight-decimal rates`, () => {
  const value = history(days);
  assert.deepEqual(parseExchangeHistory(value, days), value);
  if (days === 30) assert.deepEqual(parseExchangeHistory(value), value, 'default request range is 30 days');
});

test('the parser returns only public history fields and never private upstream or account metadata', () => {
  const value = history();
  const response = { ...value, provider_url: 'https://private.invalid', account_id: 123, secret: 'private-token',
    points: value.points.map(point => ({ ...point, upstream: 'private-provider', customer_id: 42 })) };
  assert.deepEqual(parseExchangeHistory(response), value);
  assert.equal(JSON.stringify(parseExchangeHistory(response)).includes('private'), false);
  assert.equal(Object.hasOwn(response.points[0], 'upstream'), true, 'sanitizing a response does not mutate its source');
});

test('calendar validation accepts a real leap day and a single published point', () => {
  const value = { ...history(7), as_of: '2024-02-29', fetched_at: '2024-03-01T00:00:00Z', fresh_until: '2024-03-02T00:00:00Z',
    points: [{ date: '2024-02-29', reference_rate: '7.20000000', exchange_rate: '7.20720000' }] };
  assert.deepEqual(parseExchangeHistory(value, 7), value);
});

test('freshness is explicit data, and fixed-point rate validation tolerates independent eight-place rounding', () => {
  const value = history();
  value.stale = false;
  value.points[1] = { ...value.points[1], reference_rate: '7.12345678', exchange_rate: '7.13058024' };
  assert.deepEqual(parseExchangeHistory(value), value);
  value.points[1] = { ...value.points[1], reference_rate: '7.20000000', exchange_rate: '7.20720002' };
  assert.deepEqual(parseExchangeHistory(value), value, 'two scaled rounding units remain within the declared 2001/1000 tolerance');
  value.points[1].exchange_rate = '7.20720003';
  assert.throws(() => parseExchangeHistory(value), 'a larger discrepancy cannot be presented as the fixed 10bp exchange rate');
});

const invalidHeaders = [
  ['wrong publisher', { source: 'manual' }], ['wrong source URL', { source_url: 'https://private.invalid/rates.xml' }],
  ['insecure source URL', { source_url: sourceURL.replace('https:', 'http:') }],
  ['source query injection', { source_url: sourceURL + '?secret=private' }],
  ['wrong fee', { fee_bps: 11 }], ['string fee', { fee_bps: '10' }],
  ['unsupported range', { days: 8 }], ['string range', { days: '30' }], ['missing range', { days: undefined }],
  ['nonboolean stale', { stale: 'true' }], ['missing stale', { stale: undefined }],
  ['invalid reference date', { as_of: '2026-02-29' }], ['nonnormalized reference date', { as_of: '2026-1-2' }],
  ['invalid fetched time', { fetched_at: 'not-a-time' }], ['fetched time without zone', { fetched_at: '2026-10-24T00:00:00' }],
  ['nonstring fetched time', { fetched_at: null }], ['overlong fetched precision', { fetched_at: '2026-10-24T00:00:00.' + '0'.repeat(49) + 'Z' }],
  ['date-only fetched time', { fetched_at: '2026-10-24' }], ['invalid fresh time', { fresh_until: '2026-10-99T00:00:00Z' }],
  ['fresh time without zone', { fresh_until: '2026-10-25T00:00:00' }],
  ['missing points', { points: undefined }], ['null points', { points: null }], ['object points', { points: {} }], ['empty points', { points: [] }],
];
for (const [reason, patch] of invalidHeaders) test(`exchange history rejects ${reason}`, () => {
  assert.throws(() => parseExchangeHistory({ ...history(), ...patch }), reason);
});

test('request range and response range cannot be silently exchanged', () => {
  for (const days of [0, 8, '30', NaN, null]) assert.throws(() => parseExchangeHistory(history(), days));
  assert.throws(() => parseExchangeHistory(history(7), 30));
  const value = history(7);
  value.points = Array.from({ length: 8 }, (_, index) => ({ date: `2026-10-${String(16 + index).padStart(2, '0')}`, reference_rate: '7.20000000', exchange_rate: '7.20720000' }));
  assert.throws(() => parseExchangeHistory(value, 7), 'point count cannot exceed the requested calendar window');
});

for (const invalid of [null, undefined, [], 'history', 42, true]) test(`exchange history rejects nonobject response ${String(invalid)}`, () => {
  assert.throws(() => parseExchangeHistory(invalid));
});

const invalidPoints = [
  ['null point', null], ['array point', []], ['string point', '2026-10-22'],
  ['nonexistent calendar date', { date: '2026-04-31' }], ['invalid leap date', { date: '2025-02-29' }],
  ['date with time', { date: '2026-10-22T00:00:00Z' }], ['date with whitespace', { date: ' 2026-10-22' }],
  ['zero reference', { reference_rate: '0.00000000' }], ['negative reference', { reference_rate: '-7.20000000' }],
  ['numeric reference', { reference_rate: 7.2 }], ['short reference precision', { reference_rate: '7.2' }],
  ['excess reference precision', { reference_rate: '7.200000000' }], ['exponent reference', { reference_rate: '7.2e0' }],
  ['infinite reference', { reference_rate: 'Infinity' }], ['huge reference', { reference_rate: '100000000000.00000000' }],
  ['zero exchange rate', { exchange_rate: '0.00000000' }], ['negative exchange rate', { exchange_rate: '-7.20720000' }],
  ['numeric exchange rate', { exchange_rate: 7.2072 }], ['short exchange precision', { exchange_rate: '7.2072' }],
  ['huge exchange rate', { exchange_rate: '100000000000.00000000' }], ['wrong fee arithmetic', { exchange_rate: '7.30720000' }],
];
for (const [reason, patch] of invalidPoints) test(`exchange history rejects ${reason}`, () => {
  const value = history();
  value.points[1] = patch === null || typeof patch !== 'object' || Array.isArray(patch) ? patch : { ...value.points[1], ...patch };
  assert.throws(() => parseExchangeHistory(value), reason);
});

test('published points must be unique, increasing, and end at the declared as_of date', () => {
  for (const change of [
    value => { value.points.reverse(); },
    value => { value.points[1].date = value.points[0].date; },
    value => { value.points[1].date = '2026-10-27'; },
    value => { value.as_of = '2026-10-26'; },
  ]) {
    const value = history(); change(value);
    assert.throws(() => parseExchangeHistory(value));
  }
});

test('all six history locales retain source, fee arithmetic, stale and retry guidance with a safe fallback', () => {
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) {
    const words = exchangeHistoryWordsOf(language);
    assert.ok(Object.values(words).every(value => typeof value === 'string' && value.length > 0), language);
    assert.match(words.note, /1\.001/);
    assert.ok(words.reference.includes(language === 'es' ? 'BCE' : 'ECB'));
    assert.match(words.days, /\{n\}/);
    for (const name of ['title', 'exchange', 'published', 'updated', 'stale', 'error', 'details', 'refresh']) assert.ok(words[name]);
  }
  assert.deepEqual(exchangeHistoryWordsOf('unknown-locale'), exchangeHistoryWordsOf('en'));
});
