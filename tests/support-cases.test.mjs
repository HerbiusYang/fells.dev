import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHttpService } from '../src/lib/support-http.ts';
import { APIError } from '../src/lib/app-http.ts';
import { InvalidSupportData, SupportSessionEnded } from '../src/lib/support-store.ts';
import { supportCasesCopy } from '../src/i18n/support-cases.ts';
const id='20000000-0000-4000-8000-000000000091',orderId='00000000-0000-4000-8000-000000000090',at='2026-10-13T00:00:00Z';
const item={id,orderId,conversationId:'21',userId:'42',caseType:'compensation',status:'open',reason:'Verified interruption',evidenceMessageId:'31',evidenceAttachmentId:null,evidenceNote:'Actual customer report',requestedAllowanceMicro:1000000,requestedHours:0,refundMicro:0,enableApiKeys:false,assigneeId:'84',assigneeName:'Operator',dueAt:null,note:'',refundProof:'',refundProofMessageId:null,refundProofAttachmentId:null,receipt:null,version:1,createdAt:at,updatedAt:at,executedAt:null,closedAt:null,history:[{id:'1',actorName:'Operator',action:'created',note:'Verified interruption',createdAt:at}]};
const envelope=data=>({ok:true,data,requestId:'test'});
function fixture(custom){const calls=[];const service=createSupportHttpService({request:async(path,options={})=>{calls.push({path,options});if(custom){const reply=await custom(path,options);if(reply!==undefined)return reply;}if(path==='/api/app/bootstrap')return{session_id:'a'.repeat(64),user:{id:42}};if(path==='/api/support/session')return envelope({sessionId:'b'.repeat(64),operator:{id:'84',name:'Operator',email:'operator@test'},expiresAt:'2035-01-01T00:00:00Z'});if(path.includes('cases?'))return envelope({items:[item],nextCursor:null,hasMore:false});return envelope(item);},notify:()=>{}});return{service,calls};}
test('case endpoints retain original order/account identity, real evidence, integer amounts and role-specific session headers',async()=>{
  const{service,calls}=fixture(),op=await service.readSupportSession(),customer=await service.readCustomerSession();
  const list=await service.listSupportCases('operator',op.session,{orderId});assert.equal(list.items[0].id,id);assert.equal(list.items[0].history[0].id,'1');
  const payload={clientCaseId:crypto.randomUUID(),caseType:'compensation',reason:item.reason,evidenceMessageId:'31',evidenceAttachmentId:null,evidenceNote:item.evidenceNote,requestedAllowanceMicro:1000000,requestedHours:0,refundMicro:0,enableApiKeys:false,dueAt:null};
  await service.createSupportCase(op.session,orderId,payload);await service.executeSupportCase(op.session,id,1);
  await service.updateSupportCase(op.session,id,{version:1,note:'Owner reviewed'});await service.listSupportCases('customer',customer.session,{conversationId:'21'});await service.acceptSupportCase(customer.session,id,1);
  assert.deepEqual(calls.find(c=>c.path.endsWith('/execute')).options.body,{version:1});
  assert.deepEqual(calls.find(c=>c.path.endsWith('/cases')&&c.options.method==='POST').options.body,payload);
  assert.equal(calls.find(c=>c.path.endsWith('/accept')).options.headers['X-Fells-Support-Audience'],'customer');
  assert.equal(calls.find(c=>c.path.endsWith('/execute')).options.headers['X-Fells-Expected-Operator'],'84');
  assert.equal(calls.find(c=>c.path.endsWith('/accept')).options.headers['X-Fells-Expected-User'],'42');
  await assert.rejects(service.listSupportCases('customer',customer.session),InvalidSupportData);
  service.invalidateSession('operator');await assert.rejects(service.executeSupportCase(op.session,id,1),SupportSessionEnded);
});
test('Owner/evidence rejection propagates without a fabricated executed receipt',async()=>{
  const f=fixture(path=>{if(path.endsWith('/execute'))throw new APIError(403,'Owner required','forbidden');});const op=await f.service.readSupportSession();
  await assert.rejects(f.service.executeSupportCase(op.session,id,1),failure=>failure instanceof APIError&&failure.status===403);
  const malformed=fixture(path=>path.includes('cases?')?envelope({items:[{...item,id:'91'}],nextCursor:null}):undefined);const active=await malformed.service.readSupportSession();await assert.rejects(malformed.service.listSupportCases('operator',active.session,{orderId}),InvalidSupportData);
});
test('case business labels and before/after receipt labels are complete across six locales',()=>{
  for(const locale of ['en','zh-CN','zh-TW','ja','ko','es']){const copy=supportCasesCopy(locale);for(const[key,value]of Object.entries(copy))assert.ok(value&&typeof value==='object'||typeof value==='string'&&value.length>0,`${locale}:${key}`);assert.equal(Object.keys(copy.types).length,3);assert.equal(Object.keys(copy.statuses).length,5);}
});
test('active case query filters before the server limit, and reason/hour boundaries reject invalid requests and responses',async()=>{
  const {service,calls}=fixture(),op=await service.readSupportSession();
  await service.listSupportCases('operator',op.session,{}, {status:'active'});
  const queue=calls.find(c=>c.path.startsWith('/api/support/cases?'));assert.equal(new URL(queue.path,'http://localhost').searchParams.get('status'),'active');assert.equal(new URL(queue.path,'http://localhost').searchParams.get('limit'),'100');
  const payload={clientCaseId:crypto.randomUUID(),caseType:'compensation',reason:item.reason,evidenceMessageId:'31',evidenceAttachmentId:null,evidenceNote:item.evidenceNote,requestedAllowanceMicro:0,requestedHours:744,refundMicro:0,enableApiKeys:false,dueAt:null};
  for(const invalid of [{...payload,reason:'x'.repeat(1001)},{...payload,requestedHours:745},{...payload,requestedHours:1.5}])await assert.rejects(service.createSupportCase(op.session,orderId,invalid),InvalidSupportData);
  assert.equal(calls.some(c=>c.options.method==='POST'),false,'invalid input is rejected before network mutation');
  await service.createSupportCase(op.session,orderId,{...payload,reason:'x'.repeat(1000)});
  const malformed=fixture(path=>path.includes('cases?')?envelope({items:[{...item,requestedHours:745}],nextCursor:null}):undefined),session=await malformed.service.readSupportSession();await assert.rejects(malformed.service.listSupportCases('operator',session.session),InvalidSupportData);
});
