import test from 'node:test';
import assert from 'node:assert/strict';
import { modelFormat, parseChatModels, conversationKey } from '../src/lib/model-chat.ts';

const model = { model: 'scope/text-model-v3', label: 'Server label', format: 'openai-responses', formats: ['openai-responses', 'openai-completions'] };
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
test('only active unexpired personal user keys are eligible for browser model calls', () => {
  const key = { id: 12, kind: 'user', revoked: false, expires_at: 0 };
  assert.equal(conversationKey(key, 100), true);
  assert.equal(conversationKey({ ...key, expires_at: 101 }, 100), true);
  for (const patch of [{ kind: 'cli' }, { kind: 'normal' }, { kind: undefined }, { revoked: true }, { expires_at: 99 }, { expires_at: undefined }, { id: 0 }]) assert.equal(conversationKey({ ...key, ...patch }, 100), false);
});
