import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

// Disposable real API + PostgreSQL + built frontend. No successful HTTP reply
// is intercepted or fabricated, and no external payment provider is called.
test('live support lifecycle: rights, channel review/reversal, reward, history and consultation', { timeout: 240000 }, async t=>{
  if(process.env.FELLS_LIFECYCLE_LIVE!=='1'){t.skip('Requires the isolated lifecycle API/DB and seeded synthetic identities');return;}
  const base=new URL(process.env.FELLS_BROWSER_BASE??'http://127.0.0.1:21887');
  assert.equal(base.hostname,'127.0.0.1');assert.equal(base.port,'21887');
  const password=process.env.FELLS_LIVE_TEST_PASSWORD;
  assert.ok(password&&password.length>=12);
  const fixture=JSON.parse(await readFile(process.env.FELLS_LIFECYCLE_FIXTURE,'utf8'));
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  t.after(()=>browser.close());
  const errors=[],checks=[];
  async function context(){const value=await browser.newContext({viewport:{width:1440,height:1050},reducedMotion:'reduce'});value.on('page',p=>{p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));});return value;}
  const customer=await context(),foreign=await context(),ops=await context(),owner=await context(),reviewer=await context();
  async function http(ctx,path,method='GET',data,identity={},status=200){
    const response=await ctx.request.fetch(new URL(path,base).href,{method,headers:{Origin:base.origin,...identity},...(data!==undefined?{data}:{})});
    const body=await response.text();assert.equal(response.status(),status,`${method} ${path}: ${body}`);
    return JSON.parse(body);
  }
  async function operator(ctx,email){await http(ctx,'/api/support/session','POST',{email,password});const s=(await http(ctx,'/api/support/session')).data;return {'X-Fells-Support-Audience':'operator','X-Fells-Expected-Operator':s.operator.id,'X-Fells-Expected-Operator-Session':s.sessionId};}
  async function loginCustomer(ctx,username){await http(ctx,'/api/app/session','POST',{username,password});const b=await http(ctx,'/api/app/bootstrap');return {'X-Fells-Support-Audience':'customer','X-Fells-Expected-User':String(b.user.id),'X-Fells-Expected-Session':b.session_id};}
  const ci=await loginCustomer(customer,'business-customer'),fi=await loginCustomer(foreign,'business-other');
  const oi=await operator(ops,'business-ops@example.invalid'),wi=await operator(owner,'business-owner@example.invalid'),ri=await operator(reviewer,'business-owner-two@example.invalid');
  const cid=String(fixture.conversationId);
  const call=(ctx,identity,path,method='GET',data,status=200)=>http(ctx,path,method,data,identity,status).then(r=>r.data);
  const asOps=(path,method,data,status)=>call(ops,oi,path,method,data,status);
  const asOwner=(path,method,data,status)=>call(owner,wi,path,method,data,status);
  const asReviewer=(path,method,data,status)=>call(reviewer,ri,path,method,data,status);
  const asCustomer=(path,method,data,status)=>call(customer,ci,path,method,data,status);
  const orderPath=id=>`/api/support/orders/${id}`,casePath=id=>`/api/support/cases/${id}`;
  const catalog=await asOps('/api/support/catalog');
  let paymentIndex=0;
  async function order(product,amountMicro,extra={}){
    let o=await asOps(`/api/support/conversations/${cid}/orders`,'POST',{clientOrderId:randomUUID(),title:`Lifecycle ${product} ${randomUUID()}`,product,amountMicro,serviceDays:0,note:'Synthetic isolated support lifecycle',dueAt:null,...extra});
    o=await asOps(orderPath(o.id),'PATCH',{version:o.version,status:'awaiting_payment'});
    return asOps(orderPath(o.id),'PATCH',{version:o.version,status:'awaiting_fulfillment',paymentTopupId:fixture.topupIds[paymentIndex++]});
  }
  const evidence=await asCustomer(`/api/support/conversations/${cid}/messages`,'POST',{clientMessageId:randomUUID(),text:'SYNTHETIC customer delivery, refund and correction evidence',attachmentIds:[]});
  async function newCase(o,caseType,extra={}){return asOps(`${orderPath(o.id)}/cases`,'POST',{clientCaseId:randomUUID(),caseType,reason:'Synthetic customer requested this specific original-order action',evidenceNote:'Original order and real sent customer message',evidenceMessageId:evidence.id,requestedAllowanceMicro:0,requestedHours:0,requestedPlanPeriods:0,refundMicro:0,enableApiKeys:false,assigneeId:'',dueAt:null,...extra});}
  async function execute(c){return asOps(`${casePath(c.id)}/execute`,'POST',{version:c.version});}
  async function approvedRefundPlan(c,mode='proportional'){
    const reason='Verified original-source recovery plan for synthetic original order';
    c=await asOps(`${casePath(c.id)}/refund-plan`,'POST',{version:c.version,action:'propose',mode,reason});
    await asOps(`${casePath(c.id)}/refund-plan`,'POST',{version:c.version,action:'approve',mode,reason},403);
    return asOwner(`${casePath(c.id)}/refund-plan`,'POST',{version:c.version,action:'approve',mode,reason});
  }
  async function channel(c,stage,id=randomUUID()){
    return asOps(`${casePath(c.id)}/refund-channel`,'POST',{version:c.version,stage,provider:'Synthetic bank',account:'Synthetic merchant',refundId:id,amountMicro:c.refundMicro,currency:'CNY',note:`SYNTHETIC independently review ${stage}`,proofMessageId:evidence.id});
  }

  // A new paid subscription is delivered through the real transaction and is
  // confirmed through the customer UI, which must disclose the reward policy.
  const plan=catalog.subscriptions.find(p=>p.enabled!==false&&p.tier===1);
  assert.ok(plan,'Seeded live subscription catalog is available');assert.ok(Number.isSafeInteger(plan.monthlyMicro)&&plan.monthlyMicro>0,'Subscription catalog uses monthlyMicro, not the Token Plan priceMicro field');
  const monthly=await order('subscription',plan.monthlyMicro,{poolId:plan.poolId,tier:1,months:1,serviceDays:30});
  let activation=await execute(await newCase(monthly,'activation',{enableApiKeys:true}));
  const userPage=await customer.newPage(),desk=await ops.newPage();
  await userPage.goto(new URL('/zh/app/',base).href);
  await userPage.locator('[data-support-open]').click();
  await userPage.locator('[data-customer-orders] > summary').click();
  await userPage.locator(`[data-case-id="${activation.id}"]`).waitFor();
  assert.match(await userPage.locator('[data-customer-orders]').innerText(),/14/);
  assert.match(await userPage.locator('[data-customer-orders]').innerText(),/0\.10|0\.1/);
  assert.match(await userPage.locator('[data-customer-orders]').innerText(),/\$5|5.*美元|5.*API/);
  const allowanceBefore=(await http(customer,'/api/app/bootstrap')).api_allowance.balance.micro;
  const acceptedReply=userPage.waitForResponse(r=>new URL(r.url()).pathname===`${casePath(activation.id)}/accept`&&r.request().method()==='POST');
  await userPage.locator(`[data-case-accept="${activation.id}"]`).click();
  assert.equal((await acceptedReply).status(),200);
  const accepted=await asCustomer(orderPath(monthly.id));
  assert.equal(accepted.acceptanceKind,'customer');assert.equal(accepted.rewardStatus,'awarded');
  assert.ok(accepted.rewardAllowanceMicro>=100000&&accepted.rewardAllowanceMicro<=3000000);
  assert.equal((await http(customer,'/api/app/bootstrap')).api_allowance.balance.micro-allowanceBefore,accepted.rewardAllowanceMicro);
  await asCustomer(`${casePath(activation.id)}/accept`,'POST',{version:activation.version},409);
  assert.equal((await http(customer,'/api/app/bootstrap')).api_allowance.balance.micro-allowanceBefore,accepted.rewardAllowanceMicro);
  checks.push('customer policy, first-new-package random reward, immutable replay');

  // Delivered API allowance is refunded by recovering only the attributable
  // original paid allowance. The separately granted reward must remain intact.
  const paid=await order('allowance',5_000_000);
  const delivery=await execute(await newCase(paid,'activation'));
  await asCustomer(`${casePath(delivery.id)}/accept`,'POST',{version:delivery.version});
  let refund=await newCase(paid,'refund',{refundMicro:2_000_000});
  await asOps(`${casePath(refund.id)}/execute`,'POST',{version:refund.version},409);
  refund=await approvedRefundPlan(refund);
  const beforeRefund=await http(customer,'/api/app/bootstrap');
  refund=await execute(refund);
  assert.equal(refund.refund.stage,'pending');assert.equal(refund.waitingOn,'team');
  assert.equal(refund.refund.recovery.allowanceMicro,2_000_000);
  const afterRefund=await http(customer,'/api/app/bootstrap');
  assert.equal(beforeRefund.api_allowance.balance.micro-afterRefund.api_allowance.balance.micro,2_000_000);
  assert.equal(beforeRefund.wallet.cash_micro,afterRefund.wallet.cash_micro);
  await asCustomer(`${casePath(refund.id)}/accept`,'POST',{version:refund.version},409);
  const paidChannelId=randomUUID();refund=await channel(refund,'unknown',paidChannelId);
  await asOwner(`${casePath(refund.id)}/reverse`,'POST',{version:refund.version,reason:'Unknown is not failed',evidenceMessageId:evidence.id},409);
  refund=await channel(refund,'paid',paidChannelId);
  await asOps(`${casePath(refund.id)}/refund-review`,'POST',{version:refund.version,note:'Self-review must fail'},403);
  refund=await asReviewer(`${casePath(refund.id)}/refund-review`,'POST',{version:refund.version,note:'Synthetic channel evidence independently reconciled'});
  assert.equal(refund.refund.stage,'paid');assert.ok(refund.acceptanceDeadline);
  refund=await asCustomer(`${casePath(refund.id)}/accept`,'POST',{version:refund.version});
  const settled=await asCustomer(orderPath(paid.id));
  assert.equal(settled.refundedMicro,2_000_000);assert.equal(settled.refundPendingMicro,0);assert.equal(settled.afterSalesStatus,'settled');
  checks.push('delivered original-source recovery, independent reviewed payment, partial settlement');

  // An unfulfilled cash refund that is confirmed failed is corrected by an
  // append-only reversal, never by resetting or overwriting its receipt.
  const unfulfilled=await order('allowance',2_000_000);
  let failed=await newCase(unfulfilled,'refund',{refundMicro:1_000_000});
  const cashBefore=(await http(customer,'/api/app/bootstrap')).wallet.cash_micro;
  failed=await execute(failed);
  assert.equal((await http(customer,'/api/app/bootstrap')).wallet.cash_micro,cashBefore-1_000_000);
  await asOps(`${casePath(failed.id)}/refund-channel`,'POST',{version:failed.version,stage:'paid',provider:' SYNTHETIC BANK ',account:' SYNTHETIC MERCHANT ',refundId:paidChannelId.toUpperCase(),amountMicro:failed.refundMicro,currency:'CNY',note:'Duplicate normalized receipt must fail',proofMessageId:evidence.id},409);
  const originalReceipt=failed.receipt;
  failed=await channel(failed,'failed');
  failed=await asReviewer(`${casePath(failed.id)}/refund-review`,'POST',{version:failed.version,note:'Synthetic confirmed-not-paid, restore the original reserved cash'});
  assert.ok(failed.reversedAt&&failed.reversalRef);assert.deepEqual(failed.receipt,originalReceipt);
  assert.equal((await http(customer,'/api/app/bootstrap')).wallet.cash_micro,cashBefore);
  await asCustomer(`${casePath(failed.id)}/accept`,'POST',{version:failed.version},409);
  checks.push('normalized channel identity deduplication, failed payout reversal, original receipt preserved');

  // Explicit customer disagreement is a real server transition and is shown
  // prominently instead of silently remaining in the acceptance queue.
  let compensation=await newCase(paid,'compensation',{requestedAllowanceMicro:250000,reasonCode:'service_outage'});
  await asOps(`${casePath(compensation.id)}/execute`,'POST',{version:compensation.version},403);
  compensation=await asOwner(`${casePath(compensation.id)}/execute`,'POST',{version:compensation.version});
  await userPage.reload();await userPage.locator('[data-support-open]').click();
  await userPage.locator('[data-customer-orders] > summary').click();
  await userPage.locator(`[data-case-id="${compensation.id}"] [data-dispute] > summary`).click();
  const complaint=userPage.locator(`[data-case-id="${compensation.id}"] [data-case-dispute]`);
  await complaint.locator('[name=reason]').fill('SYNTHETIC customer reports a remaining delivery problem');
  const disputedReply=userPage.waitForResponse(r=>new URL(r.url()).pathname===`${casePath(compensation.id)}/dispute`&&r.request().method()==='POST');
  await complaint.locator('[type=submit]').click();assert.equal((await disputedReply).status(),200);
  const disputed=await asCustomer(casePath(compensation.id));assert.ok(disputed.disputedAt);assert.equal(disputed.waitingOn,'team');
  await asCustomer(`${casePath(compensation.id)}/accept`,'POST',{version:disputed.version},409);
  checks.push('customer disagreement button, server dispute, acceptance blocked');

  // More than 100 real persisted orders must remain reachable to both sides.
  for(let i=0;i<104;i++)await asOps(`/api/support/conversations/${cid}/orders`,'POST',{clientOrderId:randomUUID(),title:`History consultation ${i}`,product:'other',amountMicro:1_000_000,serviceDays:0,note:'Synthetic historical order',dueAt:null});
  const first=await asCustomer(`/api/support/conversations/${cid}/orders?limit=100`);assert.ok(first.nextCursor&&first.hasMore);
  const next=await asCustomer(`/api/support/conversations/${cid}/orders?limit=100&cursor=${encodeURIComponent(first.nextCursor)}`);assert.ok(next.items.length);
  assert.equal(new Set([...first.items,...next.items].map(o=>o.id)).size,first.items.length+next.items.length);
  await userPage.reload();await userPage.locator('[data-support-open]').click();await userPage.locator('[data-customer-orders] > summary').click();
  const more=userPage.locator('[data-customer-order-more]');if(await more.count())await more.click();
  await desk.goto(new URL('/zh/fells-test-portal/desk/',base).href);
  await desk.locator(`[data-support-conversation="${cid}"]`).click();
  assert.ok([...first.items,...next.items].some(o=>o.source==='self_service'),'Real historical wallet purchases are included without a fake payment link');
  const sharedOrder=first.items[0];
  const sharedReply=userPage.waitForResponse(r=>new URL(r.url()).pathname===`/api/support/conversations/${cid}/messages`&&r.request().method()==='POST');
  await userPage.locator(`[data-order-share="${sharedOrder.id}"]`).click();
  const shareResponse=await sharedReply;assert.equal(shareResponse.status(),200);
  const share=(await shareResponse.json()).data;assert.equal(share.orderId,sharedOrder.id);assert.equal(share.orderTitle,sharedOrder.title);
  await desk.locator(`[data-support-order="${sharedOrder.id}"]`).waitFor();
  await desk.locator(`[data-support-order="${sharedOrder.id}"]`).click();
  await desk.locator('[data-order-editor] h4').filter({hasText:sharedOrder.id}).waitFor();
  await call(foreign,fi,orderPath(sharedOrder.id),'GET',undefined,404);
  await call(foreign,fi,`/api/support/conversations/${cid}/messages`,'POST',{clientMessageId:randomUUID(),orderId:sharedOrder.id},404);
  checks.push('real order cursor beyond 100, customer history consultation card, desk opens original, tenant isolation');
  const evidenceDir=process.env.FELLS_LIFECYCLE_EVIDENCE??'/evidence';
  await userPage.screenshot({path:`${evidenceDir}/live-customer-policy-history.png`,fullPage:true});
  await desk.screenshot({path:`${evidenceDir}/live-desk-original-order.png`,fullPage:true});
  await userPage.setViewportSize({width:390,height:844});
  await userPage.screenshot({path:`${evidenceDir}/live-customer-390.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile(`${evidenceDir}/live-lifecycle-result.json`,JSON.stringify({realApi:true,realPostgres:true,httpMocks:false,externalPaymentCalls:false,checks,randomRewardMicro:accepted.rewardAllowanceMicro,passed:true},null,2));
});
