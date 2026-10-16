import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHttpService } from '../src/lib/support-http.ts';
import { supportLifecycleCopy } from '../src/i18n/support-lifecycle.ts';
import { supportLifecycleMarkup, supportPolicyMarkup } from '../src/lib/support-lifecycle.ts';
import { renderSupportMessages } from '../src/lib/support-ui.ts';
import { supportQuoteMarkup } from '../src/scripts/support-order-quote.ts';
import { supportCopy } from '../src/i18n/support.ts';
import { InvalidSupportData, SupportSessionEnded } from '../src/lib/support-store.ts';
const id='20000000-0000-4000-8000-000000000091',orderId='00000000-0000-4000-8000-000000000090',at='2026-10-15T00:00:00Z';
const envelope=data=>({ok:true,data,requestId:'lifecycle-test'});
const order={id:orderId,conversationId:'21',userId:'42',title:'Original subscription',product:'subscription',amountMicro:20000000,currency:'CNY',serviceDays:30,status:'awaiting_fulfillment',assigneeId:'84',assigneeName:'Operator',dueAt:null,paymentTopupId:101,subscriptionId:null,subscriptionRef:'',allowanceRef:'',note:'',version:3,createdAt:at,updatedAt:at,accepted:false,acceptedAt:null,history:[],waitingOn:'customer',acceptanceKind:'',acceptanceDeadline:'2026-10-29T00:00:00Z',refundedMicro:0,refundPendingMicro:0,openCaseCount:1,hasPendingActivationCase:true};
const item={id,orderId,conversationId:'21',userId:'42',caseType:'refund',status:'executed',reason:'Incorrect delivery',evidenceMessageId:'31',evidenceAttachmentId:null,evidenceNote:'Customer report',requestedAllowanceMicro:0,requestedHours:0,requestedPlanPeriods:0,refundMicro:10000000,enableApiKeys:false,assigneeId:'84',assigneeName:'Operator',dueAt:null,note:'',refundProof:'Bank confirmation',refundProofMessageId:'31',refundProofAttachmentId:null,receipt:null,version:3,createdAt:at,updatedAt:at,executedAt:at,closedAt:null,history:[],waitingOn:'team',acceptanceKind:'',acceptanceDeadline:null,refund:{plan:{mode:'proportional',reason:'Recover original right',proposedBy:'82',approvedBy:'83',approvedAt:at},stage:'pending',claimedStage:'paid',provider:'bank',account:'customer-account',refundId:'transfer-91',executedBy:'82',recordedBy:'83',reviewedBy:'',reversalRef:'',reversedAt:null,recovery:{}}};
function fixture(orderPage={items:[order],nextCursor:'opaque+due/created=id',hasMore:true,historySyncPending:true}){const calls=[];const service=createSupportHttpService({request:async(path,options={})=>{calls.push({path,options});if(path==='/api/app/bootstrap')return{session_id:'a'.repeat(64),user:{id:42}};if(path==='/api/support/session')return envelope({sessionId:'b'.repeat(64),operator:{id:'84',name:'Operator',email:'operator@test'},expiresAt:'2035-01-01T00:00:00Z'});if(path.startsWith('/api/support/compensation-report'))return envelope({month:'2026-10',items:[{userId:'42',allowanceMicro:100000000,hours:744,planPeriods:1,caseCount:3}]});if(path.includes('/orders?'))return envelope(orderPage);if(path.includes('/orders/'))return envelope(order);return envelope(item);},notify:()=>{}});return{service,calls};}
test('14-day policy, exact deadline and system closure are visible in all six locales without personal acceptance',()=>{
 for(const lang of ['en','zh-CN','zh-TW','ja','ko','es']){
  const copy=supportLifecycleCopy(lang);for(const[key,value]of Object.entries(copy))assert.ok(typeof value==='string'&&value.length,lang+':'+key);
  assert.match(supportPolicyMarkup(lang),/14/);assert.doesNotMatch(copy.rewardPolicy,/UTC/);assert.doesNotMatch(copy.caps,/UTC/);
  const markup=supportLifecycleMarkup({...item,acceptanceKind:'system_timeout',acceptanceDeadline:'2026-10-29T12:34:56Z'},lang);
  assert.match(markup,/data-system-closure/);assert.match(markup,/2026-10-29T12:34:56Z/);assert.doesNotMatch(markup,/data-personal-acceptance/);
  assert.match(supportLifecycleMarkup({...item,disputedAt:at,disputeReason:'Not received <script>'},lang),/Not received &lt;script&gt;/);
 }
});
test('refund approval, exact payout amount, review and correction use authenticated operator and original version',async()=>{
 const{service,calls}=fixture(),operator=await service.readSupportSession();
 const plan={version:3,action:'approve',mode:'proportional',reason:'Recover original right'};await service.setSupportRefundPlan(operator.session,id,plan);
 const channel={version:3,stage:'paid',amountMicro:10000000,currency:'CNY',provider:'bank',account:'customer-account',refundId:'transfer-91',note:'Actual transfer',proofMessageId:'31'};await service.recordSupportRefundChannel(operator.session,id,channel);
 await service.reviewSupportRefundChannel(operator.session,id,3,'Independent review');await service.reverseSupportCase(operator.session,id,{version:3,reason:'Verified failed transfer',evidenceMessageId:'31'});
 const mutations=calls.filter(c=>c.options.method==='POST');assert.equal(mutations.length,4);assert.deepEqual(mutations[0].options.body,plan);assert.deepEqual(mutations[1].options.body,channel);
 for(const call of mutations){assert.equal(call.options.body.version,3);assert.equal(call.options.headers['X-Fells-Support-Audience'],'operator');assert.equal(call.options.headers['X-Fells-Expected-Operator'],'84');}
 service.invalidateSession('operator');await assert.rejects(service.reviewSupportRefundChannel(operator.session,id,3,'Stale'),SupportSessionEnded);
});
test('customer disputes bind identity and cannot be empty; order cursors and waiting party retain scope',async()=>{
 const{service,calls}=fixture(),customer=await service.readCustomerSession();await service.disputeSupportOrder(customer.session,orderId,3,'Not usable');await service.disputeSupportCase(customer.session,id,3,'Not received');
 const disputes=calls.filter(c=>c.path.endsWith('/dispute'));assert.equal(disputes.length,2);for(const call of disputes)assert.equal(call.options.headers['X-Fells-Support-Audience'],'customer');
 await assert.rejects(service.disputeSupportCase(customer.session,id,3,' '),InvalidSupportData);
 const page=await service.listSupportOrders('customer',customer.session,'21',{cursor:'opaque+due/created=id',waitingOn:'customer'});assert.equal(page.items[0].hasPendingActivationCase,true);assert.equal(page.historySyncPending,true);
 const query=new URL(calls.at(-1).path,'https://test.local').searchParams;assert.equal(query.get('cursor'),'opaque+due/created=id');assert.equal(query.get('waitingOn'),'customer');
});
test('compensation report retains the Los Angeles calendar month, customer amounts and totals',async()=>{
 const{service,calls}=fixture(),operator=await service.readSupportSession();const report=await service.getSupportCompensationReport(operator.session,'2026-10');assert.deepEqual(report.items[0],{userId:'42',allowanceMicro:100000000,hours:744,planPeriods:1,caseCount:3});assert.match(calls.at(-1).path,/month=2026-10/);await assert.rejects(service.getSupportCompensationReport(operator.session,'2026-13'),InvalidSupportData);
});
test('shared order message is an actionable original-order card with escaped server snapshot',()=>{
 const conversation={id:'21',user:{name:'Customer'},userReadAt:0,agentReadAt:0,messages:[{id:'31',sender:'user',text:'',created:Date.parse(at),orderId,title:'unused',orderTitle:'Subscription <unsafe>',orderAmountMicro:20000000}]};
 const markup=renderSupportMessages(conversation,supportCopy('en'),'en','agent');assert.match(markup,new RegExp('data-support-order="'+orderId+'"'));assert.match(markup,/Subscription &lt;unsafe&gt;/);assert.match(markup,/CN¥20\.00|CNY.*20\.00|¥20\.00/);
});

test('a revised paid quote shows guaranteed and total flexible rights and cannot masquerade as delivery acceptance',()=>{
 const pending={...order,planCode:'standard',quoteReconfirmation:{state:'pending',reason:'Original quota unavailable',proposedAt:at,confirmedAt:null,quoteSnapshot:{serviceDays:30,tokenPlan:{code:'standard',name:'Requoted service',quota_usd_micro:5000000,burst_usd_micro:10000000},evidence:{messageText:'Customer agreed <safe>'}}}};
 const markup=supportQuoteMarkup(pending,'zh-CN','customer');assert.match(markup,/保证 API 额度/);assert.match(markup,/总弹性上限/);assert.match(markup,/data-order-confirm-quote/);assert.doesNotMatch(markup,/data-order-accept|data-case-accept/);assert.match(markup,/不代表验收交付/);assert.match(markup,/Customer agreed &lt;safe&gt;/);
});

 test('purchase history synchronization is preserved and malformed metadata is rejected',async()=>{
 const f=fixture({items:[order],nextCursor:null,hasMore:false,historySyncPending:'invalid'}),customer=await f.service.readCustomerSession();await assert.rejects(f.service.listSupportOrders('customer',customer.session,'21'),InvalidSupportData);
 });
