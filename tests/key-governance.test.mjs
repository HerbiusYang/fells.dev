import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const load = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`);
const { readKeyGovernance, parseGovernanceDraft, governancePatch, governanceUnchanged, governanceSaveResult, renderGovernanceReview, renderGovernanceFields } = await load('../src/lib/key-governance.ts');
const { keyGovernanceWords } = await load('../src/i18n/key-governance.ts');
const now = Date.parse('2026-11-01T12:00:00Z');
const key = { id: 17, quota_limit_micros: 25_000_001, used_quota_micros: 1_234_567, expires_at: 0, allowed_models: ['model/*'], allowed_cidrs: ['192.0.2.0/24'], allow_wallet_fallback: false };
const initial = readKeyGovernance(key);
const draft = () => ({ quota: '25.000001', expiry: '', models: 'model/*', cidrs: '192.0.2.0/24' });
const renderedExpiry = value => {
  const field = /name="governance_expiry"[^>]*value="([^"]*)"/.exec(renderGovernanceFields(value, keyGovernanceWords('en')));
  assert.ok(field, 'the public form contains an expiry input');
  return field[1];
};

test('governance uses the actual server counter and distinguishes missing scalars from zero', () => {
  assert.equal(readKeyGovernance({ ...key, quota_limit_micros: 0, used_quota_micros: 0 }).used_quota_micros, 0);
  for (const change of [{ id: 0 }, { quota_limit_micros: undefined }, { used_quota_micros: undefined }, { used_quota_micros: '0' }, { used_quota_micros: -1 }, { used_quota_micros: Infinity }, { expires_at: null }, { revoked: true }, { allowed_models: null }, { allowed_cidrs: [1] }]) assert.throws(() => readKeyGovernance({ ...key, ...change }), /unavailable/);
  assert.deepEqual(readKeyGovernance({ ...key, allowed_models: undefined }).allowed_models, [], 'Go omitempty lists are unrestricted; malformed explicit lists are rejected');
  assert.match(renderGovernanceFields(initial, keyGovernanceWords('en')), /name="governance_quota"[^>]*value="25\.000001"/);
});

test('editable self rules never inherit operator projection after clearing or extend its earlier deadline', () => {
  const operator = { ...key, expires_at: Math.floor(now / 1000) + 3600, allowed_models: ['operator/*'], allowed_cidrs: ['203.0.113.0/24'] };
  const own = { key_id: key.id, quota_limit_micros: 0, used_quota_micros: 0, expires_at: Math.floor(now / 1000) + 86400, allowed_models: ['self/*'], allowed_cidrs: ['192.0.2.1'] };
  const snapshot = readKeyGovernance({ ...operator, self_governance: own });
  assert.equal(snapshot.expires_at, own.expires_at); assert.deepEqual(snapshot.allowed_models, ['self/*']);
  const cleared = readKeyGovernance({ ...operator, self_governance: { ...own, expires_at: 0, allowed_models: [], allowed_cidrs: [] } });
  assert.equal(cleared.quota_limit_micros, 0); assert.equal(cleared.expires_at, 0);
  assert.deepEqual(cleared.allowed_models, []); assert.deepEqual(cleared.allowed_cidrs, []);
  assert.equal(governanceSaveResult(cleared, cleared, { quota_limit_micros: 0, expires_at: 0, allowed_models: [], allowed_cidrs: [] }), 'applied');
  assert.equal(operator.expires_at, Math.floor(now / 1000) + 3600, 'rendering does not modify the operator deadline');
  for (const self_governance of [null, undefined, { ...own, key_id: 18 }, { ...own, allowed_models: null }, { ...own, allowed_cidrs: null }, { ...own, allowed_models: undefined }]) assert.throws(() => readKeyGovernance({ ...operator, self_governance }), /unavailable/);
  assert.equal(readKeyGovernance(operator).expires_at, operator.expires_at, 'only missing the entire nested field keeps legacy compatibility');
});

test('total caps retain all micro units and reject overflow or lossy decimal notation', () => {
  for (const [quota, expected] of [['0', 0], ['', 0], ['0.000001', 1], ['25.000001', 25_000_001], ['9007199254.740991', Number.MAX_SAFE_INTEGER]]) assert.equal(parseGovernanceDraft({ ...draft(), quota }, now).quota_limit_micros, expected);
  for (const quota of ['-1', 'Infinity', 'NaN', '1e6', '0.0000001', '9007199254.740992', '1,000', '.5']) assert.throws(() => parseGovernanceDraft({ ...draft(), quota }, now), /quota/);
});

test('expiry round-trips local seconds, supports explicit clearing and rejects normalized invalid dates', () => {
  const future = { ...initial, expires_at: Math.floor(now / 1000) + 86400 };
  assert.equal(parseGovernanceDraft({ ...draft(), expiry: renderedExpiry(future) }, now).expires_at, future.expires_at);
  assert.equal(parseGovernanceDraft({ ...draft(), expiry: '' }, now).expires_at, 0);
  for (const expiry of ['bad', '2030-02-30T12:00:00', '2020-01-01T00:00:00']) assert.throws(() => parseGovernanceDraft({ ...draft(), expiry }, now), /expiry/);
  const expired = { ...initial, expires_at: Math.floor(now / 1000) - 86400 };
  assert.equal(parseGovernanceDraft({ ...draft(), expiry: renderedExpiry(expired) }, now, expired).expires_at, expired.expires_at, 'editing another field cannot silently extend an old expiry');
});

test('atomic creation and changed-field updates never send a wallet fallback setting', () => {
  assert.deepEqual(governancePatch(parseGovernanceDraft({ quota: '', expiry: '', models: '', cidrs: '' }, now)), {});
  const values = parseGovernanceDraft({ ...draft(), models: 'model/*\nother/model\nmodel/*', cidrs: '192.0.2.0/24, 2001:db8::/32' }, now, initial);
  const patch = governancePatch(values, initial);
  assert.deepEqual(patch, { allowed_models: ['model/*', 'other/model'], allowed_cidrs: ['192.0.2.0/24', '2001:db8::/32'] });
  assert.equal(Object.hasOwn(patch, 'allow_wallet_fallback'), false);
  assert.deepEqual(governancePatch(parseGovernanceDraft({ ...draft(), models: '', cidrs: '' }, now, initial), initial), { allowed_models: [], allowed_cidrs: [] });
});

test('a preflight conflict blocks overwriting edited fields; changing usage alone is not a policy conflict', () => {
  const patch = { quota_limit_micros: 30_000_000 };
  assert.equal(governanceUnchanged({ ...initial, used_quota_micros: 9_000_000 }, initial, patch), true);
  assert.equal(governanceUnchanged({ ...initial, quota_limit_micros: 40_000_000 }, initial, patch), false);
  assert.equal(governanceUnchanged({ ...initial, allowed_cidrs: ['203.0.113.1'] }, initial, patch), true, 'an untouched field is omitted from PATCH');
  assert.throws(() => governanceSaveResult(initial, initial, patch), /unavailable/, 'HTTP success alone cannot prove an ignored threshold was stored');
  const recorded = { ...initial, quota_limit_micros: 30_000_000 };
  assert.equal(governanceSaveResult(recorded, recorded, patch), 'applied');
});

test('forms escape server rules and expose no CNY fallback or simulated diagnostic control', () => {
  const html = renderGovernanceFields({ ...initial, allowed_models: ['</textarea><script>alert(1)</script>'] }, keyGovernanceWords('en'));
  assert.match(html, /1\.234567/); assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|allow_wallet_fallback|CNY|dry.run|connectivity/);
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) for (const value of Object.values(keyGovernanceWords(locale))) assert.ok(typeof value === 'string' && value.length);
});


test('IP text changes require explicit review, not a client claim of network equivalence', () => {
  for (const [raw, stored] of [
    ['203.0.113.9/24', '203.0.113.0/24'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001/64', '2001:db8::/64'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
  ]) {
    const recorded = { ...initial, allowed_cidrs: [stored] };
    assert.equal(governanceSaveResult(recorded, recorded, { allowed_cidrs: [raw] }), 'review');
    assert.equal(governanceSaveResult(recorded, recorded, { allowed_cidrs: [stored] }), 'applied');
  }
  assert.equal(governanceSaveResult(initial, initial, { allowed_cidrs: ['203.0.113.0/24'] }), 'review', 'an ignored CIDR write is a difference to inspect, never automatic success');
});

test('save receipt and fresh policy read must agree while unrelated billing counters may advance', () => {
  const receipt = { ...initial, allowed_cidrs: ['203.0.113.0/24'] }, patch = { allowed_cidrs: ['203.0.113.9/24'] };
  assert.equal(governanceSaveResult(receipt, { ...receipt, used_quota_micros: 9_000_000 }, patch), 'review');
  for (const change of [{ id: 18 }, { quota_limit_micros: 0 }, { expires_at: 1 }, { allowed_models: [] }, { allowed_cidrs: ['203.0.114.0/24'] }]) assert.throws(() => governanceSaveResult(receipt, { ...receipt, ...change }, patch), /unavailable/);
  for (const changedIntent of [{ quota_limit_micros: 50_000_000 }, { expires_at: 1 }, { allowed_models: ['other/*'] }]) assert.throws(() => governanceSaveResult(receipt, receipt, { ...patch, ...changedIntent }), /unavailable/);
});

test('review renders both literal rule lists safely and offers no automatic write control', () => {
  const html = renderGovernanceReview('</pre><img src=x onerror=alert(1)>', { ...initial, allowed_cidrs: ['</pre><script>alert(1)</script>'] }, keyGovernanceWords('en'));
  assert.match(html, /&lt;\/pre&gt;&lt;img/); assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img|<script|<form|type="submit"/);
  assert.match(html, /data-act="key-governance-use-recorded"/);
  assert.match(renderGovernanceReview('203.0.113.0/24', { ...initial, allowed_cidrs: [] }, keyGovernanceWords('en')), /No key-specific IP restriction/);
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) {
    const words = keyGovernanceWords(locale);
    for (const name of ['noIPRestriction', 'reviewTitle', 'reviewHint', 'submittedCIDRs', 'recordedCIDRs', 'reviewUseRecorded', 'reviewClose', 'reviewNoResend']) assert.ok(words[name].length);
  }
});

test('USD threshold copy describes net charges and accepted in-flight overrun without promising a hard cap', () => {
  const words = keyGovernanceWords('en');
  assert.match(words.quota, /threshold.*USD/); assert.match(words.netUsed, /actual charges|actual.*charges/);
  for (const phrase of ['inherited usage', 'from when', 'Subscription-covered usage counts as 0', 'refunds reduce', 'new requests', 'already accepted requests may finish above']) assert.ok(words.quotaHint.includes(phrase));
  assert.doesNotMatch(words.quota + words.quotaHint, /hard.?cap|never exceed/i);
});

test('meter metadata never invents missing zero, accepts real zero and rejects invalid or contradictory parts', () => {
  const own = { key_id: 17, quota_limit_micros: 25_000_001, used_quota_micros: 1_234_567, expires_at: 0, allowed_models: [], allowed_cidrs: [] };
  const read = fields => readKeyGovernance({ ...key, self_governance: { ...own, ...fields } }, now);
  const unknown = read({});
  assert.equal(unknown.used_quota_micros, 1_234_567);
  for (const name of ['net_used_quota_micros', 'inherited_used_quota_micros', 'metering_started_at']) assert.equal(unknown[name], null);
  for (const invalid of [null, '0', NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(read({ net_used_quota_micros: invalid }).net_used_quota_micros, null);
    assert.equal(read({ inherited_used_quota_micros: invalid }).inherited_used_quota_micros, null);
  }
  const inconsistent = read({ net_used_quota_micros: 1_000_000, inherited_used_quota_micros: 500_000 });
  assert.equal(inconsistent.net_used_quota_micros, null); assert.equal(inconsistent.inherited_used_quota_micros, null);
  const zero = read({ used_quota_micros: 0, net_used_quota_micros: 0, inherited_used_quota_micros: 0, metering_started_at: 1_700_000_000 });
  assert.equal(zero.net_used_quota_micros, 0); assert.equal(zero.inherited_used_quota_micros, 0);
  assert.equal(zero.metering_started_at, 1_700_000_000);
  for (const started of [0, -1, '1700000000', Math.floor(now / 1000) + 1, Infinity]) assert.equal(read({ metering_started_at: started }).metering_started_at, null);
});

test('transferred budget use is separate from current-owner charges and retains the real metering start', () => {
  const value = readKeyGovernance({ ...key, self_governance: { key_id: 17, quota_limit_micros: 25_000_001, used_quota_micros: 3_000_000, net_used_quota_micros: 1_000_000, inherited_used_quota_micros: 2_000_000, metering_started_at: 1_700_000_000, expires_at: 0, allowed_models: [], allowed_cidrs: [], meter_id: 'INTERNAL_METER_MUST_NOT_RENDER' } }, now);
  const html = renderGovernanceFields(value, keyGovernanceWords('en'));
  assert.match(html, /Recorded total budget usage \(USD\): 3/);
  assert.match(html, /net actual charges \(USD\): 1/);
  assert.match(html, /Inherited budget usage \(USD\): 2/);
  assert.match(html, /does not mean the current owner was charged again/);
  assert.match(html, /Metering started at/); assert.doesNotMatch(html, /INTERNAL_METER/);
  const legacy = renderGovernanceFields(initial, keyGovernanceWords('en'));
  assert.match(legacy, /Recorded total budget usage \(USD\): 1\.234567/);
  assert.match(legacy, /net actual charges \(USD\): Unknown/);
});
