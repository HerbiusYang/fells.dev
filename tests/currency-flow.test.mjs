import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCashMicro, validExchangeQuote, validExchangeReconciliation, microText, storeMoneyIntent } from '../src/lib/currency-flow.ts';
import { currencyFlowCopy } from '../src/i18n/currency-flow.ts';
import { api, APIError } from '../src/lib/app-http.ts';

const quote = { id:'00000000-0000-4000-8000-000000000001', source:'ECB', as_of:'2026-10-16', fetched_at:'2026-10-17T00:00:00Z', expires_at:'2026-10-17T00:02:00Z', fee_bp:10, reference_rate:'7.2', effective_rate:'7.2072', cash_micro:7207200, principal_cash_micro:7200000, fee_cny_micro:7200, usd_micro:1000000, currency:'USD' };
test('cash parsing keeps exact six-decimal micro amounts and rejects float shorthand', () => {
  for(const [text, expected] of [['0.000001',1],['7.207200',7207200],['01.01',1010000],['9007199254.740991',Number.MAX_SAFE_INTEGER]]) assert.equal(parseCashMicro(text), expected);
  for(const text of ['', '0','0.000000','-1','+1','1e3',' 1','1.','1,000','0.0000001','9007199254.740992','Infinity','NaN']) assert.equal(parseCashMicro(text), null, text);
  assert.equal(microText(7207200), '7.2072'); assert.equal(microText(1), '0.000001'); assert.equal(microText(1000000), '1');
  assert.equal(microText(Number.MAX_SAFE_INTEGER), '9007199254.740991'); assert.equal(microText(-1), '-0.000001'); assert.equal(microText(0), '0');
});
test('quote confirmation requires ECB, both currencies, fixed fee and coherent integer totals', () => {
  assert.equal(validExchangeQuote(quote,7207200),true);
  for(const patch of [{source:'manual'},{currency:'CNY'},{fee_bp:100},{cash_micro:0},{fee_cny_micro:-1},{principal_cash_micro:7200001},{usd_micro:1.2},{reference_rate:'NaN'},{effective_rate:'7.2'},{as_of:'unknown'},{expires_at:'never'},{id:'untrusted'},{api_keys_will_enable:'true'}]) assert.equal(validExchangeQuote({...quote,...patch}),false,JSON.stringify(patch));
  assert.equal(validExchangeQuote(quote,1),false);
});
test('all six locales explain fee-on-exchange and separate CNY funding', () => {
  for(const lang of ['en','zh-CN','zh-TW','ja','ko','es','zh','zh-hant']) {
    const copy=currencyFlowCopy(lang); assert.ok(Object.values(copy).every(text=>typeof text==='string'&&text.length>0));
    assert.match(copy.rule,/1[.,]001/); assert.match(copy.fee,/10/); assert.match(copy.cash,/CNY|人民币|人民幣|人民元|위안/);
  }
});
test('financial submission requires the exact intent to be retained before any request', t => {
  const previous=globalThis.sessionStorage;t.after(()=>{globalThis.sessionStorage=previous;});
  globalThis.sessionStorage={setItem(){throw Error('blocked');},getItem(){return null;}};
  assert.throws(()=>storeMoneyIntent('identity:operation',{quote}),/blocked/);
  globalThis.sessionStorage={setItem(){},getItem(){return 'corrupted';}};
  assert.throws(()=>storeMoneyIntent('identity:operation',{quote}),/unavailable/);
});
test('known rejected exchanges remain distinct from ambiguous operation conflicts', async t => {
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  for(const [value,rejected,code] of [[{error:'quote expired',code:'quote_expired_or_mismatch',transaction_rejected:true},true,'quote_expired_or_mismatch'],[{error:{code:'operation_pending',message:'still running'}},false,'operation_pending'],[{error:'unknown conflict'},false,'']]) {
    globalThis.fetch=async()=>Response.json(value,{status:409});
    await assert.rejects(api('/api/app/allowance/buy',{body:{}}),error=>error instanceof APIError&&error.transactionRejected===rejected&&error.code===code);
  }
});

test('reconciled exchange evidence must match both immutable currency amounts and its business reference',()=>{
 const result={ok:true,reconciled:true,operation_id:'00000000-0000-4000-8000-000000000001',business_ref:'original-allowance',receipt:{kind:'allowance',reference:'original-allowance',cashMicro:quote.cash_micro,allowanceMicro:quote.usd_micro}};
 assert.equal(validExchangeReconciliation(result,quote),true);
 for(const value of [null,{}, {...result,operation_id:''},{...result,business_ref:''},{...result,receipt:{...result.receipt,cashMicro:1}},{...result,receipt:{...result.receipt,allowanceMicro:1}},{...result,receipt:{...result.receipt,kind:'token_plan'}},{...result,receipt:{...result.receipt,reference:'different'}}])assert.equal(validExchangeReconciliation(value,quote),false);
});
