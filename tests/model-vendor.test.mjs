import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupByVendor, modelVendor, vendorFamily, ownMark } from '../src/lib/model-vendor.ts';
import { parseChatModels } from '../src/lib/model-chat.ts';

test('the directory vendor wins and an id prefix only fills a missing vendor', () => {
  assert.equal(modelVendor({ model: 'claude-like-relay', vendor: 'OpenAI' }), 'OpenAI');
  assert.equal(modelVendor({ model: 'claude-opus-5-5' }), 'Anthropic');
  assert.equal(modelVendor({ model: 'GPT-5.5-codex' }), 'OpenAI');
  assert.equal(modelVendor({ model: 'o4-mini' }), 'OpenAI');
  assert.equal(modelVendor({ model: 'gemini-3-pro' }), 'Google');
  assert.equal(modelVendor({ model: 'server/model-1' }), '');
  assert.equal(vendorFamily('Anthropic'), 'Claude');
  assert.equal(vendorFamily('OpenAI'), 'ChatGPT');
  assert.equal(vendorFamily('DeepSeek'), 'DeepSeek');
});

test('Claude, ChatGPT and Gemini lead, unknown models come last, order within a group is kept', () => {
  const models = [
    { model: 'server/model-1' }, { model: 'deepseek-v4' }, { model: 'gpt-5.5' }, { model: 'claude-sonnet-5-5' },
    { model: 'gemini-3-pro' }, { model: 'claude-fable-5' }, { model: 'gpt-5.4-mini' }, { model: 'acme-1', vendor: 'Acme' },
  ];
  assert.deepEqual(groupByVendor(models).map(g => [g.vendor, g.models.map(m => m.model)]), [
    ['Anthropic', ['claude-sonnet-5-5', 'claude-fable-5']],
    ['OpenAI', ['gpt-5.5', 'gpt-5.4-mini']],
    ['Google', ['gemini-3-pro']],
    ['Acme', ['acme-1']],
    ['DeepSeek', ['deepseek-v4']],
    ['', ['server/model-1']],
  ]);
});

test('the chat directory keeps a valid vendor and refuses a malformed one', () => {
  const model = { model: 'gpt-5.5', label: 'GPT-5.5', format: 'openai-responses', formats: ['openai-responses'] };
  const catalog = models => ({ capability: 'model_chat', billing_mode: 'account_allowance', models });
  assert.equal(parseChatModels(catalog([{ ...model, vendor: ' OpenAI ' }])).models[0].vendor, 'OpenAI');
  assert.equal('vendor' in parseChatModels(catalog([model])).models[0], false);
  assert.equal('vendor' in parseChatModels(catalog([{ ...model, vendor: '' }])).models[0], false);
  for (const vendor of [7, 'x'.repeat(81), 'Open\nAI']) assert.throws(() => parseChatModels(catalog([{ ...model, vendor }])));
});

test('catalogue vendor names never resolve icons or families through Object.prototype', () => {
  const providers = JSON.parse('{"OpenAI":{"svg":"<svg data-openai></svg>","hue":"#000"},"Broken":{"svg":7,"hue":"#111"},"__proto__":{"svg":"<svg data-own-proto></svg>","hue":"#222"}}');
  assert.deepEqual(ownMark(providers, 'OpenAI'), { svg: '<svg data-openai></svg>', hue: '#000' });
  for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', 'Missing', 'Broken', undefined, null, 7]) assert.equal(ownMark(providers, name), undefined, String(name));
  assert.deepEqual(ownMark(providers, '__proto__'), { svg: '<svg data-own-proto></svg>', hue: '#222' }, 'an own JSON key is still an ordinary entry');
  assert.equal(ownMark(null, 'OpenAI'), undefined);
  for (const vendor of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) assert.equal(vendorFamily(vendor), vendor);
  const app = readFileSync(new URL('../src/scripts/app.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /M\.(?:agents|providers|images)\[/, 'every icon lookup uses ownMark');
  assert.match(app, /const mk = \(m: ReturnType<typeof ownMark>/);
});
