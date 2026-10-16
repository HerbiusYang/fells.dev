import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, refresh } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async()=>{environment=await supportBrowser();});
test.after(async()=>{await environment?.close();});
const orderId='00000000-0000-4000-8000-000000000090';
const at='2026-10-13T00:00:00Z';
function caseRecord(overrides={}){return{orderId,conversationId:'21',userId:'42',caseType:'compensation',reason:'Older unresolved compensation',evidenceMessageId:'31',evidenceAttachmentId:null,evidenceNote:'Actual conversation report',requestedAllowanceMicro:1000000,requestedHours:0,refundMicro:0,enableApiKeys:false,assigneeId:'84',assigneeName:'Support operator',dueAt:null,note:'',refundProof:'',refundProofMessageId:null,refundProofAttachmentId:null,receipt:null,version:1,createdAt:at,updatedAt:at,executedAt:null,closedAt:null,history:[],...overrides};}
function seed(f,activation=false){
  f.state.orders=[{id:orderId,conversationId:'21',userId:'42',title:'Original paid allowance',product:'allowance',amountMicro:20000000,currency:'CNY',serviceDays:0,status:activation?'awaiting_fulfillment':'completed',assigneeId:'84',assigneeName:'Support operator',note:'Original verified purchase',dueAt:null,paymentTopupId:101,subscriptionId:null,subscriptionRef:'',allowanceRef:activation?'':'allow-original',version:3,createdAt:at,updatedAt:at,accepted:!activation,acceptedAt:activation?null:at,fulfilled:!activation,fulfilledAt:activation?null:at,enableApiKeys:false,poolId:null,tier:0,months:0,allowanceUsdMicro:10000000,history:[{id:'1',actorName:'Support operator',action:'created',note:'Verified original payment',createdAt:at}]}];
  f.state.messages=[{id:'31',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'user',text:'Reported service interruption',attachments:[],createdAt:at},{id:'32',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'agent',text:'Original channel refund receipt TEST-REF-123',attachments:[],createdAt:at}];
}
async function openCaseEditor(desk){await desk.locator('[data-support-details]').click();await desk.locator(`[data-order-edit="${orderId}"]`).click();await desk.locator('[data-case-new]').waitFor();}
async function createCase(desk,type,amount){
  await desk.locator('[data-case-new]').click();const form=desk.locator('[data-case-form]');
  await form.locator('[name=caseType]').selectOption(type);await form.locator('[name=reason]').fill('Verified follow-up <script>window.casePwned=1</script>');
  await form.locator('[name=evidenceNote]').fill('The selected conversation contains the customer report and receipt');
  if(type!=='activation')await form.locator('[name=evidenceMessageId]').selectOption('31');
  if(type==='compensation')await form.locator('[name=requestedAllowance]').fill(String(amount));
  if(type==='refund')await form.locator('[name=refundAmount]').fill(String(amount));
  if(type==='activation')await form.locator('[name=enableApiKeys]').check();
  const saved=desk.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/cases'));
  await form.locator('[type=submit]').click();const response=await saved;assert.equal(response.status(),200);const item=(await response.json()).data;
  await desk.locator(`[data-case-execute="${item.id}"]`).waitFor();return item;
}
test('compensation requires real conversation evidence, Owner execution, and readable account changes',async t=>{
  const f=await supportFixture(t,environment);seed(f);const desk=await f.operatorPage();await openCaseEditor(desk);
  const item=await createCase(desk,'compensation',1.5);
  assert.equal(await desk.locator('[data-case-form] [name=status] option[value=executed]').count(),0,'unexecuted cases cannot be marked as executed');
  await desk.locator(`[data-case-execute="${item.id}"]`).click();await desk.locator('[data-case-error]').filter({hasText:'Owner required'}).waitFor();
  assert.equal(f.state.cases[0].status,'open');f.state.operatorRole='owner';
  await desk.locator(`[data-case-execute="${item.id}"]`).click();await desk.locator('.support-case-table').waitFor();
  const receipt=await desk.locator('[data-case-editor]').textContent();assert.ok(receipt.includes('人民币'));assert.ok(receipt.includes('美元'));assert.equal(receipt.includes('balanceMicro'),false,'receipt shows business labels');
  const create=f.calls.find(c=>c.method==='POST'&&c.path.endsWith('/cases'));assert.equal(create.body.requestedAllowanceMicro,1500000);assert.equal(create.body.evidenceMessageId,'31');
  assert.equal(f.calls.filter(c=>c.method==='PATCH'&&c.path.includes('/orders/')).length,0,'case editing never mutates the parent purchase form');
  const existingReceipt=structuredClone(f.state.cases[0].receipt);
  const review=desk.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith(`/cases/${item.id}`));
  await desk.locator('[data-case-form] [name=status]').selectOption('needs_review');await desk.locator('[data-case-form] [type=submit]').click();assert.equal((await review).status(),200);await desk.locator('[data-case-form] [data-case-version="3"]').waitFor();
  assert.equal(await desk.locator('[data-case-form] [name=status] option[value=open]').count(),0);assert.equal(await desk.locator('[data-case-form] [name=status] option[value=cancelled]').count(),0);assert.equal(await desk.locator('[data-case-execute]').count(),0);
  await desk.locator('[data-case-form] [name=status] option[value=executed]').waitFor({state:'attached'});
  const form=desk.locator('[data-case-form]');await form.locator('[name=status] option[value=executed]').waitFor({state:'attached'});await form.locator('[name=status]').selectOption('executed');
  assert.equal(await form.evaluate(el=>el.checkValidity()),false,'review notes are required before restoring customer acceptance');
  await form.locator('[name=note]').fill('Existing ledger and account changes reviewed; restore customer acceptance');
  const restored=desk.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith(`/cases/${item.id}`));await form.locator('[type=submit]').click();assert.equal((await restored).status(),200);
  assert.deepEqual(f.state.cases[0].receipt,existingReceipt,'review restoration preserves the original execution receipt');assert.equal(f.calls.filter(c=>c.path.endsWith(`/${item.id}/execute`)).length,2,'review restoration does not issue compensation again');
  const user=await f.customerPage();await user.locator('[data-customer-orders] > summary').click();await user.locator(`[data-case-accept="${item.id}"]`).click();
  await user.locator('[data-case-id]').filter({hasText:'已完成'}).waitFor();assert.equal(f.state.cases[0].status,'closed');assert.deepEqual(f.errors,[]);
});
test('refund stays awaiting customer confirmation until the original-channel receipt is linked',async t=>{
  const f=await supportFixture(t,environment);seed(f,true);const desk=await f.operatorPage();await openCaseEditor(desk);
  const item=await createCase(desk,'refund',1);await desk.locator(`[data-case-execute="${item.id}"]`).click();await desk.locator('.support-case-table').waitFor();
  const user=await f.customerPage();await user.locator('[data-customer-orders] > summary').click();await user.locator(`[data-case-accept="${item.id}"]`).waitFor();assert.equal(await user.locator(`[data-case-accept="${item.id}"]`).isDisabled(),true);
  const flow=desk.locator('[data-refund-action=channel]');await flow.locator('..').locator('summary').click();await flow.locator('[name=stage]').selectOption('paid');await flow.locator('[name=provider]').fill('bank');await flow.locator('[name=account]').fill('customer-original-account');await flow.locator('[name=refundId]').fill('TEST-REF-123');await flow.locator('[name=refundChannelMessageId]').selectOption('32');await flow.locator('[name=note]').fill('Original channel receipt TEST-REF-123, confirmed by finance');
  const saved=desk.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/refund-channel'));await flow.locator('[type=submit]').click();assert.equal((await saved).status(),200);
  await refresh(user);assert.equal(await user.locator(`[data-case-accept="${item.id}"]`).isDisabled(),true,'a payment claim still requires independent review');
  // A separate actor's claim/execution allows this operator to act as reviewer.
  Object.assign(f.state.cases[0].refund,{executedBy:'82',recordedBy:'83'});await refresh(desk);await desk.locator('[data-refund-action=review] [type=submit]:enabled').waitFor();await desk.locator('[data-refund-action=review] [name=note]').fill('Independent bank transfer and amount verified');const reviewed=desk.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/refund-review'));await desk.locator('[data-refund-action=review] [type=submit]').click();assert.equal((await reviewed).status(),200);
  await refresh(user);await user.locator(`[data-case-accept="${item.id}"]:enabled`).waitFor();await user.locator(`[data-case-accept="${item.id}"]`).click();
  await user.locator('[data-case-id]').filter({hasText:'已完成'}).waitFor();await refresh(desk);
  await desk.locator('[data-refund-stages]').waitFor();assert.equal(await desk.locator('[data-refund-action=channel]').count(),0,'closed refunds cannot record another transfer');assert.equal(f.state.cases[0].refundProofMessageId,'32');assert.equal(f.state.cases[0].status,'closed');
  assert.equal(f.calls.some(c=>/\/transfer|\/send-money/.test(c.path)),false);assert.deepEqual(f.errors,[]);
});

