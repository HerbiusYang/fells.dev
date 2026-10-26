import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFormat, parseChatModels, conversationKey } from '../src/lib/model-chat.ts';

const model = { model: 'scope/text-model-v3', label: 'Server label', format: 'openai-responses', formats: ['openai-responses', 'openai-completions'] };
const diagnosis = (reason = 'claude_code_only', web = 0) => ({ reason, counts: { visible_models: 2, priced_models: 2, permitted_models: 2, web_models: web, claude_code_only_models: 2, unsupported_provider_models: 0, no_route_models: 0 } });
test('account catalogs preserve controlled availability reasons without exposing provider details', () => {
  for (const reason of ['no_visible_models', 'pricing_unavailable', 'model_restricted', 'claude_code_only', 'browser_provider_unsupported', 'no_compatible_routes']) {
    const catalog = { capability: 'model_chat', billing_mode: 'account_allowance', models: [], diagnostics: diagnosis(reason) };
    assert.deepEqual(parseChatModels(catalog), catalog);
  }
  const catalog = { capability: 'model_chat', billing_mode: 'account_allowance', models: [model], diagnostics: diagnosis('available', 1) };
  assert.deepEqual(parseChatModels(catalog), catalog);
  const sanitized = parseChatModels({ ...catalog, diagnostics: { ...catalog.diagnostics, provider_url: 'https://private.test', counts: { ...catalog.diagnostics.counts, secret: 'not public' } } });
  assert.deepEqual(sanitized, catalog, 'only documented diagnosis fields enter the application');
});
for (const diagnostics of [null, {}, { reason: 'invented', counts: diagnosis().counts }, { reason: 'claude_code_only', counts: null },
  diagnosis('available'), diagnosis('claude_code_only', 1), { ...diagnosis(), counts: { ...diagnosis().counts, visible_models: -1 } },
  { ...diagnosis(), counts: { ...diagnosis().counts, priced_models: 1.5 } }, { ...diagnosis(), counts: { ...diagnosis().counts, permitted_models: '2' } }]) {
  test('malformed or contradictory availability evidence fails closed: ' + JSON.stringify(diagnostics), () => {
    assert.throws(() => parseChatModels({ capability: 'model_chat', billing_mode: 'account_allowance', models: [], diagnostics }));
  });
}
test('account conversation catalogs bind account allowance without selecting a personal key', () => {
  const catalog = { capability: 'model_chat', billing_mode: 'account_allowance', models: [model] };
  assert.deepEqual(parseChatModels(catalog), catalog);
  assert.deepEqual(parseChatModels({ ...catalog, key_id: 0 }), catalog, 'the backend zero sentinel is normalized away');
  assert.equal(Object.hasOwn(parseChatModels(catalog), 'key_id'), false);
  assert.equal(parseChatModels({ ...catalog, models: [{ ...model, label: undefined }] }).models[0].label, model.model);
  assert.deepEqual(parseChatModels({ ...catalog, models: [] }).models, []);
});
for (const invalid of [null, {}, { capability: 'model_chat', models: [] },
  { capability: 'model_chat', billing_mode: 'key', models: [model] },
  { capability: 'model_chat', billing_mode: 'account_allowance', key_id: 12, models: [model] },
  { capability: 'model_chat', billing_mode: 'account_allowance', key_id: -1, models: [model] },
  { capability: 'model_chat', billing_mode: 'account_allowance', key_id: '0', models: [model] },
  { capability: 'model_chat', billing_mode: 'account_allowance', models: [model, model] },
  { capability: 'model_chat', billing_mode: 'account_allowance', models: [{ ...model, model: 'bad\nmodel' }] },
  { capability: 'model_chat', billing_mode: 'account_allowance', models: [{ ...model, format: 'embeddings', formats: ['embeddings'] }] }]) {
  test('account conversations reject an unbound, key-scoped or invalid catalog: ' + JSON.stringify(invalid), () => assert.throws(() => parseChatModels(invalid)));
}
test('conversation catalog preserves canonical IDs and binds the chosen existing key', () => {
  assert.deepEqual(parseChatModels({ capability: 'model_chat', key_id: 12, models: [model] }, 12), { capability: 'model_chat', key_id: 12, models: [model] });
  assert.equal(parseChatModels({ capability: 'model_chat', key_id: 12, models: [{ ...model, label: undefined }] }, 12).models[0].label, model.model);
  assert.deepEqual(parseChatModels({ capability: 'model_chat', key_id: 12, models: [] }, 12).models, []);
});
for (const invalid of [null, {}, { capability: 'agent_execution', key_id: 12, models: [] }, { capability: 'model_chat', key_id: 99, models: [model] },
  { capability: 'model_chat', key_id: 12, models: [model, model] }, { capability: 'model_chat', key_id: 12, models: [{ ...model, model: '' }] },
  { capability: 'model_chat', key_id: 12, models: [{ ...model, model: 'bad\nmodel' }] }, { capability: 'model_chat', key_id: 12, models: [{ ...model, formats: ['embeddings'], format: 'embeddings' }] },
  { capability: 'model_chat', key_id: 12, models: [{ ...model, formats: ['openai-completions'] }] }, { capability: 'model_chat', key_id: 12, models: [{ ...model, label: 123 }] }]) {
  test('untrusted or incompatible conversation catalogs fail closed: ' + JSON.stringify(invalid), () => assert.throws(() => parseChatModels(invalid, 12)));
}
test('format choice supports actual routes without inventing OpenAI support', () => {
  assert.equal(modelFormat({ example_format: 'anthropic-messages', formats: ['openai-completions'] }), 'openai-completions');
  assert.equal(modelFormat({ format: 'anthropic-messages', example_format: 'openai-responses', formats: ['openai-completions'] }), 'openai-completions');
  assert.equal(modelFormat({ format: 'openai-responses', formats: ['openai-completions', 'openai-responses'] }), 'openai-responses');
  assert.equal(modelFormat({ formats: ['embeddings', 'openai-responses'] }), 'openai-responses');
  assert.equal(modelFormat({ example_format: 'anthropic-messages', formats: ['openai-completions'] }, ['openai-completions', 'openai-responses']), 'openai-completions');
  assert.equal(modelFormat({ formats: ['embeddings'] }), undefined);
  assert.equal(modelFormat({ example_format: 'anthropic-messages', formats: [] }), undefined);
  assert.equal(modelFormat({ example_format: 'anthropic-messages', formats: null }), undefined);
  assert.equal(modelFormat({ example_format: 'anthropic-messages' }), 'anthropic-messages');
});
test('client-specific formats keep native Claude relay separate from ordinary API access', () => {
  const native = { example_format: 'anthropic-messages', formats: ['anthropic-messages'], client_formats: { api: [], claude_code: ['anthropic-messages'] } };
  assert.equal(modelFormat(native, undefined, 'api'), undefined);
  assert.equal(modelFormat(native, undefined, 'claude_code'), 'anthropic-messages');
  const commercial = { ...native, client_formats: { api: ['anthropic-messages'], claude_code: ['anthropic-messages'] } };
  assert.equal(modelFormat(commercial, undefined, 'api'), 'anthropic-messages');
  assert.equal(modelFormat({ formats: ['openai-responses'] }, undefined, 'api'), 'openai-responses', 'older catalogs retain their advertised formats');
  assert.equal(modelFormat({ formats: ['openai-responses'], client_formats: { api: ['anthropic-messages'] } }, undefined, 'api'), undefined, 'client capabilities cannot invent another wire format');
  for (const client_formats of [null, [], {}, { api: 'anthropic-messages' }]) assert.equal(modelFormat({ ...native, client_formats }, undefined, 'api'), undefined);
});
test('only active unexpired personal user keys are eligible for browser model calls', () => {
  const key = { id: 12, kind: 'user', revoked: false, expires_at: 0 };
  assert.equal(conversationKey(key, 100), true);
  assert.equal(conversationKey({ ...key, expires_at: 101 }, 100), true);
  for (const patch of [{ kind: 'cli' }, { kind: 'normal' }, { kind: undefined }, { revoked: true }, { expires_at: 99 }, { expires_at: undefined }, { id: 0 }]) assert.equal(conversationKey({ ...key, ...patch }, 100), false);
});
