import test from 'node:test';
import assert from 'node:assert/strict';
import {planPriceCeiling,validPlanPurchase,validPlanReceipt} from '../src/lib/plan-checkout.ts';
import {planCheckoutCopy} from '../src/i18n/plan-checkout.ts';
const key='00000000-0000-4000-8000-000000000901';
const plan={kind:'token',title:'Current offer',key,body:{plan:'1000',terms_hash:'a'.repeat(64),max_charge_micro:2000000},days:30,months:1,chargeMicro:2000000,maxChargeMicro:2000000,quotaMicro:1000000,burstMicro:2000000};
test('CNY plan ceilings support free offers and reject invalid month counts or unsafe totals',()=>{
 for(const [price,months,expected] of [[2000000,2,4000000],[0,24,0],[Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER],[1,24,24]])assert.equal(planPriceCeiling(price,months),expected);
 for(const [price,months] of [[-1,1],[1,0],[1,25],[1,1.5],[1.2,1],[Infinity,1],[Number.MAX_SAFE_INTEGER,2]])assert.equal(planPriceCeiling(price,months),null);
});
test('restored plan intent retains the original CNY ceiling, terms hash and payment identity',()=>{
 assert.equal(validPlanPurchase(plan),true);
 for(const patch of [{kind:'other'},{key:'new'},{title:''},{days:0},{maxChargeMicro:1000000},{chargeMicro:-1},{quotaMicro:0.1},{body:{...plan.body,ref:'different'}},{body:{...plan.body,terms_hash:'unknown'}},{body:{...plan.body,max_charge_micro:3000000}}])assert.equal(validPlanPurchase({...plan,...patch}),false,JSON.stringify(patch));
 assert.equal(validPlanPurchase(null),false);
 const monthly={...plan,kind:'subscription',body:{pool_id:11,tier:4,months:2,max_charge_micro:2000000}};
 assert.equal(validPlanPurchase(monthly),true);
 assert.equal(validPlanPurchase({...monthly,body:{...monthly.body,pool_id:0}}),false);
 assert.equal(validPlanPurchase({...monthly,kind:'upgrade'}),false);
 assert.equal(validPlanPurchase({...monthly,kind:'upgrade',body:{...monthly.body,from_pool:1}}),true);
});
test('all six plan purchase locales explain manual CNY purchase and upgrade consequences',()=>{
 for(const lang of ['en','zh','zh-hant','ja','ko','es','zh-CN','zh-TW','unknown']){
  const copy=planCheckoutCopy(lang);assert.ok(Object.values(copy).every(text=>typeof text==='string'&&text.length));assert.match(copy.rule,/CNY|人民币|人民幣|人民元|위안/);assert.match(copy.months,/30/);
 }
});

test('authoritative purchase and operator-reconciled receipts must match the frozen plan intent',()=>{
 assert.equal(validPlanReceipt({subscription:{id:1,plan_code:'1000'}},plan,42),true);
 for(const value of [null,{}, {subscription:{id:1,plan_code:'other'}},{subscription:{id:0,plan_code:'1000'}},{ok:true,reconciled:true,operation_id:'bad',business_ref:'x',receipt:{}}])assert.equal(validPlanReceipt(value,plan,42),false);
 const receipt={kind:'token_plan',reference:`tplan:42:${key}`,subscriptionId:1,cashMicro:2000000,planCode:'1000',allowanceMicro:1000000,burstAllowanceMicro:2000000,periodStart:1800000000,periodEnd:1802592000};
 const result={ok:true,reconciled:true,operation_id:key,business_ref:receipt.reference,receipt};
 assert.equal(validPlanReceipt(result,plan,42),true);
 for(const patch of [{cashMicro:3000000},{planCode:'other'},{allowanceMicro:1},{reference:'other'},{periodEnd:0},{kind:'allowance'}])assert.equal(validPlanReceipt({...result,receipt:{...receipt,...patch}},plan,42),false);
 assert.equal(validPlanReceipt(result,plan,43),false);
 const monthly={...plan,kind:'subscription',body:{pool_id:11,tier:4,months:1,max_charge_micro:2000000}};
 assert.equal(validPlanReceipt({subscription:{id:1,pool_id:11,tier:4}},monthly,42),true);
 assert.equal(validPlanReceipt({...result,business_ref:'seat:1:2',receipt:{kind:'subscription',reference:'seat:1:2',subscriptionId:1,cashMicro:1}},monthly,42),true);
 assert.equal(validPlanReceipt({...result,business_ref:'seat:2:2',receipt:{kind:'subscription',reference:'seat:2:2',subscriptionId:1,cashMicro:1}},monthly,42),false);
});
