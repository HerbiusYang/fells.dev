import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saveSupportIntent, readSupportIntent, clearSupportIntent, supportSignInHref } from '../src/lib/support-intent.ts';
import { clearSessionEntries, CUSTOMER_SESSION_ENTRIES, OPERATOR_SESSION_ENTRIES } from '../src/lib/session-entries.ts';

const key = 'fells.support.purchase.v1';
function browserStorage(t, pathname = '/app/') {
  const previous = { sessionStorage: globalThis.sessionStorage, location: globalThis.location };
  const values = new Map();
  globalThis.sessionStorage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => values.set(name, String(value)),
    removeItem: name => values.delete(name),
  };
  globalThis.location = { pathname };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
  });
  return values;
}

test('public purchase context saved while signed out follows the visitor through sign-in', t => {
  const values = browserStorage(t, '/zh/market/');
  saveSupportIntent({ title: 'Current Token', product: 'token_plan', amountMicro: 731000000, password: 'do-not-store' });
  assert.equal(JSON.parse(values.get(key)).userId, undefined);
  assert.equal('password' in JSON.parse(values.get(key)), false);
  assert.equal(readSupportIntent('7').title, 'Current Token');
});

test('only bounded public purchase fields are retained and sign-in returns to the localized support entry', t => {
  const values = browserStorage(t, '/es/market/');
  globalThis.location.origin = 'https://fells.test';
  const saved = saveSupportIntent({ title: 'T'.repeat(250), product: 'subscription', poolId: 3, amountMicro: 5, serviceDays: 30, months: 12, publicCode: 'plan-1.a:b' });
  assert.deepEqual({ ...saved, createdAt: 0 }, { source: '/es/market/', createdAt: 0, title: 'T'.repeat(200), product: 'subscription', publicCode: 'plan-1.a:b', serviceDays: 30, months: 12, poolId: 3, amountMicro: 5 });
  assert.deepEqual(JSON.parse(values.get(key)), saved);
  const rejected = saveSupportIntent({ title: 7, product: 'cdk', poolId: -1, amountMicro: 1.5, serviceDays: 0, months: 25, publicCode: 'bad code' });
  assert.deepEqual(Object.keys(rejected).sort(), ['createdAt', 'source']);
  assert.deepEqual(Object.keys(saveSupportIntent(null)).sort(), ['createdAt', 'source']);
  for (const [lang, prefix] of [['en', ''], ['zh-CN', '/zh'], ['zh-TW', '/zh-hant'], ['ja', '/ja']]) {
    assert.equal(supportSignInHref(lang), `${prefix}/app/start?next=${encodeURIComponent(`${prefix}/app/?support=1`)}`);
  }
});

test('signed-in purchase context is bound to its account and deleted for another account', t => {
  const values = browserStorage(t);
  saveSupportIntent({ title: 'Pending operation · op-synthetic-1', amountMicro: 1000000 }, '42');
  assert.equal(JSON.parse(values.get(key)).userId, '42');
  assert.equal(readSupportIntent('42').title, 'Pending operation · op-synthetic-1');
  assert.equal(readSupportIntent('7'), null);
  assert.equal(values.has(key), false, 'the next account cannot see the previous operation ID');
  assert.equal(readSupportIntent('42'), null);
});

test('the account page identity binds intents dispatched before the support session is verified', t => {
  const values = browserStorage(t);
  saveSupportIntent({ title: 'Pending operation · op-synthetic-2', userId: '42' });
  assert.equal(JSON.parse(values.get(key)).userId, '42');
  saveSupportIntent({ title: 'Numeric owner', userId: 42 });
  assert.equal(JSON.parse(values.get(key)).userId, '42');
  assert.equal(readSupportIntent('8'), null);
  for (const userId of ['0', '-1', 'abc', '1'.repeat(20), 1.5, {}]) {
    saveSupportIntent({ title: 'Malformed owner', userId });
    assert.equal(JSON.parse(values.get(key)).userId, undefined, String(userId));
  }
});

