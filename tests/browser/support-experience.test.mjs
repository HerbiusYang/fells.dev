import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { supportBrowser, supportFixture, refresh, sendCustomer } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async()=>{environment=await supportBrowser();});
test.after(async()=>{await environment?.close();});
const orderId='00000000-0000-4000-8000-000000000090',at='2026-11-15T12:00:00Z';
function seed(f,extra={}){
 f.state.messages=[{id:'31',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'user',text:'请帮我核对套餐和退款',attachments:[],createdAt:at}];
 f.state.orders=[{id:orderId,conversationId:'21',userId:'42',title:'已付款的原订单',product:'allowance',amountMicro:20000000,currency:'CNY',serviceDays:0,status:'completed',assigneeId:'84',assigneeName:'客服',dueAt:null,paymentTopupId:101,subscriptionId:null,subscriptionRef:'',allowanceRef:'original-delivery',tokenPlanRef:'',note:'',version:3,createdAt:at,updatedAt:at,accepted:true,acceptedAt:at,fulfilled:true,fulfilledAt:at,enableApiKeys:false,poolId:null,tier:0,months:0,planCode:'',allowanceUsdMicro:10000000,history:[],...extra}];
}
test('a visitor opens support without creating an empty conversation; only the first real message creates one',async t=>{
 const f=await supportFixture(t,environment);let exists=false,creates=0;
 await f.context.route('**/api/support/conversations/current',route=>{
  if(route.request().method()==='POST'){exists=true;creates++;return route.fallback();}
  return exists?route.fallback():route.fulfill({json:{ok:true,data:null,requestId:'synthetic'}});
 });
 const page=await f.customerPage();await page.locator('.support-greeting').waitFor();
 assert.equal(creates,0);await page.locator('[data-support-text]').fill('新的真实咨询');await page.locator('[data-support-send]:enabled').waitFor();
 await page.locator('[data-support-send]').click();await page.locator('[data-support-message]').filter({hasText:'新的真实咨询'}).waitFor();
 assert.equal(creates,1);await refresh(page);assert.equal(creates,1);assert.deepEqual(f.errors,[]);
});
test('the active inbox archives finished conversations and new replies return them to active work',async t=>{
 const f=await supportFixture(t,environment);seed(f);const page=await f.operatorPage();
 assert.equal(await page.locator('[data-support-filter=open]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-support-status]').click();await page.locator('[data-support-status]').filter({hasText:'重新打开'}).waitFor();
 assert.equal(await page.locator('[data-support-list] [data-support-conversation]').count(),0);
 assert.match(await page.locator('[data-support-list]').innerText(),/当前咨询已处理完/);
 await page.locator('[data-support-filter=resolved]').click();await page.locator('[data-support-conversation="21"]').waitFor();
 assert.match(await page.locator('[data-support-inbox-title]').innerText(),/历史/);
 const customer=await f.customerPage();await sendCustomer(customer,'继续处理原来的问题');await refresh(page);
 await page.locator('[data-support-filter=open]').click();await page.locator('[data-support-conversation="21"]').waitFor();
 assert.equal(f.state.status,'open');assert.deepEqual(f.errors,[]);
});
test('a large inbox expands in pages, retains its expanded count after refresh and searches every conversation',async t=>{
 const f=await supportFixture(t,environment);seed(f);
 const conversations=Array.from({length:85},(_,index)=>{
  const id=String(21+index),message={...f.state.messages[0],id:String(31+index),conversationId:id,text:`中文咨询 ${index+1}`};
  return {id,status:'open',customer:{id:String(42+index),name:`客户 ${index+1}`,email:`customer-${index+1}@example.test`,joinedAt:at,preferredLocale:'zh-CN',workspaceCount:0,credits:0,creditsCurrency:'USD',creditsKind:'api_allowance',walletCashMicro:0,walletCurrency:'CNY'},lastMessage:message,unreadCount:0,updatedAt:at,userRead:{lastReadMessageId:null,updatedAt:null},agentRead:{lastReadMessageId:message.id,updatedAt:at}};
 });
 await f.context.route('**/api/support/conversations**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()!=='GET')return route.fallback();
  if(path==='/api/support/conversations')return route.fulfill({json:{ok:true,data:{items:conversations,nextCursor:null}}});
  const match=/^\/api\/support\/conversations\/(\d+)(\/messages)?$/.exec(path);
  const item=conversations.find(item=>item.id===match?.[1]);
  return item?route.fulfill({json:{ok:true,data:match[2]?{items:[item.lastMessage],nextCursor:null}:item}}):route.fallback();
 });
 const page=await f.operatorPage();const rows=page.locator('[data-support-list] [data-support-conversation]');
 assert.equal(await rows.count(),40);await page.locator('[data-support-more]').click();assert.equal(await rows.count(),80);
 const reread=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/support/conversations');await refresh(page);await reread;
 await page.waitForFunction(()=>document.querySelectorAll('[data-support-list] [data-support-conversation]').length===80);
 await page.locator('[data-support-more]').click();assert.equal(await rows.count(),85);
 await page.locator('[data-support-search]').fill('中文咨询 85');await rows.filter({hasText:'客户 85'}).waitFor();assert.equal(await rows.count(),1);
 await page.locator('[data-support-search]').fill('');await page.waitForFunction(()=>document.querySelectorAll('[data-support-list] [data-support-conversation]').length===40);
 assert.deepEqual(f.errors,[]);
});
for(const width of [320,1440])test(`orders and after-sales use a Chinese modal with retained drafts and keyboard return at ${width}px`,async t=>{
 const f=await supportFixture(t,environment,{viewport:{width,height:900}});seed(f);const page=await f.operatorPage();
 const trigger=page.locator('[data-support-ticket]');await trigger.click();const modal=page.locator('.support-ticket-dialog');
 await modal.waitFor({state:'visible'});assert.equal(await modal.evaluate(el=>el.matches(':modal')),true);assert.match(await modal.innerText(),/订单与工单/);
 assert.equal(await page.locator('[data-support-console]').getAttribute('data-details'),'false','opening tickets does not also open customer details');
 await modal.locator('[data-order-new]').click();const form=modal.locator('[data-order-form]');
 await form.locator('[name=title]').fill('留在当前页面的草稿');await form.locator('[name=product]').selectOption('other');await form.locator('[name=amount]').fill('1.000001');
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 await trigger.click();assert.equal(await form.locator('[name=title]').inputValue(),'留在当前页面的草稿');
 assert.equal(await form.locator('[name=amount]').inputValue(),'1.000001');
 await modal.locator('[data-ticket-close]').focus();await page.keyboard.press('Shift+Tab');assert.equal(await modal.evaluate(el=>el.contains(document.activeElement)),true);
 await page.keyboard.press('Tab');assert.equal(await modal.locator('[data-ticket-close]').evaluate(el=>el===document.activeElement),true);
 assert.equal(f.calls.some(call=>call.method==='POST'&&call.path.endsWith('/orders')),false,'closing a draft never creates an order');
 const box=await modal.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.width<=1062);
 const overflow=await modal.evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false);
 await modal.evaluate(el=>{el.scrollTop=0;});await mkdir('test-results/support-experience',{recursive:true});await modal.screenshot({path:`test-results/support-experience/quote-${width}.png`});
 assert.deepEqual(f.errors,[]);
});
test('new customer messages remain unread behind a ticket modal until the operator returns to chat',async t=>{
 const f=await supportFixture(t,environment);seed(f);const page=await f.operatorPage();
 await page.waitForFunction(()=>document.querySelector('[data-support-count=unread]')?.textContent==='0');
 await page.locator('[data-support-ticket]').click();
 const previousRead=f.state.agentRead;
 f.state.messages.push({id:'32',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'user',text:'弹窗打开时的新消息',attachments:[],createdAt:'2026-11-15T12:00:01Z'});
 await refresh(page);await page.waitForFunction(()=>document.querySelector('[data-support-count=unread]')?.textContent==='1');
 assert.equal(f.state.agentRead,previousRead);
 await page.locator('[data-ticket-close]').click();await page.waitForFunction(()=>document.querySelector('[data-support-count=unread]')?.textContent==='0');
 assert.equal(f.state.agentRead,'32');assert.deepEqual(f.errors,[]);
});
test('closing an untouched order does not freeze its old version, while case drafts survive close and refresh',async t=>{
 const f=await supportFixture(t,environment);seed(f);const page=await f.operatorPage();await page.locator('[data-support-ticket]').click();
 await page.locator(`[data-order-edit="${orderId}"]`).click();await page.locator('[data-ticket-close]').click();
 f.state.orders[0].version=4;f.state.orders[0].note='另一位客服更新的记录';
 await refresh(page);await page.locator('[data-support-ticket]').click();
 await page.waitForFunction(()=>document.querySelector('[data-order-form] [name=note]')?.value==='另一位客服更新的记录');
 await page.locator('[data-case-new]').click();const form=page.locator('[data-case-form]');
 await form.locator('[name=reason]').fill('需要保留的退款草稿');await form.locator('[name=evidenceMessageId]').selectOption('31');await form.locator('[name=refundAmount]').fill('1.000001');
 await page.locator('[data-ticket-close]').click();f.state.orders[0].version=5;await refresh(page);await page.locator('[data-order-form]').filter({hasText:'版本 5'}).waitFor({state:'attached'});await page.locator('[data-support-ticket]').click();
 assert.equal(await form.locator('[name=reason]').inputValue(),'需要保留的退款草稿');assert.equal(await form.locator('[name=refundAmount]').inputValue(),'1.000001');
 assert.equal(f.calls.some(call=>call.method==='POST'&&call.path.endsWith('/cases')),false);assert.deepEqual(f.errors,[]);
});
test('an uncertain quote retains all six decimal places at large supported amounts and replays the same intent',async t=>{
 const f=await supportFixture(t,environment);seed(f);const page=await f.operatorPage();await page.locator('[data-support-ticket]').click();await page.locator('[data-order-new]').click();
 const form=page.locator('[data-order-form]');await form.locator('[name=title]').fill('精确金额回执核对');await form.locator('[name=amount]').fill('8999999999.000001');
 f.state.failCreateAfterCommit=true;await form.locator('[type=submit]').click();await page.locator('[data-order-error]').filter({hasText:'Lost create response'}).waitFor();
 assert.equal(await form.locator('[name=amount]').inputValue(),'8999999999.000001');
 const first=f.calls.find(call=>call.method==='POST'&&call.path.endsWith('/orders'));assert.equal(first.body.amountMicro,8999999999000001);
 f.state.failCreateAfterCommit=false;const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/orders'));await form.locator('[type=submit]').click();assert.equal((await response).status(),200);
 const writes=f.calls.filter(call=>call.method==='POST'&&call.path.endsWith('/orders'));assert.equal(writes.length,2);assert.deepEqual(writes[1].body,writes[0].body);assert.equal(f.state.orders.filter(order=>order.clientOrderId===first.body.clientOrderId).length,1);assert.deepEqual(f.errors,[]);
});
test('a multi-month Token Plan keeps its catalog price and term when the ticket is reopened', async t => {
  const f = await supportFixture(t, environment);
  seed(f);
  const monthly = { months: 1, priceMicro: 88_000_000, bonusPct: 0, bonusUsdMicro: 0 };
  const quarterly = { months: 3, priceMicro: 250_000_001, bonusPct: 10, bonusUsdMicro: 1_000_000 };
  await f.context.route('**/api/support/catalog', route => route.fulfill({ json: { ok: true, data: {
    subscriptions: [], allowance: { priceCny: 2 },
    tokenPlans: [{ code: 'token-standard', name: 'Token Standard', priceMicro: monthly.priceMicro, periodDays: 30, enabled: true, terms: [monthly, quarterly] }],
  } } }));
  await f.context.route('**/api/support/conversations/21/orders', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { ok: false, error: { message: 'Lost quote response' } } }) : route.fallback());
  const page = await f.operatorPage();
  const ticket = page.locator('[data-support-ticket]');
  await ticket.click();
  await page.locator('[data-order-new]').click();
  const form = page.locator('[data-order-form]');
  await form.locator('[name=product]').selectOption('token_plan');
  await form.locator('[name=planCode]').selectOption('token-standard');
  await form.locator('[name=tokenPlanMonths]').selectOption('3');
  await page.keyboard.press('Escape');
  await ticket.click();
  assert.equal(await form.locator('[name=tokenPlanMonths]').inputValue(), '3');
  assert.equal(await form.locator('[name=amount]').inputValue(), '250.000001');
  assert.equal(await form.locator('[name=serviceDays]').inputValue(), '30');
  const submission = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/orders'));
  await form.locator('[type=submit]').click();
  const { months, amountMicro, serviceDays } = (await submission).postDataJSON();
  assert.deepEqual({ months, amountMicro, serviceDays }, { months: 3, amountMicro: quarterly.priceMicro, serviceDays: 30 });
  await page.locator('[data-order-error]').filter({ hasText: 'Lost quote response' }).waitFor();
  assert.equal(await form.locator('[name=tokenPlanMonths]').inputValue(), '3');
  assert.deepEqual(f.errors, []);
});
test('subscription catalog selections lock price and duration and exact decimal quotes remain precise',async t=>{
 const f=await supportFixture(t,environment);seed(f);const page=await f.operatorPage();await page.locator('[data-support-ticket]').click();await page.locator('[data-order-new]').click();
 const form=page.locator('[data-order-form]');await form.locator('[name=product]').selectOption('subscription');
 assert.equal(await form.locator('[name=amount]').inputValue(),'120');assert.equal(await form.locator('[name=amount]').evaluate(el=>el.readOnly),true);
 await form.locator('[name=months]').fill('2');await form.locator('[name=months]').dispatchEvent('change');assert.equal(await form.locator('[name=amount]').inputValue(),'240');assert.equal(await form.locator('[name=serviceDays]').inputValue(),'60');
 await form.locator('[name=product]').selectOption('other');await form.locator('[name=title]').fill('人工跟进');await form.locator('[name=amount]').fill('0.100001');
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/orders'));await form.locator('[type=submit]').click();assert.equal((await response).status(),200);
 const created=f.calls.find(call=>call.method==='POST'&&call.path.endsWith('/orders'));assert.equal(created.body.amountMicro,100001);assert.equal(created.body.serviceDays,0);assert.equal(created.body.poolId,null);assert.equal(created.body.planCode,'');assert.deepEqual(f.errors,[]);
});
test('confirmed quotes guide payment through supported states and never submit a payment ID in the wrong state',async t=>{
 const f=await supportFixture(t,environment);seed(f,{product:'subscription',status:'quoted',fulfilled:false,accepted:false,paymentTopupId:null,allowanceRef:'',poolId:11,tier:1,months:1,serviceDays:30,amountMicro:120000000,purchaseConfirmation:{state:'confirmed',quoteHash:'a'.repeat(64),confirmedAt:at}});
 const page=await f.operatorPage();await page.locator('[data-support-ticket]').click();await page.locator(`[data-order-edit="${orderId}"]`).click();const form=page.locator('[data-order-form]');
 assert.equal(await form.locator('[name=paymentTopupId]').evaluate(el=>el.readOnly),true);assert.match(await form.innerText(),/先将状态保存为待付款/);
 await form.locator('[name=status]').selectOption('awaiting_payment');await form.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-order-form] [name=status]')?.value==='awaiting_payment'&&!document.querySelector('[data-order-form] [name=paymentTopupId]')?.readOnly);
 await form.locator('[name=paymentTopupId]').fill('101');const writes=f.calls.filter(call=>call.method==='PATCH'&&call.path.endsWith('/orders/'+orderId)).length;
 await form.locator('[type=submit]').click();await page.locator('[data-order-error]').filter({hasText:'保存为待交付'}).waitFor();assert.equal(f.calls.filter(call=>call.method==='PATCH'&&call.path.endsWith('/orders/'+orderId)).length,writes);
 await form.locator('[name=status]').selectOption('awaiting_fulfillment');const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname.endsWith('/orders/'+orderId));await form.locator('[type=submit]').click();assert.equal((await response).status(),200);
 assert.equal(f.state.orders[0].status,'awaiting_fulfillment');assert.equal(f.state.orders[0].paymentTopupId,101);assert.deepEqual(f.errors,[]);
});
test('switching activation to refund clears hidden account permissions and prevents an over-refund before sending',async t=>{
 const f=await supportFixture(t,environment);seed(f,{status:'awaiting_fulfillment',fulfilled:false,accepted:false,allowanceRef:'',purchaseConfirmation:{state:'confirmed',quoteHash:'a'.repeat(64),confirmedAt:at},refundedMicro:3000000,refundPendingMicro:2000000});
 const page=await f.operatorPage();await page.locator('[data-support-ticket]').click();await page.locator(`[data-order-edit="${orderId}"]`).click();await page.locator('[data-case-new]').click();
 const form=page.locator('[data-case-form]');await form.locator('[name=caseType]').selectOption('activation');await form.locator('[name=enableApiKeys]').check();await form.locator('[name=caseType]').selectOption('refund');
 assert.equal(await form.locator('[name=enableApiKeys]').isDisabled(),true);assert.equal(await form.locator('[name=refundAmount]').getAttribute('max'),'15');
 await form.locator('[name=reason]').fill('核对后申请原单退款');await form.locator('[name=evidenceNote]').fill('原会话中的客户说明');await form.locator('[name=evidenceMessageId]').selectOption('31');await form.locator('[name=refundAmount]').fill('16');
 await form.locator('[type=submit]').click();await form.locator('[data-field-error]').waitFor();assert.equal(f.calls.some(call=>call.method==='POST'&&call.path.endsWith('/cases')),false);
 await form.locator('[name=refundAmount]').fill('15');const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/cases'));await form.locator('[type=submit]').click();assert.equal((await response).status(),200);
 const created=f.calls.find(call=>call.method==='POST'&&call.path.endsWith('/cases'));assert.equal(created.body.enableApiKeys,false);assert.equal(created.body.requestedAllowanceMicro,0);assert.equal(created.body.requestedHours,0);assert.equal(created.body.requestedPlanPeriods,0);assert.equal(created.body.refundMicro,15000000);assert.deepEqual(f.errors,[]);
});
test('long customer histories render recent messages and load older records on demand without deleting history',async t=>{
 const f=await supportFixture(t,environment);seed(f);f.state.messages=Array.from({length:65},(_,i)=>({id:String(31+i),conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'user',text:`历史消息 ${i}`,attachments:[],createdAt:new Date(Date.parse(at)+i*1000).toISOString()}));
 const page=await f.customerPage();await page.locator('[data-support-message]').nth(29).waitFor();assert.equal(await page.locator('[data-support-message]').count(),30);
 await page.locator('[data-support-older]').click();assert.equal(await page.locator('[data-support-message]').count(),60);
 await page.locator('[data-support-older]').click();assert.equal(await page.locator('[data-support-message]').count(),65);assert.equal(await page.locator('[data-support-older]').count(),0);
 assert.equal(f.state.messages.length,65);assert.deepEqual(f.errors,[]);
});
