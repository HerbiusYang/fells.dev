import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const load=async path=>import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`);
const {inspectRequestTokens,inspectRequestLatency}=await load('../src/lib/request-inspection.ts');
const {requestInspectionWordsOf}=await load('../src/i18n/request-inspection.ts');
test('actual token partitions respect protocol cache inclusion and the 1h subset',()=>{
  const row={protocol:'anthropic',tokens_in:100,tokens_out:20,tokens_cache_r:50,tokens_cache_w:30,tokens_cache_w1h:10};
  assert.deepEqual(inspectRequestTokens(row),{total:200,parts:[{key:'input',tokens:100},{key:'cacheRead',tokens:50},{key:'cacheWrite5m',tokens:20},{key:'cacheWrite1h',tokens:10},{key:'output',tokens:20}]});
  for(const protocol of ['openai','gemini']){const out=inspectRequestTokens({...row,protocol});assert.equal(out.total,150);assert.equal(out.parts[0].tokens,50)}
  assert.equal(inspectRequestTokens({...row,tokens_cache_w1h:undefined}).parts[2].tokens,30);
  assert.equal(inspectRequestTokens({protocol:'anthropic',tokens_in:0,tokens_out:0,tokens_cache_r:0,tokens_cache_w:0}).total,0);
});
test('missing or inconsistent counters never invent a context composition',()=>{
  const row={protocol:'anthropic',tokens_in:100,tokens_out:20,tokens_cache_r:50,tokens_cache_w:30};
  for(const change of [{tokens_in:null},{tokens_out:-1},{tokens_cache_r:undefined},{tokens_cache_w:'30'},{tokens_cache_w1h:31},{protocol:'unknown'},{tokens_in:Number.MAX_SAFE_INTEGER},{tokens_out:1.5},{protocol:'openai',tokens_in:10}]){
    assert.equal(inspectRequestTokens({...row,...change}).total,null,JSON.stringify(change));assert.deepEqual(inspectRequestTokens({...row,...change}).parts,[]);
  }
});
test('duration bins include zero and the 2–5 second interval without fake TTFT',()=>{
  const result=inspectRequestLatency([0,499,500,999,1000,1999,2000,4999,5000,9000].map(latency_ms=>({latency_ms})));
  assert.deepEqual(result,{count:10,p50:1000,p95:9000,buckets:[2,2,2,2,2]});
  assert.deepEqual(inspectRequestLatency([{}, {latency_ms:-1},{latency_ms:'5'},{latency_ms:Infinity}]),{count:0,p50:null,p95:null,buckets:[0,0,0,0,0]});
});
test('all interface locales include measured-sample and unavailable explanations',()=>{
  for(const locale of ['en','zh-CN','zh-hant','ja','ko','es'])for(const value of Object.values(requestInspectionWordsOf(locale)))assert.equal(typeof value==='string'&&value.length>0,true);
  assert.deepEqual(requestInspectionWordsOf('xx'),requestInspectionWordsOf('en'));
});
test('native OpenAI cache retention partitions input without adding writes twice',()=>{
  const row={protocol:'openai',tokens_in:1000,tokens_out:100,tokens_cache_r:200,tokens_cache_w:0,tokens_cache_w30m:300,tokens_cache_w12h:400};
  assert.deepEqual(inspectRequestTokens(row),{total:1100,parts:[{key:'input',tokens:100},{key:'cacheRead',tokens:200},{key:'cacheWrite30m',tokens:300},{key:'cacheWrite12h',tokens:400},{key:'output',tokens:100}]});
  const historical=inspectRequestTokens({...row,tokens_cache_w:50,tokens_cache_w1h:20,tokens_cache_w30m:0,tokens_cache_w12h:0});
  assert.equal(historical.total,1150);
  assert.deepEqual(historical.parts.filter(part=>part.key.startsWith('cacheWrite')),[{key:'cacheWriteLegacy',tokens:50},{key:'cacheWrite30m',tokens:0},{key:'cacheWrite12h',tokens:0}]);
  assert.equal(inspectRequestTokens({...row,tokens_cache_w30m:undefined,tokens_cache_w12h:undefined}).parts[0].tokens,800);
});
test('native cache dimensions reject over-counts, invalid values and non-OpenAI mixtures',()=>{
  const row={protocol:'openai',tokens_in:100,tokens_out:10,tokens_cache_r:20,tokens_cache_w:0,tokens_cache_w30m:30,tokens_cache_w12h:40};
  for(const change of [{tokens_cache_w:1},{tokens_cache_w:5,tokens_cache_w1h:5},{tokens_cache_w30m:0,tokens_cache_w12h:40,protocol:'anthropic'},{tokens_cache_w30m:41},{tokens_cache_w12h:null},{tokens_cache_w30m:'30'},{tokens_cache_w12h:-1},{tokens_cache_w30m:1.5},{tokens_cache_w12h:Infinity},{tokens_cache_w30m:Number.MAX_SAFE_INTEGER},{protocol:'anthropic'},{protocol:'gemini'}]){
    assert.deepEqual(inspectRequestTokens({...row,...change}),{total:null,parts:[]},JSON.stringify(change));
  }
  assert.equal(inspectRequestTokens({...row,tokens_cache_w30m:0,tokens_cache_w12h:0,protocol:'anthropic'}).total,130);
  assert.equal(inspectRequestTokens({...row,tokens_cache_w30m:0,tokens_cache_w12h:0,protocol:'gemini'}).total,110);
});
