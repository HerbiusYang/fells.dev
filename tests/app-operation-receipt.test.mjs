import test from 'node:test';
import assert from 'node:assert/strict';
import { api, APIError } from '../src/lib/app-http.ts';

const operation = '00000000-0000-4000-8000-000000000123';
async function respond(body, header, options = { method: 'POST', body: {}, idempotencyKey: 'private-client-operation' }) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(body, { headers: header === undefined ? {} : { 'X-Fells-Operation-ID': header } });
  try { return await api('/api/app/subscriptions/buy', options); }
  finally { globalThis.fetch = original; }
}
test('successful financial responses retain a valid server operation ID without changing business fields', async () => {
  const body = { ok: true, balance_micro: 123, subscription: { id: 9 } };
  assert.deepEqual(await respond(body, operation), { ...body, operation_id: operation });
  assert.deepEqual(body, { ok: true, balance_micro: 123, subscription: { id: 9 } });
  assert.deepEqual(await respond({ ...body, operation_id: operation }, operation), { ...body, operation_id: operation });
});
test('ordinary reads and malformed operation headers do not gain an operation identity', async () => {
  assert.deepEqual(await respond({ models: [] }, operation, {}), { models: [] });
  for (const value of ['not-a-uuid', 'client-secret-key', '00000000-0000-0000-0000-000000000000']) assert.deepEqual(await respond({ ok: true }, value), { ok: true });
  assert.deepEqual(await respond([{ id: 1 }], operation), [{ id: 1 }]);
});
test('conflicting server operation identities remain unresolved instead of silently acknowledging the wrong purchase', async () => {
  await assert.rejects(respond({ operation_id: '00000000-0000-4000-8000-000000000999' }, operation), error => error instanceof APIError && error.code === 'operation_identity_mismatch' && error.transactionRejected === false);
});