test('conflicting account identities store no purchase context', t => {
  const values = browserStorage(t);
  saveSupportIntent({ title: 'Earlier context' }, '42');
  saveSupportIntent({ title: 'Pending operation · op-synthetic-3', userId: '43' }, '42');
  assert.equal(values.has(key), false);
});

test('stored intents with a malformed owner, an expired time or a future time are deleted', t => {
  const values = browserStorage(t);
  for (const stored of [
    { title: 'x', source: '/app/', createdAt: Date.now(), userId: 'abc' },
    { title: 'x', source: '/app/', createdAt: Date.now(), userId: 42 },
    { title: 'x', source: '/app/', createdAt: Date.now() - 3_600_001 },
    { title: 'x', source: '/app/', createdAt: Date.now() + 60_000 },
  ]) {
    values.set(key, JSON.stringify(stored));
    assert.equal(readSupportIntent('42'), null);
    assert.equal(values.has(key), false);
  }
  values.set(key, '{not json');
  assert.equal(readSupportIntent('42'), null);
  assert.equal(values.has(key), false);
  saveSupportIntent({ title: 'x' }); clearSupportIntent(); assert.equal(values.has(key), false);
});

test('explicit sign-out entries remove only the matching per-account tab state', t => {
  const values = browserStorage(t);
  for (const name of ['fells.app.current.42', 'fells.app.current.7', key, 'fells.support.cash.v1:9:' + 'a'.repeat(64) + ':15', 'fells.chat.relogin-draft.v1', 'fells.exchange.v1:42:' + 'c'.repeat(64), 'fells.unrelated']) values.set(name, '1');
  clearSessionEntries(CUSTOMER_SESSION_ENTRIES);
  assert.deepEqual([...values.keys()].sort(), ['fells.chat.relogin-draft.v1', 'fells.exchange.v1:42:' + 'c'.repeat(64), 'fells.support.cash.v1:9:' + 'a'.repeat(64) + ':15', 'fells.unrelated']);
  clearSessionEntries(OPERATOR_SESSION_ENTRIES);
  assert.deepEqual([...values.keys()].sort(), ['fells.chat.relogin-draft.v1', 'fells.exchange.v1:42:' + 'c'.repeat(64), 'fells.unrelated']);
  delete globalThis.sessionStorage;
  assert.doesNotThrow(() => clearSessionEntries(CUSTOMER_SESSION_ENTRIES), 'blocked storage does not break sign-out');
});

test('customer and operator sign-out clear their tab entries; the widget binds intents to the verified customer', () => {
  const logout = readFileSync(new URL('../src/lib/customer-logout.ts', import.meta.url), 'utf8');
  assert.match(logout.slice(logout.indexOf('function notify('), logout.indexOf('function publish(')), /clearChatDraft\(\);[\s\S]*clearSessionEntries\(CUSTOMER_SESSION_ENTRIES\);/);
  const http = readFileSync(new URL('../src/lib/support-http.ts', import.meta.url), 'utf8');
  const endSession = http.slice(http.indexOf('    async endSupportSession(handle: string)'), http.indexOf('    async listSupportInbox('));
  assert.equal((endSession.match(/clearSessionEntries\(OPERATOR_SESSION_ENTRIES\);/g) ?? []).length, 2, 'both confirmed operator sign-out paths clear cash intents');
  assert.ok(endSession.indexOf('await revokeOperator(state)') < endSession.indexOf('clearSessionEntries'), 'only a confirmed revocation clears retained intents');
  const widget = readFileSync(new URL('../src/scripts/support-widget.ts', import.meta.url), 'utf8');
  assert.match(widget, /saveSupportIntent\(event\.detail, intentOwner\)/);
  assert.match(widget, /, intentOwner\);\n\s*pendingOpen = true;/);
  assert.match(widget, /readSupportIntent\(owner\)/);
  const app = readFileSync(new URL('../src/scripts/app.ts', import.meta.url), 'utf8');
  assert.match(app, /const requestSupport = [\s\S]{0,300}userId: String\(userId\)/);
});
