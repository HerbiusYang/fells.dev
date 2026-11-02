import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const load = async path => import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText).toString('base64')}`);
const { parseSpendGrant, spendGrantCanRequest, spendGrantAccepted, renderSpendGrant } = await load('../src/lib/spend-grant.ts');
const { spendGrantWords } = await load('../src/i18n/spend-grant.ts');
const now = Date.parse('2026-11-01T12:00:00Z'), seconds = now / 1000;
const reply = patch => ({ ok: true, pool_id: 81, spend_grant: { known: true, observed_at: seconds - 20, eligible: true, resets_remaining_known: true, resets_remaining: 2, reset_available: true, reset_state: 'ready', reset_block_reason: '', ...patch } });
const parse = patch => parseSpendGrant(reply(patch), 81, now);

test('the explicit owned pool must match the response; legacy account defaults cannot qualify', () => {
  for (const value of [null, {}, { ok: true, spend_grant: { account_name: 'internal' } }, { ...reply({}), pool_id: 82 }]) assert.throws(() => parseSpendGrant(value, 81, now), /unavailable/);
  for (const pool of [0, -1, 1.5, NaN]) assert.throws(() => parseSpendGrant(reply({}), pool, now), /unavailable/);
});

test('cache absence, explicit false and known zero are never promoted to eligibility', () => {
  assert.equal(spendGrantCanRequest(parse({}), now), true);
  for (const patch of [{ known: false }, { known: undefined }, { observed_at: 0 }, { observed_at: undefined }, { observed_at: seconds + 1 }, { eligible: false }, { eligible: undefined }, { eligible: 'true' }, { resets_remaining: 0 }, { resets_remaining: -1 }, { resets_remaining: '1' }]) assert.equal(spendGrantCanRequest(parse(patch), now), false, JSON.stringify(patch));
  const unknownCount = parse({ resets_remaining_known: false, resets_remaining: 0 });
  assert.equal(unknownCount.remaining, null); assert.equal(spendGrantCanRequest(unknownCount, now), true);
});

test('a recorded observation has no invented TTL, but expiry must be an actual valid server timestamp', () => {
  assert.equal(spendGrantCanRequest(parse({ observed_at: seconds - 86400 * 30 }), now), true, 'old records remain labelled as records, not asserted fresh');
  assert.equal(spendGrantCanRequest(parse({ expires_at: '2026-10-31T12:00:00Z' }), now), false);
  assert.equal(spendGrantCanRequest(parse({ expires_at: '2026-11-02T12:00:00Z' }), now), true);
  for (const expires_at of ['bad', '0', '2030-02-30T12:00:00Z', null, 1900000000]) assert.equal(spendGrantCanRequest(parse({ expires_at }), now), false);
});

test('only this POST receipt can confirm upstream acceptance; eligibility is a separate observation', () => {
  assert.equal(spendGrantAccepted(parse({})), false);
  const accepted = { reset_available: false, reset_state: 'accepted', reset_block_reason: 'accepted', known: false, eligible: false, upstream_status: 204, cooldown_cleared: true, last_reset_at: seconds };
  assert.equal(spendGrantAccepted(parse(accepted)), true); assert.equal(spendGrantCanRequest(parse(accepted), now), false);
  for (const patch of [{ upstream_status: 500 }, { upstream_status: 300 }, { cooldown_cleared: false }, { last_reset_at: 0 }]) assert.equal(spendGrantAccepted(parse({ ...accepted, ...patch })), false);
});

test('unknown counts and unconfirmed outcomes stay explicit and a pending attempt cannot be repeated', () => {
  const state = parse({ resets_remaining_known: false, resets_remaining: 0, account_name: 'SECRET_INTERNAL_ACCOUNT', org_uuid: 'SECRET_ORG' });
  const html = renderSpendGrant(state, spendGrantWords('en'), { now, formatTime: () => '<time>', attempted: true, accepted: false, error: '<unconfirmed>' });
  assert.match(html, /Recorded resets remaining: Unknown/); assert.match(html, /data-act="spend-grant-reset" disabled/);
  assert.match(html, /&lt;unconfirmed&gt;/); assert.match(html, /&lt;time&gt;/);
  assert.doesNotMatch(html, /SECRET_INTERNAL_ACCOUNT|SECRET_ORG|healthy|0%|CNY|grant_id/);
});

test('all locales explain shared-account effects and distinguish acceptance from local health', () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) for (const value of Object.values(spendGrantWords(locale))) assert.ok(typeof value === 'string' && value.length);
  assert.match(spendGrantWords('en').confirm, /other people sharing/);
  assert.match(spendGrantWords('en').unconfirmed, /not retried automatically/);
});


test('only a complete known ready contract permits a request; old eligibility and counts cannot substitute', () => {
  for (const patch of [
    { reset_available: undefined }, { reset_available: false }, { reset_available: 'true' },
    { reset_state: undefined }, { reset_state: 'future_state' }, { reset_state: 'sending' },
    { reset_block_reason: undefined }, { reset_block_reason: 'future_reason' }, { reset_block_reason: 'accepted' },
  ]) assert.equal(spendGrantCanRequest(parse(patch), now), false, JSON.stringify(patch));
  assert.equal(spendGrantCanRequest(parse({}), now), true);
  for (const state of ['sending', 'unknown', 'accepted', 'refused']) {
    const value = parse({ reset_available: false, reset_state: state, reset_block_reason: state });
    assert.equal(value.resetContractKnown, true);
    assert.equal(spendGrantCanRequest(value, now), false);
    assert.equal(spendGrantCanRequest({ ...value, remaining: 999 }, now + 86400 * 1000), false);
  }
  for (const reason of ['identity_incomplete', 'qualification_unknown', 'not_eligible', 'transport_unavailable', 'storage_unavailable']) assert.equal(spendGrantCanRequest(parse({ reset_available: false, reset_state: 'read_only', reset_block_reason: reason }), now), false);
});

test('reset state and blocking reason are displayed without revealing provider identity or promising a running request', () => {
  const render = patch => renderSpendGrant(parse(patch), spendGrantWords('en'), { now, formatTime: () => 'recorded-time', attempted: false, accepted: false, error: '' });
  assert.match(render({ reset_available: false, reset_state: 'sending', reset_block_reason: 'sending' }), /registered but no result is confirmed/);
  assert.match(render({ reset_available: false, reset_state: 'unknown', reset_block_reason: 'unknown' }), /refreshing does not release/);
  for (const state of ['accepted', 'refused']) assert.match(render({ reset_available: false, reset_state: state, reset_block_reason: state }), /remaining-count change does not authorize/);
  const missing = render({ reset_available: undefined, reset_state: '<img src=x>', reset_block_reason: '<script>', grant_id: 'SECRET_GRANT', org_uuid: 'SECRET_ORG' });
  assert.match(missing, /View only/); assert.doesNotMatch(missing, /<img|<script|SECRET_/);
});