test('case create and customer acceptance survive SSE refreshes with their pending controls and account binding intact',async t=>{
  const f=await supportFixture(t,environment);seed(f);f.state.operatorRole='owner';const desk=await f.operatorPage();await openCaseEditor(desk);
  let releaseCreate;f.state.caseReplyGate=new Promise(resolve=>releaseCreate=resolve);t.after(()=>releaseCreate());
  const creation=createCase(desk,'compensation',1);
  const form=desk.locator('[data-case-form]');await form.locator('[type=submit]:disabled').waitFor();
  f.state.messages.push({id:'33',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'user',text:'SSE while case creation is pending',attachments:[],createdAt:'2026-10-13T00:00:01Z'});
  f.state.sseEvents.push({audience:'operator',type:'case.updated',data:{conversationId:'21',orderId,caseId:'20000000-0000-4000-8000-000000000091',version:1}});
  await desk.locator('[data-support-message][data-message-id="33"]').waitFor();assert.equal(await form.locator('[type=submit]').isDisabled(),true);
  releaseCreate();const item=await creation;assert.equal(await form.locator('[type=submit]').isDisabled(),false);
  await desk.locator(`[data-case-execute="${item.id}"]`).click();await desk.locator('.support-case-table').waitFor();
  const user=await f.customerPage();await user.locator('[data-customer-orders] > summary').click();await user.locator(`[data-case-accept="${item.id}"]`).waitFor();
  let releaseAccept;f.state.caseAcceptGate=new Promise(resolve=>releaseAccept=resolve);t.after(()=>releaseAccept());
  await user.locator(`[data-case-accept="${item.id}"]`).click();
  f.state.messages.push({id:'34',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'agent',text:'SSE while customer confirmation is pending',attachments:[],createdAt:'2026-10-13T00:00:02Z'});
  f.state.sseEvents.push({audience:'customer',type:'case.updated',data:{conversationId:'21',orderId,caseId:item.id,version:3}});
  await user.locator('[data-support-message][data-message-id="34"]').waitFor();
  assert.equal(await user.locator(`[data-case-accept="${item.id}"]`).isDisabled(),true);
  releaseAccept();await user.locator(`[data-case-id="${item.id}"]`).filter({hasText:'已完成'}).waitFor();
  assert.equal(f.state.cases.length,1);assert.equal(f.state.cases[0].userId,'42');
  assert.equal(f.calls.filter(c=>c.path.endsWith(`/${item.id}/accept`)).length,1);
  assert.deepEqual(f.errors,[]);
});

