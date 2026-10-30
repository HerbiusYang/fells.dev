import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture} from '../helpers/browser.mjs';
import {createAppBackend} from '../helpers/app-backend.mjs';
const fixture=createBrowserFixture();before(()=>fixture.start());after(()=>fixture.stop());
const preferences={theme:'light',prefs:{agent:'',send:0},notifs:[true,true,true,false],onboarded:true,answers:[[],[],[],[]],promoClosed:true,sbHidden:false};
async function open(t,{locale='en',viewport={width:320,height:900},...options}={}){
 const f=await fixture.setup(t,{viewport});
 const state={cash:10000000,selfKeys:false,blocked:false,mode:'success',charges:0,receipts:new Map(),buys:[],quotes:[],plans:[{code:'1000',name:'Server Token',price_micro:2000000,quota_usd_micro:3000000,burst_usd_micro:6000000,period:'month',period_days:30,new_user_only:false,enabled:true,terms_hash:'a'.repeat(64)}],...options};
 const catalog=()=>({plans:state.plans,current:state.current??null,burst_allowed:false,api_keys_will_enable:!state.selfKeys&&!state.blocked});
 const backend=createAppBackend({preferences,tokenPlans:catalog()});await backend.install(f.context);
 await f.context.route('**/api/app/bootstrap',route=>route.fulfill({json:{schema_version:1,session_id:'c'.repeat(64),user:{id:42,username:'ui-user',email:'ui-user@example.test',name:'User',joined_at:1700000000,self_keys:state.selfKeys,self_keys_exchange_blocked:state.blocked},wallet:{currency:'CNY',cash_micro:state.cash,grant_micro:100000000,grant_expires_at:1900000000},api_allowance:{currency:'USD',balance:{micro:0,expires_at:0},term_months:12,price_cny:0},agreement:{accepted:true},capabilities:{api_keys:state.selfKeys}}}));
 await f.context.route('**/api/app/plans',route=>route.fulfill({json:catalog()}));
 await f.context.route('**/api/app/subscriptions',route=>route.fulfill({json:{cash_micro:state.cash,grant_micro:0,plans:[{pool_id:11,tier:4,name:'Server Monthly',price_micro:3000000,list_price_micro:3000000,current:true,held:true},{pool_id:12,tier:2,name:'Server Upgrade',price_micro:5000000,list_price_micro:5000000,current:false,held:false,upgrade_from:11}],rides:[]}}));
 await f.context.route('**/api/app/subscriptions/upgrade-quote',route=>{const b=route.request().postDataJSON();state.quotes.push(b);return route.fulfill({json:{ok:true,quote:{from_pool:11,from_name:'Original Monthly',to_pool:12,to_tier:2,months:b.months,starts_at:1800000000,expires_at:1800000000+b.months*30*86400,applied_micro:2000000,charge_micro:5000000*b.months-2000000},max_charge_micro:5000000*b.months-1000000}});});
 for(const path of ['plans/buy','subscriptions/buy','subscriptions/upgrade'])await f.context.route(`**/api/app/${path}`,async route=>{
  const r=route.request(),body=r.postDataJSON(),key=r.headers()['idempotency-key'];state.buys.push({path,body,key,headers:r.headers()});
  if(state.receipts.has(key))return route.fulfill({json:state.receipts.get(key)});
  if(state.mode==='reconciled') { const id='00000000-0000-4000-8000-000000000990',ref=`tplan:42:${id}`;return route.fulfill({json:{ok:true,reconciled:true,operation_id:id,business_ref:ref,receipt:{kind:'token_plan',reference:ref,subscriptionId:51,cashMicro:2000000,allowanceMicro:3000000,burstAllowanceMicro:6000000,planCode:'1000',periodStart:1800000000,periodEnd:1802592000}}}); }
  if(state.mode==='unknown')return route.fulfill({status:409,json:{error:{code:'operation_pending',message:'Unknown prior outcome'}}});
  const plan=state.plans.find(p=>p.code===body.plan);
  if(path==='plans/buy'&&body.terms_hash!==plan.terms_hash)return route.fulfill({status:409,json:{error:{code:'terms_changed',message:'Offer terms changed'},transaction_rejected:true}});
  if(state.mode==='price')return route.fulfill({status:409,json:{error:{code:'price_changed',message:'Current price exceeds your limit'},transaction_rejected:true}});
  if(state.mode==='funds')return route.fulfill({status:400,json:{error:'Insufficient CNY cash',transaction_rejected:true}});
  const charge=path==='plans/buy'?plan.price_micro:path.endsWith('/upgrade')?5000000*body.months-2000000:3000000*body.months;
  state.cash-=charge;state.charges++;if(path==='plans/buy'&&!state.blocked)state.selfKeys=true;
  const receipt={ok:true,subscription:{id:51,plan_code:body.plan,pool_id:body.pool_id,tier:body.tier},balance_micro:state.cash,self_keys_enabled:state.selfKeys};state.receipts.set(key,receipt);
  if(state.mode==='lost'){state.mode='success';return route.fulfill({status:503,json:{error:'Committed response lost'}});}
  return route.fulfill({json:receipt});
 });
 await f.page.goto(f.base+(locale==='en'?'/app/':`/${locale}/app/`)+'#/billing/market');await f.page.locator('[data-act=buy-token-plan]').waitFor();
 return {...f,state,backend};
}
const selectToken=async page=>{await page.locator('[data-act=buy-token-plan][data-id="1000"]').click();await page.locator('[data-plan-review]').waitFor();};
for(const locale of ['en','zh','zh-hant','ja','ko','es'])test(`explicit CNY Token purchase preserves immutable intent through lost response and reload ${locale}`,async t=>{
 const f=await open(t,{locale,mode:'lost'}),{page,state}=f;
 assert.equal(state.buys.length,0,'funding and catalog do not buy automatically');await selectToken(page);
 const review=page.locator('[data-plan-review]');for(const text of ['Server Token','CNY 2','USD 3','USD 6','30'])assert.ok((await review.innerText()).includes(text),text);
 assert.equal(await page.locator('[data-plan-keys]').count(),1);assert.equal(state.buys.length,0,'review does not debit');
 await page.locator('[data-act=plan-confirm]').click();await page.waitForFunction(()=>!!document.querySelector('[data-plan-error]')?.textContent);
 assert.equal(state.charges,1);assert.equal(state.cash,8000000);const original=structuredClone(state.buys[0]);
 state.plans[0].terms_hash='b'.repeat(64);state.plans[0].price_micro=9000000;state.plans[0].quota_usd_micro=1;
 await page.reload();await page.locator('[data-act=buy-token-plan]').click();await page.locator('[data-plan-review]').waitFor();
 assert.ok((await page.locator('[data-plan-review]').innerText()).includes('USD 3'),'recovery retains original terms');
 await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-review]').waitFor({state:'detached'});await page.locator('[data-plan-receipt]').waitFor();await page.locator('.x[data-act=close]').click();
 assert.equal(state.charges,1);assert.equal(state.buys.length,2);assert.deepEqual(state.buys[1],original);assert.equal(Object.hasOwn(original.body,"ref"),false);assert.equal(original.body.max_charge_micro,2000000);assert.equal(original.body.terms_hash,'a'.repeat(64));assert.equal(original.headers['x-fells-expected-user'],'42');
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('fells.plan-purchase.')&&sessionStorage.getItem(k)!=='null')),false);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px layout');assert.deepEqual(f.errors,[]);
});
for(const mode of ['price','funds','terms'])test(`definite ${mode} rejection permits a fresh personal confirmation without automatic retry`,async t=>{
 const {page,state,errors}=await open(t,{mode:mode==='terms'?'success':mode});await selectToken(page);if(mode==='terms')state.plans[0].terms_hash='b'.repeat(64);
 await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-error]').filter({hasText:mode==='terms'?'Offer terms changed':mode==='price'?'Current price exceeds your limit':'Insufficient CNY cash'}).waitFor();
 assert.equal(state.charges,0);assert.equal(state.buys.length,1);const key=state.buys[0].key;await page.locator('.x[data-act=close]').click();state.mode='success';await selectToken(page);assert.equal(state.buys.length,1);await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-review]').waitFor({state:'detached'});await page.locator('[data-plan-receipt]').waitFor();await page.locator('.x[data-act=close]').click();assert.equal(state.charges,1);assert.notEqual(state.buys[1].key,key);assert.deepEqual(errors,[]);
});
test('unknown conflict keeps the original plan intent and prevents changing to monthly or FX spending',async t=>{
 const {page,state,errors}=await open(t,{mode:'unknown'});await selectToken(page);await page.locator('[data-act=plan-confirm]').click();await page.waitForFunction(()=>!!document.querySelector('[data-plan-error]')?.textContent);await page.locator('[data-act=close]').click();await page.locator('[data-act=buy-monthly]').first().click();assert.equal(await page.locator('[data-form=plan-select]').count(),0);assert.match(await page.locator('[data-plan-review]').innerText(),/Server Token/);
 await page.locator('[data-act=plan-confirm]').click();await page.waitForFunction(()=>!!document.querySelector('[data-plan-error]')?.textContent);assert.deepEqual(state.buys[0],state.buys[1]);assert.equal(state.charges,0);assert.deepEqual(errors,[]);
});
test('monthly renewal uses selected months and server CNY price, while upgrade separately confirms original credit and maximum',async t=>{
 const {page,state,errors}=await open(t,{cash:40000000,blocked:true});await page.locator('[data-act=buy-monthly][data-pool="11"]').click();await page.locator('[data-form=plan-select] [name=months]').fill('2');await page.locator('[data-form=plan-select] button').click();await page.locator('[data-plan-review]').waitFor();assert.match(await page.locator('[data-plan-review]').innerText(),/CNY 6/);assert.equal(state.buys.length,0);await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-review]').waitFor({state:'detached'});await page.locator('[data-plan-receipt]').waitFor();await page.locator('.x[data-act=close]').click();assert.deepEqual(state.buys[0].body,{pool_id:11,tier:4,months:2,max_charge_micro:6000000});assert.equal(state.selfKeys,false,'monthly does not grant developer key permissions');
 await page.locator('[data-act=upgrade-monthly]').click();await page.locator('[data-form=plan-select] [name=months]').fill('2');await page.locator('[data-form=plan-select] button').click();await page.locator('[data-plan-review]').waitFor();const text=await page.locator('[data-plan-review]').innerText();for(const item of ['Original Monthly','CNY 2','CNY 8','CNY 9','ends'])assert.ok(text.includes(item),item);assert.equal(state.buys.length,1);await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-review]').waitFor({state:'detached'});await page.locator('[data-plan-receipt]').waitFor();await page.locator('.x[data-act=close]').click();assert.deepEqual(state.buys[1].body,{from_pool:11,pool_id:12,tier:2,months:2,max_charge_micro:9000000});assert.deepEqual(state.quotes,[{from_pool:11,pool_id:12,tier:2,months:2}]);assert.deepEqual(errors,[]);
});
test('malformed or withdrawn Token terms cannot be confirmed and blocked storage prevents financial requests',async t=>{
 const {page,state,errors}=await open(t);
 const rejectedOffer=async verify=>{
  const response=page.waitForResponse(reply=>reply.request().method()==='GET'&&new URL(reply.url()).pathname==='/api/app/plans');
  await page.locator('[data-act=buy-token-plan]').click();
  verify((await (await response).json()).plans[0]);
  // A missing review before the asynchronous catalog read finishes proves
  // nothing. Wait for rejection and its session refresh before choosing again.
  await page.locator('#fx:not([aria-busy="true"])').waitFor();
  await page.locator('.toast').filter({hasText:'This offer is unavailable'}).waitFor();
  assert.equal(await page.locator('[data-act=plan-confirm]').count(),0);
  assert.equal(state.buys.length,0);
 };
 state.plans[0].terms_hash='invalid';
 await rejectedOffer(plan=>assert.equal(plan.terms_hash,'invalid'));
 state.plans[0].terms_hash='a'.repeat(64);state.plans[0].enabled=false;
 await rejectedOffer(plan=>assert.equal(plan.enabled,false));
 state.plans[0].enabled=true;await selectToken(page);
 await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('Storage blocked');};});
 await page.locator('[data-act=plan-confirm]').click();
 await page.locator('[data-plan-error]').filter({hasText:/storage/i}).waitFor();
 assert.equal(state.buys.length,0);assert.deepEqual(errors,[]);
});
test('Token purchase retains an explicit administrator key restriction and refreshes current permissions',async t=>{
 const {page,state,errors}=await open(t,{blocked:true});await selectToken(page);assert.match(await page.locator('[data-plan-keys]').innerText(),/closed|disabled|restricted/i);await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-review]').waitFor({state:'detached'});await page.locator('[data-plan-receipt]').waitFor();await page.locator('.x[data-act=close]').click();assert.equal(state.selfKeys,false);assert.equal(state.charges,1);assert.deepEqual(errors,[]);
});

test('a server-reconciled plan receipt resolves the held operation without purchasing a second time',async t=>{
 const {page,state,errors}=await open(t,{mode:'unknown'});await selectToken(page);await page.locator('[data-act=plan-confirm]').click();await page.waitForFunction(()=>!!document.querySelector('[data-plan-error]')?.textContent);const original=structuredClone(state.buys[0]);state.mode='reconciled';await page.locator('[data-act=plan-confirm]').click();await page.locator('[data-plan-review]').waitFor({state:'detached'});await page.locator('[data-plan-receipt]').waitFor();await page.locator('.x[data-act=close]').click();assert.equal(state.charges,0,'reconciliation is not a fresh checkout');assert.deepEqual(state.buys[1],original);assert.deepEqual(errors,[]);
});
