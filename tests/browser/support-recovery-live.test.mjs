import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {supportRecoveryCopy} from '../../src/i18n/support-recovery.ts';

// Real API/PG integration. The runner seeds interrupted operation claims into
// its disposable DB; this does not simulate a production process crash. No HTTP
// success or conflict response is intercepted or fabricated.
test('live recovery: stale dispute drafts recover on an explicit retry and the old pending backlog remains actionable',{timeout:180000},async t=>{
 if(process.env.FELLS_RECOVERY_LIVE!=='1'){t.skip('Requires the isolated recovery API/PG seed and built frontend');return;}
 const base=new URL(process.env.FELLS_BROWSER_BASE),password=process.env.FELLS_LIVE_TEST_PASSWORD;
 assert.equal(base.hostname,'127.0.0.1');assert.equal(base.port,'21917');assert.ok(password?.length>=12);
 const fixture=JSON.parse(await readFile(process.env.FELLS_LIFECYCLE_FIXTURE,'utf8'));
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});t.after(()=>browser.close());
 const errors=[],writes=[],checks=[];
 async function context(){const c=await browser.newContext({viewport:{width:320,height:568},reducedMotion:'reduce'});await c.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());c.on('page',p=>{p.setDefaultTimeout(20000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/dispute'))writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});});return c;}
 const customer=await context(),operator=await context(),owner=await context();
 async function http(ctx,path,method='GET',data,identity={},status=200){const r=await ctx.request.fetch(new URL(path,base).href,{method,headers:{Origin:base.origin,...identity},...(data===undefined?{}:{data})}),text=await r.text();assert.equal(r.status(),status,`${method} ${path}: ${text}`);return JSON.parse(text);}
 await http(customer,'/api/app/session','POST',{username:'business-customer',password});const bootstrap=await http(customer,'/api/app/bootstrap');
 const ci={'X-Fells-Support-Audience':'customer','X-Fells-Expected-User':String(bootstrap.user.id),'X-Fells-Expected-Session':bootstrap.session_id};
 async function login(ctx,email){await http(ctx,'/api/support/session','POST',{email,password});const s=(await http(ctx,'/api/support/session')).data;return{'X-Fells-Support-Audience':'operator','X-Fells-Expected-Operator':s.operator.id,'X-Fells-Expected-Operator-Session':s.sessionId};}
 const oi=await login(operator,'business-ops@example.invalid'),wi=await login(owner,'business-owner@example.invalid');
 const call=(ctx,identity,path,method='GET',data,status=200)=>http(ctx,path,method,data,identity,status).then(r=>r.data),op=(...args)=>call(operator,oi,...args),user=(...args)=>call(customer,ci,...args);
 const cid=String(fixture.conversationId);
 const evidence=await user(`/api/support/conversations/${cid}/messages`,'POST',{clientMessageId:randomUUID(),text:'SYNTHETIC customer reports the original delivery problem for this isolated recovery test',attachmentIds:[]});
 let order=await op(`/api/support/conversations/${cid}/orders`,'POST',{clientOrderId:randomUUID(),title:'Synthetic recovery original allowance',product:'allowance',amountMicro:5000000,serviceDays:0,note:'Verified isolated original purchase',dueAt:null});
 order=await op(`/api/support/orders/${order.id}`,'PATCH',{version:order.version,status:'awaiting_payment'});
 order=await op(`/api/support/orders/${order.id}`,'PATCH',{version:order.version,status:'awaiting_fulfillment',paymentTopupId:fixture.topupIds[0]});
 async function createCase(caseType,extra={}){return op(`/api/support/orders/${order.id}/cases`,'POST',{clientCaseId:randomUUID(),caseType,reason:'Synthetic original-order recovery test',evidenceMessageId:evidence.id,evidenceNote:'Disposable customer delivery check',requestedAllowanceMicro:0,requestedHours:0,requestedPlanPeriods:0,refundMicro:0,enableApiKeys:false,assigneeId:'',dueAt:null,...extra});}
 let activation=await createCase('activation');activation=await op(`/api/support/cases/${activation.id}/execute`,'POST',{version:activation.version});await user(`/api/support/cases/${activation.id}/accept`,'POST',{version:activation.version});
 let compensation=await createCase('compensation',{requestedAllowanceMicro:250000,reasonCode:'service_outage'});compensation=await call(owner,wi,`/api/support/cases/${compensation.id}/execute`,'POST',{version:compensation.version});
 const page=await customer.newPage();await page.goto(new URL('/app/',base).href);await page.locator('[data-support-open]').click();await page.locator('[data-customer-orders-open]').click();
 for(const[kind,id,path]of[['order',order.id,`/api/support/orders/${order.id}`],['case',compensation.id,`/api/support/cases/${compensation.id}`]]){
  const form=page.locator(`[data-${kind}-dispute="${id}"]`);await form.locator('..').locator('summary').click();const reason=`SYNTHETIC ${kind} problem; preserve my explanation after a concurrent update`;await form.locator('textarea').fill(reason);
  const latest=await op(path);await op(path,'PATCH',{version:latest.version,note:'Operator independently checked this item while the customer typed'});
  const first=page.waitForResponse(r=>new URL(r.url()).pathname===path+'/dispute'&&r.request().method()==='POST');await form.locator('[type=submit]').click();assert.equal((await first).status(),409);
  await page.getByText(supportRecoveryCopy('en').disputeUpdated,{exact:true}).waitFor();assert.equal(await form.locator('textarea').inputValue(),reason);assert.equal(writes.filter(w=>w.path===path+'/dispute').length,1);
  const retry=page.waitForResponse(r=>new URL(r.url()).pathname===path+'/dispute'&&r.request().method()==='POST');await form.locator('[type=submit]').click();assert.equal((await retry).status(),200);
  const attempted=writes.filter(w=>w.path===path+'/dispute');assert.equal(attempted.length,2);assert.equal(attempted[1].body.reason,attempted[0].body.reason);assert.equal(attempted[1].body.version,attempted[0].body.version+1);
  const saved=await user(path);assert.equal(saved.disputeReason,reason);assert.ok(saved.disputedAt);assert.equal(saved.waitingOn,'team');checks.push(`${kind}: real 409/read/manual retry, same explanation, durable dispute`);
 }
 const desk=await operator.newPage();await desk.goto(new URL('/fells-test-portal/desk/',base).href);await desk.locator(`[data-support-conversation="${cid}"]`).click();await desk.locator('[data-operations-queue]').click();
 const first=await op('/api/support/operations?status=pending&limit=100');assert.equal(first.items.length,100);assert.equal(first.totalPending,107);assert.ok(first.hasMore&&first.nextCursor);assert.equal(first.items[0].id,'30000000-0000-4000-8000-000000000001');
 await desk.locator('[data-work-backlog]').filter({hasText:'107'}).waitFor();assert.equal(await desk.locator('[data-operation]').count(),100);await desk.locator('[data-work-operation-more]').click();const late='30000000-0000-4000-8000-000000000103';await desk.locator(`[data-operation="${late}"]`).waitFor();assert.equal(await desk.locator('[data-operation]').count(),107);
 await desk.locator(`[data-operation="${late}"]`).click();await desk.locator('[data-operation-form] textarea').fill('Verified synthetic original claim never executed');const reconciled=desk.waitForResponse(r=>new URL(r.url()).pathname===`/api/support/operations/${late}/reconcile`);await desk.locator('[data-operation-form] [value=confirm_not_executed]').click();assert.equal((await reconciled).status(),200);
 const done=await op(`/api/support/operations/${late}`);assert.equal(done.status,'completed');assert.equal(done.httpStatus,409);assert.equal(done.note,'Verified synthetic original claim never executed');
 await desk.locator('[data-work-customer-id]').fill(String(fixture.otherId));await desk.locator('[data-work-customer-apply]').click();await desk.waitForFunction(()=>document.querySelectorAll('[data-operation]').length===1);assert.equal(await desk.locator('[data-operation]').getAttribute('data-operation'),'30000000-0000-4000-8000-000000000999');assert.equal(await desk.locator('[data-work-operation-more]').count(),0);
 const filtered=await op(`/api/support/operations?status=pending&limit=100&userId=${fixture.otherId}`);assert.equal(filtered.totalPending,1);assert.equal(filtered.items.length,1);await user('/api/support/operations?status=pending&limit=100','GET',undefined,403);checks.push('107 durable pending claims, oldest-first page, later-page reconciliation, isolated customer filter, customer403');
 assert.deepEqual(errors,[]);await writeFile(`${process.env.FELLS_LIFECYCLE_EVIDENCE}/frontend-recovery-live-result.json`,JSON.stringify({checks,errors,disputeWrites:writes,fixture:'Real API/PG; interrupted claims seeded, no crash simulation'},null,2));await desk.screenshot({path:`${process.env.FELLS_LIFECYCLE_EVIDENCE}/frontend-recovery-queue-320.png`,fullPage:true});
});
