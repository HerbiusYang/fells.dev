import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlySoldOut, offeredModel, subscriptionWords } from '../src/lib/subscription-info.ts';

test('stock is a sales hint: new orders stop at capacity, existing seats can renew', () => {
  assert.equal(monthlySoldOut({free:0,capacity:4}),true);
  assert.equal(monthlySoldOut({free:2,capacity:0}),true);
  assert.equal(monthlySoldOut({free:1,capacity:4}),false);
  assert.equal(monthlySoldOut({free:0,capacity:4,held:true}),false);
  assert.equal(monthlySoldOut({free:0,capacity:4,current:true}),false);
  assert.equal(monthlySoldOut({}),false,'old catalog unknown stock still requires the authoritative checkout check');
});
test('a reference price and a generic wire route do not offer a model to customers', () => {
  for (const model of [null,{}, {list_priced:true,routable:true}, {offered:false,routable:true,client_formats:{api:['openai-completions']}}, {offered:true,routable:false,client_formats:{api:['openai-completions']}}, {offered:true,routable:true,client_formats:{api:[]}}]) assert.equal(offeredModel(model),false);
  for (const client of ['api','claude_code','web_chat']) assert.equal(offeredModel({offered:true,routable:true,formats:['anthropic-messages'],client_formats:{[client]:['anthropic-messages']}}),true,'temporary service health does not erase a configured offer');
  assert.equal(offeredModel({offered:true,routable:true,status:'down',formats:['anthropic-messages'],client_formats:{web_chat:['anthropic-messages']}}),true);
});
test('all customer languages describe the same subscription facts', () => {
  for(const locale of ['en','zh','zh-hant','ja','ko','es','zh-TW','zh-CN','unknown']) assert.ok(Object.values(subscriptionWords(locale)).every(value=>typeof value==='string'&&value.length>0));
});