test('a late case response cannot replace the selected original order after the operator changes scope',async t=>{
  const f=await supportFixture(t,environment);seed(f);const desk=await f.operatorPage();await openCaseEditor(desk);
  await desk.locator('[data-case-new]').click();const caseForm=desk.locator('[data-case-form]');
  await caseForm.locator('[name=caseType]').selectOption('compensation');await caseForm.locator('[name=reason]').fill('Old original order follow-up');await caseForm.locator('[name=evidenceNote]').fill('Actual original conversation');await caseForm.locator('[name=evidenceMessageId]').selectOption('31');await caseForm.locator('[name=requestedAllowance]').fill('1');
  let release;f.state.caseReplyGate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const response=desk.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/cases'));
  await caseForm.locator('[type=submit]').click();await caseForm.locator('[type=submit]:disabled').waitFor();
  await desk.locator('[data-order-new]').click();const orderForm=desk.locator('[data-order-form]');await orderForm.locator('[name=title]').fill('New selected original order');await orderForm.locator('[name=product]').selectOption('allowance');await orderForm.locator('[name=amount]').fill('2');await orderForm.locator('[type=submit]').click();
  const next='00000000-0000-4000-8000-000000000091';await desk.locator('[data-order-editor] h4').filter({hasText:next}).waitFor();
  release();assert.equal((await response).status(),200);
  await refresh(desk);await desk.locator('[data-order-editor] h4').filter({hasText:next}).waitFor();
  assert.equal(await desk.locator('[data-case-editor]').textContent(),'');assert.equal(await desk.locator('[data-case-execute]').count(),0);
  assert.equal(f.state.cases.length,1);assert.equal(f.state.cases[0].orderId,orderId);assert.equal(await orderForm.locator('[type=submit]').isDisabled(),false);assert.deepEqual(f.errors,[]);
});

