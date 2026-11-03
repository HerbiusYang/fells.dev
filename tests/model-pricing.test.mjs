import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const module=ts.transpileModule(await readFile(new URL('../src/lib/model-pricing.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {modelPricing,officialPricing,cachePriceApplicability}=await import(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`);
const reference={list_priced:true,usd_in:7130000,usd_out:29990000,usd_cache_r:425000,usd_cache_w_30m:12000000,usd_cache_w_12h:21000000,usd_req:12000,long_threshold:250000,usd_in_long:14260000};
test('legacy price rows remain explicitly official references without an invented discount',()=>{
  const result=modelPricing(reference);assert.equal(result.source,'reference');assert.equal(result.priceBP,null);assert.equal(result.rates.usd_in,7130000);assert.equal(result.longThreshold,250000);assert.equal(result.rates.usd_cache_w_1h,undefined);
});
test('selling prices use the current row server values and its own long threshold',()=>{
  const row=Object.freeze({...reference,selling_prices:Object.freeze({price_bp:7000,usd_in:4991000,usd_out:20993000,usd_cache_w_30m:8400000,usd_cache_w_12h:14700000,usd_req:8400,long_threshold:300000,usd_in_long:9982000})});
  const result=modelPricing(row);assert.equal(result.source,'selling');assert.equal(result.rates.usd_in,4991000);assert.equal(result.rates.usd_req,8400);assert.equal(result.rates.usd_in_long,9982000);assert.equal(result.longThreshold,300000);assert.equal(row.usd_in,7130000);assert.notEqual(result.rates,row.selling_prices);
});
test('invalid supplied selling prices never silently fall back to reference prices',()=>{
  for(const value of [null,[],false,'price',{}, {price_bp:0,usd_in:0,usd_out:0},{price_bp:-1,usd_in:1,usd_out:1},{price_bp:Infinity,usd_in:1,usd_out:1},{price_bp:10000,usd_in:'1',usd_out:1},{price_bp:10000,usd_in:1,usd_out:1,usd_cache_w_12h:-1},{price_bp:10000,usd_in:1,usd_out:1,long_threshold:null},{price_bp:10000,usd_in:1,usd_out:1,usd_in_long:NaN}])assert.deepEqual(modelPricing({...reference,selling_prices:value}),{source:'unavailable',rates:{},longThreshold:0,priceBP:null});
});
test('separate Key rows retain separate server-calculated prices with no global substitution',()=>{
  const first=modelPricing({...reference,selling_prices:{price_bp:7000,usd_in:4991000,usd_out:20993000}});
  const second=modelPricing({...reference,selling_prices:{price_bp:2300,usd_in:1639900,usd_out:6897700}});
  assert.equal(first.rates.usd_in,4991000);assert.equal(second.rates.usd_in,1639900);assert.equal(second.priceBP,2300);assert.equal(second.rates.usd_cache_r,undefined);assert.equal(second.longThreshold,0);
});
test('explicit zero remains zero while unpriced or malformed reference rows stay unavailable',()=>{
  assert.equal(modelPricing({...reference,selling_prices:{price_bp:10000,usd_in:0,usd_out:0}}).rates.usd_in,0);
  for(const row of [{...reference,list_priced:false},{...reference,usd_req:-1},{...reference,usd_in:Number.MAX_SAFE_INTEGER+1},{...reference,long_threshold:-1}])assert.equal(modelPricing(row).source,'unavailable');
});
test('official list prices accompany only a valid selling quote',()=>{
  const official=officialPricing({...reference,selling_prices:{price_bp:7000,usd_in:4991000,usd_out:20993000}});
  assert.equal(official.source,'reference');assert.equal(official.rates.usd_in,7130000);assert.equal(official.rates.usd_in_long,14260000);assert.equal(official.longThreshold,250000);
  for(const row of [reference,{...reference,selling_prices:{price_bp:7000,usd_in:'bad',usd_out:1}},{...reference,list_priced:false,selling_prices:{price_bp:7000,usd_in:1,usd_out:1}},{...reference,usd_in:-1,selling_prices:{price_bp:7000,usd_in:1,usd_out:1}}])assert.equal(officialPricing(row),null);
});
test('cache TTL applicability follows vendor instead of compatible protocol or other rows',()=>{
  for(const field of ['usd_cache_w_30m','usd_cache_w_12h_long']){assert.equal(cachePriceApplicability({vendor:' OpenAI '},field),true);assert.equal(cachePriceApplicability({vendor:'Anthropic',protocol:'openai'},field),false);assert.equal(cachePriceApplicability({},field),null);}
  assert.equal(cachePriceApplicability({vendor:'OpenAI'},'usd_cache_w_1h'),false);assert.equal(cachePriceApplicability({vendor:'Anthropic'},'usd_cache_w'),true);assert.equal(cachePriceApplicability({vendor:'Gemini'},'usd_cache_w'),false);assert.equal(cachePriceApplicability({},'usd_in'),true);
});
