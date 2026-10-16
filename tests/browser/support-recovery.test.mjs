import test from 'node:test';
import assert from 'node:assert/strict';
import {supportRecoveryCopy} from '../../src/i18n/support-recovery.ts';
import {supportBrowser,supportFixture,locales} from './helpers/support-http-fixture.mjs';
let environment;
test.before(async()=>{environment=await supportBrowser();});
test.after(async()=>{await environment?.close();});
const orderId='00000000-0000-4000-8000-000000000090',caseId='20000000-0000-4000-8000-000000000091',at='2026-10-15T00:00:00Z';
function seed(f){
 f.state.orders=[{id:orderId,conversationId:'21',userId:'42',title:'Original delivered purchase',product:'allowance',amountMicro:20000000,currency:'CNY',serviceDays:0,status:'completed',assigneeId:'84',assigneeName:'Fells Support',note:'Original verified purchase',dueAt:null,paymentTopupId:101,subscriptionId:null,subscriptionRef:'',allowanceRef:'allow-original',version:3,createdAt:at,updatedAt:at,accepted:true,acceptedAt:at,fulfilled:true,fulfilledAt:at,enableApiKeys:false,poolId:null,tier:0,months:0,allowanceUsdMicro:10000000,history:[],hasPendingActivationCase:false}];
 f.state.cases=[{id:caseId,orderId,conversationId:'21',userId:'42',caseType:'compensation',status:'executed',reason:'Original compensation',evidenceMessageId:null,evidenceAttachmentId:null,evidenceNote:'Verified report',requestedAllowanceMicro:1000000,requestedHours:0,requestedPlanPeriods:0,refundMicro:0,enableApiKeys:false,assigneeId:'84',assigneeName:'Fells Support',dueAt:null,note:'',refundProof:'',refundProofMessageId:null,refundProofAttachmentId:null,receipt:null,version:3,createdAt:at,updatedAt:at,executedAt:at,closedAt:null,history:[]}];
}
test('six locales preserve order and case dispute explanations after 409 and require a fresh customer click',async t=>{
 for(const locale of locales){
  const f=await supportFixture(t,environment,{viewport:{width:320,height:568}});seed(f);
  const page=await f.customerPage(locale),copy=supportRecoveryCopy(locale.slice(1)||'en');
  await page.locator('[data-customer-orders-open]').click();
  for(const [kind,id,item] of [['order',orderId,f.state.orders[0]],['case',caseId,f.state.cases[0]]]){
   const form=page.locator(`[data-${kind}-dispute="${id}"]`),card=form.locator('..');
   await card.locator('summary').click();await form.locator('textarea').fill('Not usable — retain this detailed explanation');item.version=4;
   const failed=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/'+id+'/dispute'));
   await form.locator('[type=submit]').click();assert.equal((await failed).status(),409);
   await page.getByText(copy.disputeUpdated,{exact:true}).waitFor();
   assert.equal(await form.locator('textarea').inputValue(),'Not usable — retain this detailed explanation');
   assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/'+id+'/dispute')).length,1,'409 recovery reads only, never silently resubmits');
   const overflow=await form.evaluate(element=>{const width=document.documentElement.clientWidth;return [...element.querySelectorAll('textarea,button')].filter(node=>node.getClientRects().length).some(node=>{const r=node.getBoundingClientRect();return r.left<0||r.right>width;});});assert.equal(overflow,false);
   const success=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/'+id+'/dispute'));
   await form.locator('[type=submit]').click();assert.equal((await success).status(),200);
   const writes=f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/'+id+'/dispute'));
   assert.deepEqual(writes.map(c=>c.body.version),[3,4]);assert.equal(writes[1].body.reason,writes[0].body.reason);
  }
  assert.deepEqual(f.errors,[]);
 }
});
test('a failed latest-status read keeps the dispute draft and offers an explicit read retry',async t=>{
 const f=await supportFixture(t,environment);seed(f);const page=await f.customerPage('');await page.locator('[data-customer-orders-open]').click();
 const form=page.locator(`[data-order-dispute="${orderId}"]`);await form.locator('..').locator('summary').click();await form.locator('textarea').fill('Retain after read failure');f.state.orders[0].version=4;
 await page.route('**/api/support/orders/'+orderId,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{message:'Unavailable'}})}));
 await form.locator('[type=submit]').click();await page.getByText(supportRecoveryCopy('en').disputeRefreshFailed,{exact:true}).waitFor();
 assert.equal(await form.locator('textarea').inputValue(),'Retain after read failure');
 await page.unroute('**/api/support/orders/'+orderId);await form.locator('[data-dispute-refresh]').click();await page.getByText(supportRecoveryCopy('en').disputeUpdated,{exact:true}).waitFor();
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/'+orderId+'/dispute')).length,1);
 const success=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/'+orderId+'/dispute'));await form.locator('[type=submit]').click();assert.equal((await success).status(),200);assert.deepEqual(f.errors,[]);
});
test('the operation queue reaches record 103, filters customers and reconciles from a later page',async t=>{
 const f=await supportFixture(t,environment,{viewport:{width:320,height:568}});seed(f);
 const make=(i,userId='42')=>({id:'10000000-0000-4000-8000-'+String(i).padStart(12,'0'),userId,userName:'Customer '+userId,scope:'allowance',businessRef:'',status:'pending',outcome:'not_executed',httpStatus:0,createdAt:at,evidence:{kind:'none',reference:''},assigneeId:'',assigneeName:'',note:'',reviewedAt:null,version:1});
 f.state.operations=[...Array.from({length:103},(_,i)=>make(i+1)),make(999,'43')];
 const page=await f.operatorPage('');await page.locator('[data-operations-queue]').click();await page.locator('[data-work-backlog]').filter({hasText:'104'}).waitFor();
 assert.equal(await page.locator('[data-operation]').count(),100);assert.equal(await page.locator('[data-operation]').first().getAttribute('data-operation'),make(1).id);
 await page.locator('[data-work-operation-more]').click();await page.locator(`[data-operation="${make(103).id}"]`).waitFor();assert.equal(await page.locator('[data-operation]').count(),104);
 await page.locator(`[data-operation="${make(103).id}"]`).click();await page.locator('[data-operation-form] textarea').fill('Verified this original operation did not execute');
 const reply=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/'+make(103).id+'/reconcile'));await page.locator('[data-operation-form] [value=confirm_not_executed]').click();assert.equal((await reply).status(),200);assert.equal(f.state.operations[102].status,'completed');
 await page.locator('[data-work-customer-id]').fill('43');await page.locator('[data-work-customer-apply]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-operation]').length===1&&document.querySelector('[data-operation]')?.getAttribute('data-operation')==='10000000-0000-4000-8000-000000000999');
 assert.equal(await page.locator('[data-operation]').count(),1);assert.equal(await page.locator('[data-operation]').getAttribute('data-operation'),make(999,'43').id);
 const call=f.calls.filter(c=>c.path==='/api/support/operations').at(-1);assert.equal(call.query.userId,'43');assert.equal('cursor'in call.query,false);assert.equal(await page.locator('[data-work-operation-more]').count(),0);
 assert.deepEqual(f.errors,[]);
});