test('active case queue keeps older unresolved work despite 100 newer closed cases and paginates all active work',async t=>{
  const f=await supportFixture(t,environment);seed(f);
  const base=caseRecord();
  const id=i=>'20000000-0000-4000-8000-'+String(i).padStart(12,'0');
  f.state.cases=Array.from({length:100},(_,i)=>({...base,id:id(i+100),status:'closed',reason:'Newer closed case',closedAt:at}));
  f.state.cases.push({...base,id:id(1),status:'open'});
  const desk=await f.operatorPage();await desk.locator('[data-orders-queue]').click();await desk.locator('[data-work-cases]').click();
  await desk.locator('[data-work-list]').filter({hasText:'Older unresolved compensation'}).waitFor();
  assert.equal(await desk.locator('[data-work-list] [data-queue-case]').count(),1);
  assert.equal(await desk.locator('[data-work-truncated]').count(),0);
  const query=f.calls.filter(c=>c.path==='/api/support/cases').at(-1).query;assert.equal(query.status,'active');assert.equal(query.limit,'100');
  f.state.cases.push(...Array.from({length:100},(_,i)=>({...base,id:id(i+300),status:i%2?'needs_review':'executed',reason:'Additional active case'})));
  await desk.locator('[data-work-refresh]').click();await desk.locator('[data-work-case-more]').waitFor();
  assert.equal(await desk.locator('[data-work-list] [data-queue-case]').count(),100);await desk.locator('[data-work-case-more]').click();await desk.locator('[data-work-list] [data-queue-case]').nth(100).waitFor();assert.equal(await desk.locator('[data-work-list] [data-queue-case]').count(),101);assert.equal(await desk.locator('[data-work-case-more]').count(),0);assert.deepEqual(f.errors,[]);
});

test('account and case details prioritize older active records over 100 closed records without duplicate acceptance',async t=>{
  const f=await supportFixture(t,environment);seed(f,true);
  const original=f.state.orders[0];f.state.orders.unshift(...Array.from({length:100},(_,i)=>({...original,id:'00000000-0000-4000-8000-'+String(1000+i).padStart(12,'0'),status:'completed',title:'Newer completed purchase',accepted:true,fulfilled:true,allowanceRef:'closed-'+i})));
  const caseId='20000000-0000-4000-8000-000000000001';
  f.state.cases=Array.from({length:100},(_,i)=>caseRecord({id:'20000000-0000-4000-8000-'+String(100+i).padStart(12,'0'),status:'closed',reason:'Newer closed case',createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'}));f.state.cases.push(caseRecord({id:caseId,status:'open',caseType:'activation',reason:'Older unresolved activation',requestedAllowanceMicro:0}));
  const desk=await f.operatorPage();await openCaseEditor(desk);await desk.locator(`[data-case-id="${caseId}"]`).waitFor();await desk.locator('[data-case-more-records]').waitFor();
  assert.equal(await desk.locator(`[data-case-id="${caseId}"]`).count(),1,'active and history pages are deduplicated');assert.equal(await desk.locator('[data-case-id]').count(),101,'active records are preserved alongside the recent history');
  const customer=await f.customerPage();await customer.locator('[data-customer-orders] > summary').click();await customer.locator(`[data-case-id="${caseId}"]`).waitFor();await customer.locator('[data-case-more-records]').waitFor();await customer.locator('[data-customer-order-more]').waitFor();
  assert.ok((await customer.locator('[data-customer-order-list]').textContent()).includes(orderId),'older active original order remains visible');assert.equal(await customer.locator(`[data-order-accept="${orderId}"]`).count(),0,'active activation case suppresses the duplicate legacy acceptance');
  const scoped=f.calls.filter(c=>c.path==='/api/support/conversations/21/orders'&&c.headers['x-fells-support-audience']==='customer');assert.ok(scoped.length>0,'server order lifecycle suppresses duplicate acceptance independently of case pagination');assert.deepEqual(f.errors,[]);
});

test('subscription compensation form matches the server reason and gifted-hour limits before sending a case',async t=>{
  const f=await supportFixture(t,environment);seed(f);f.state.orders[0].product='subscription';const desk=await f.operatorPage();await openCaseEditor(desk);await desk.locator('[data-case-new]').click();
  const form=desk.locator('[data-case-form]');await form.locator('[name=caseType]').selectOption('compensation');await form.locator('[name=evidenceNote]').fill('Verified interruption');await form.locator('[name=evidenceMessageId]').selectOption('31');
  await form.locator('[name=reason]').evaluate(el=>el.value='x'.repeat(1001));await form.locator('[name=requestedHours]').fill('745');
  assert.equal(await form.evaluate(el=>el.checkValidity()),false);await form.locator('[type=submit]').click();assert.equal(f.calls.some(c=>c.method==='POST'&&c.path.endsWith('/cases')),false,'invalid case remains a draft without a request');
  assert.equal(await form.locator('[name=reason]').getAttribute('maxlength'),'1000');assert.equal(await form.locator('[name=requestedHours]').getAttribute('max'),'744');
  await form.locator('[name=reason]').fill('x'.repeat(1000));await form.locator('[name=requestedHours]').fill('744');assert.equal(await form.evaluate(el=>el.checkValidity()),true);
  await form.locator('[type=submit]').click();await desk.locator('[data-case-execute]').waitFor();assert.equal(f.state.cases[0].requestedHours,744);assert.equal(f.state.cases[0].reason.length,1000);assert.deepEqual(f.errors,[]);
});
