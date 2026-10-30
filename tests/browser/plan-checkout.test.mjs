import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';
const fixture=createBrowserFixture(); before(()=>fixture.start()); after(()=>fixture.stop());
const preferences={theme:'light',prefs:{agent:'',send:0},notifs:[true,true,true,false],onboarded:true,answers:[[0],[0],[0],[0]],promoClosed:true,sbHidden:false};
const id='00000000-0000-4000-8000-000000000991';
const receipt=(status='pending')=>({operation_id:id,kind:'token_plan',route:'/api/app/plans/buy',created_at:'2026-10-30T00:00:00Z',status,outcome:status,poll_only:true,acknowledged:false,evidence:{cash_micro:2000000,allowance_micro:3000000,subscription_id:51,period_start:1800000000,period_end:1802592000}});
async function open(t,{locale='en',status,operations}={}) {
 const f=await fixture.setup(t,{viewport:{width:320,height:900}});
 await f.page.addInitScript(()=>{window.manualIntents=[];document.addEventListener('fells:support-open',event=>{window.manualIntents.push(event.detail);event.stopImmediatePropagation();},true);});
 const backend=createAppBackend({preferences,tokenPlans:{plans:[{code:'server-token',name:'Server Token',enabled:true,new_user_only:false,price_micro:2000000,quota_usd_micro:3000000,burst_usd_micro:6000000,period_days:30}],current:null}});
 await backend.install(f.context);
 await f.context.route('**/api/app/subscriptions',route=>route.fulfill({json:{plans:[{pool_id:11,name:'Server Monthly',price_micro:3000000,period_days:30,tier:4,free:1,capacity:4}],rides:[]}}));
 const calls=[];
 await f.context.route('**/api/app/purchase-operations/**',async route=>{
  const request=route.request(),url=new URL(request.url());calls.push({method:request.method(),path:url.pathname,body:request.postData()});
  if(url.pathname.endsWith('/unconfirmed')) return route.fulfill({json:{operations:operations??(status?[receipt(status)]:[]),has_more:false}});
  if(url.pathname.endsWith('/acknowledge')) return route.fulfill({json:{ok:true}});
  return route.fulfill({json:receipt(status)});
 });
 await f.page.goto(f.base+(locale==='en'?'/app/':`/${locale}/app/`)+'#/billing/market');
 await f.page.locator('.market-plan').waitFor();return {...f,backend,calls};
}
for(const locale of ['en','zh','zh-hant','ja','ko','es'])test(`manual sales preserves selected server terms and never buys from the account ${locale}`,async t=>{
 const {page,backend,errors}=await open(t,{locale});
 await page.locator('.market-plan [data-act=contact-purchase]').click();
 await page.locator('.market-subscription [data-act=contact-purchase]').click();
 const intents=await page.evaluate(()=>window.manualIntents);
 assert.equal(intents.length,2);assert.equal(intents[0].product,'token_plan');assert.equal(intents[0].publicCode,'server-token');assert.equal(intents[0].amountMicro,2000000);assert.equal(intents[0].serviceDays,30);
 assert.equal(intents[1].product,'subscription');assert.equal(intents[1].poolId,11);assert.equal(intents[1].amountMicro,3000000);assert.match(intents[1].title,/1\/4/);
 assert.equal(await page.locator('[data-act=buy-token-plan],[data-act=buy-monthly],[data-act=plan-confirm],[data-act=exchange-confirm]').count(),0);
 assert.deepEqual(backend.state.writes,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
});
for(const status of ['pending','completed','rejected'])test(`historical ${status} operation is read-only until explicit terminal acknowledgement`,async t=>{
 const {page,backend,calls,errors}=await open(t,{status});
 await page.locator('.market-account-link').click();await page.locator('[data-purchase-operations] [data-act=operation-get]').click();
 const panel=page.locator('[data-operation-receipt]');await panel.waitFor();assert.match(await panel.innerText(),/CNY 2/);assert.match(await panel.innerText(),/USD 3/);
 assert.equal(calls.some(c=>c.method==='POST'),false);assert.equal(await panel.locator('[data-act=operation-ack]').count(),status==='pending'?0:1);
 if(status==='pending') {await panel.locator('[data-act=operation-get]').click();assert.equal(calls.some(c=>c.method==='POST'),false);}
 else {await panel.locator('[data-act=operation-ack]').click();await panel.waitFor({state:'detached'});assert.deepEqual(calls.filter(c=>c.method==='POST').map(c=>c.path),[`/api/app/purchase-operations/${id}/acknowledge`]);}
 assert.equal(backend.state.writes.some(w=>/\/buy|\/upgrade|allowance\/quote/.test(w.path??'')),false);assert.deepEqual(errors,[]);
});
test('historical unknown operation remains discoverable after page reload without any replay',async t=>{
 const {page,calls,errors}=await open(t,{status:'pending'});await page.locator('.market-account-link').click();await page.reload();await page.locator('[data-purchase-operations] [data-act=operation-get]').click();await page.locator('[data-operation-receipt]').waitFor();assert.ok(calls.filter(c=>c.path.endsWith('/unconfirmed')).length>=2);assert.equal(calls.some(c=>c.method!=='GET'),false);assert.deepEqual(errors,[]);
});
