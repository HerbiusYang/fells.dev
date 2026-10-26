import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, locales } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async()=>{environment=await supportBrowser();});
test.after(async()=>{await environment?.close();});
const makeQuote=()=>({id:'00000000-0000-4000-8000-000000000901',source:'ECB',api_keys_will_enable:true,as_of:new Date().toISOString().slice(0,10),fetched_at:new Date().toISOString(),expires_at:new Date(Date.now()+120000).toISOString(),fee_bp:10,reference_rate:'7.2',effective_rate:'7.2072',cash_micro:7207200,principal_cash_micro:7200000,fee_cny_micro:7200,usd_micro:1000000,currency:'USD'});
for(const locale of locales) test(`CNY funding and independent customer exchange, lost result recovery and mobile layout ${locale||'en'}`,async t=>{
  const f=await supportFixture(t,environment,{viewport:{width:320,height:900}});
  const funding=[], buys=[];let topupLost=true,buyLost=true,credits=0,exchanges=0;const credited=new Set(),exchanged=new Set();
  await f.context.route('**/api/support/conversations/21/topups',async route=>{
    const body=route.request().postDataJSON();funding.push({body,headers:route.request().headers()});
    if(!credited.has(body.operationId)){credited.add(body.operationId);credits++;}
    if(topupLost){topupLost=false;await route.fulfill({status:503,json:{ok:false,error:{message:'Synthetic committed response lost'}}});return;}
    await route.fulfill({json:{ok:true,data:{topupId:'101',ledgerId:'202',creditedCashMicro:body.amountMicro,cashBalanceMicro:17000000,currency:'CNY',duplicate:true}}});
  });
  const desk=await f.operatorPage(locale);await desk.locator('[data-support-details]').click();
  const topup=desk.locator('[data-cash-topup]');await topup.locator('[name=amount]').fill('5');await topup.locator('[name=receipt]').fill('bank-receipt-001');await topup.locator('[name=memo]').fill('Actual received CNY, verified customer');await topup.locator('[type=submit]').click();
  assert.equal(funding.length,0,'review does not submit funds');assert.equal(await desk.locator('.support-cash-topup [name=usd]').count(),0);
  await desk.locator('[data-cash-confirm]').click();await desk.locator('[data-cash-confirm]:not([disabled])').waitFor();
  assert.equal(funding.length,1);await desk.reload();await desk.locator('[data-support-conversation="21"]').click();await desk.locator('[data-support-details]').click();
  await desk.locator('[data-cash-confirm]').click();await desk.locator('[data-cash-topup]').waitFor();
  assert.equal(credits,1);assert.equal(funding.length,2);assert.deepEqual(funding[0].body,funding[1].body);assert.equal(funding[0].headers['x-fells-support-audience'],'operator');assert.equal(Object.hasOwn(funding[0].body,'userId'),false);
  await desk.locator('[data-order-new]').click();for(const product of ['allowance','token_plan','subscription'])assert.equal(await desk.locator(`[name=product] option[value=${product}]`).count(),0);
  assert.equal(f.calls.filter(c=>c.path==='/api/app/allowance/buy').length,0);
  await f.context.route('**/api/app/allowance/quote',route=>route.fulfill({json:{quote:makeQuote()}}));
  await f.context.route('**/api/app/allowance/buy',async route=>{
    const request=route.request(),body=request.postDataJSON(),key=request.headers()['idempotency-key'];buys.push({body,key,headers:request.headers()});
    if(!exchanged.has(key)){exchanged.add(key);exchanges++;}
    if(buyLost){buyLost=false;await route.fulfill({status:503,json:{error:'Synthetic committed response lost'}});return;}
    await route.fulfill({json:{allowance:{micro:10000000},car:null,exchange:makeQuote()}});
  });
  const page=await f.context.newPage();await page.goto(`${environment.base}${locale}/app/#billing/credits`);await page.locator('[data-act=exchange]').click();await page.locator('[data-form=exchange-quote] [name=cash]').fill('7.2072');await page.locator('[data-form=exchange-quote] button').click();await page.locator('[data-act=exchange-confirm]').waitFor();
  const text=await page.locator('.currency-quote').textContent();for(const value of ['ECB','7.2','7.2072','0.0072','USD 1','10'])assert.ok(text.includes(value),value);assert.equal(buys.length,0);assert.equal(await page.locator('[data-exchange-keys]').count(),1);
  await page.locator('[data-act=exchange-confirm]').click();await page.locator('[data-act=exchange-confirm]:not([disabled])').waitFor();await page.reload();await page.locator('[data-act=exchange]').click();
  assert.equal(await page.locator('[data-form=exchange-quote]').count(),0,'unknown operation cannot be replaced with a new quote');
  await page.locator('[data-act=exchange-confirm]').click();await page.locator('[data-act=exchange-confirm]').waitFor({state:'detached'});
  assert.equal(exchanges,1);assert.equal(buys.length,2);assert.deepEqual(buys[0],buys[1]);assert.deepEqual(buys[0].body,{cash_micro:7207200,quote_id:makeQuote().id});assert.equal(buys[0].headers['x-fells-expected-user'],'42');
  for(const p of [desk,page])assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'320px no horizontal document overflow');
  assert.deepEqual(f.errors,[]);
});
test('failed or expired ECB quotes leave balances usable and cannot debit CNY',async t=>{
  const f=await supportFixture(t,environment);let available=false,buyCount=0;
  await f.context.route('**/api/app/allowance/quote',route=>available?route.fulfill({json:{quote:makeQuote()}}):route.fulfill({status:503,json:{error:'ECB unavailable'}}));
  await f.context.route('**/api/app/allowance/buy',route=>{buyCount++;return route.fulfill({status:500,json:{error:'must not be called'}});});
  const page=await f.context.newPage();await page.goto(`${environment.base}/app/#billing/credits`);await page.locator('[data-act=exchange]').click();await page.locator('[name=cash]').fill('7.2072');await page.locator('[data-form=exchange-quote] button').click();await page.locator('[data-exchange-error]').filter({hasText:'unavailable'}).waitFor();assert.equal(await page.locator('[data-act=exchange-confirm]').count(),0);
  available=true;await page.locator('[data-form=exchange-quote] button').click();await page.locator('[data-act=exchange-confirm]').waitFor();await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+300000;});await page.locator('[data-act=exchange-confirm]').click();await page.locator('[data-exchange-error]').filter({hasText:'expired'}).waitFor();assert.equal(buyCount,0);assert.ok(await page.locator('[data-currency-exchange]').count());
});
test('a rejected duplicate receipt restores editable CNY input, while an unknown conflict retains its operation',async t=>{
  const f=await supportFixture(t,environment);let rejected=true;const calls=[];
  await f.context.route('**/api/support/conversations/21/topups',async route=>{
    calls.push(route.request().postDataJSON());
    await route.fulfill({status:409,json:{ok:false,error:{code:rejected?'receipt_conflict':'operation_conflict',message:rejected?'Receipt already credited':'Operation outcome unknown'},...(rejected?{transaction_rejected:true}:{})}});
  });
  const desk=await f.operatorPage('');await desk.locator('[data-support-details]').click();
  const form=desk.locator('[data-cash-topup]');await form.locator('[name=amount]').fill('5');await form.locator('[name=receipt]').fill('duplicate-bank-receipt');await form.locator('[name=memo]').fill('CNY verification');await form.locator('[type=submit]').click();await desk.locator('[data-cash-confirm]').click();
  await desk.locator('[data-cash-message]').filter({hasText:'Receipt already credited'}).waitFor();assert.equal(await form.locator('[name=receipt]').inputValue(),'duplicate-bank-receipt');
  rejected=false;await form.locator('[name=receipt]').fill('different-receipt');await form.locator('[type=submit]').click();await desk.locator('[data-cash-confirm]').click();await desk.locator('[data-cash-confirm]:not([disabled])').waitFor();assert.equal(await desk.locator('[data-cash-topup]').count(),0);
  await desk.locator('[data-cash-confirm]').click();await desk.locator('[data-cash-confirm]:not([disabled])').waitFor();assert.equal(calls.length,3);assert.notEqual(calls[0].operationId,calls[1].operationId);assert.deepEqual(calls[1],calls[2]);assert.deepEqual(f.errors,[]);
});
for(const notify of [false,true,'afterOpen'])test(`a customer already showing zero CNY can quote new funding through ${notify===true?'authenticated wallet SSE':notify==='afterOpen'?'funding after the form already opened':'fresh balance on opening exchange'}`,async t=>{
  const f=await supportFixture(t,environment);let cash=0,reads=0,quotes=0;
  await f.context.route('**/api/app/bootstrap',async route=>{
    reads++;await route.fulfill({json:{schema_version:1,session_id:'a'.repeat(64),user:{id:42,username:'customer',name:'Customer',email:'customer@example.test',joined_at:1700000000,self_keys:true},wallet:{currency:'CNY',cash_micro:cash,grant_micro:0,grant_expires_at:0},api_allowance:{currency:'USD',balance:{micro:0,expires_at:0},term_months:12,exchange_policy:{source:'ECB',fee_bp:10}},agreement:{accepted:true},capabilities:{api_keys:true}}});
  });
  await f.context.route('**/api/app/allowance/quote',route=>{quotes++;return route.fulfill({json:{quote:makeQuote()}});});
  const page=await f.context.newPage(),baseline=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/bootstrap'&&reads>=2);
  await page.goto(`${environment.base}/app/#/billing/credits`);await baseline;await page.locator('[data-act=exchange]').waitFor();assert.equal(await page.locator('.wallet-summary-card.is-primary .wallet-summary-value').innerText(),'¥0.00');
  if(notify===true)await page.locator('[data-support-open]').click();
  if(notify==='afterOpen'){await page.locator('[data-act=exchange]').click();assert.equal(await page.locator('[data-exchange-cash]').innerText(),'CNY 0');}
  cash=20_000_000;
  if(notify===true){
    const updated=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/bootstrap');
    f.state.sseEvents.push({audience:'customer',type:'wallet.updated',data:{conversationId:'21',cashMicro:999999999999}});await updated;
    await page.locator('.wallet-summary-card.is-primary .wallet-summary-value').filter({hasText:'20.00'}).waitFor();await page.locator('[data-support-close]').click();
  }
  if(notify!=='afterOpen'){await page.locator('[data-act=exchange]').click();assert.equal(await page.locator('[data-exchange-cash]').innerText(),'CNY 20');}
  await page.locator('[name=cash]').fill('7.2072');await page.locator('[data-form=exchange-quote] button').click();await page.locator('[data-act=exchange-confirm]').waitFor();assert.equal(quotes,1);assert.deepEqual(f.errors,[]);
});

for(const matches of [true,false])test(`FX operator reconciliation ${matches?'resolves matching':'retains mismatched'} original money intent`,async t=>{
 const f=await supportFixture(t,environment);let ready=false;const buys=[],quote=makeQuote();
 await f.context.route('**/api/app/allowance/quote',route=>route.fulfill({json:{quote}}));
 await f.context.route('**/api/app/allowance/buy',route=>{
  const req=route.request();buys.push({key:req.headers()['idempotency-key'],body:req.postDataJSON()});
  if(!ready)return route.fulfill({status:503,json:{error:'Operation requires reconciliation'}});
  return route.fulfill({json:{ok:true,reconciled:true,operation_id:'00000000-0000-4000-8000-000000000990',business_ref:'original-exchange',receipt:{kind:'allowance',reference:'original-exchange',cashMicro:quote.cash_micro,allowanceMicro:matches?quote.usd_micro:1}}});
 });
 const page=await f.context.newPage();await page.goto(`${environment.base}/app/#/billing/credits`);await page.locator('[data-act=exchange]').click();await page.locator('[name=cash]').fill('7.2072');await page.locator('[data-form=exchange-quote] button').click();await page.locator('[data-act=exchange-confirm]').click();await page.waitForFunction(()=>!!document.querySelector('[data-exchange-error]')?.textContent);ready=true;await page.reload();await page.locator('[data-act=exchange]').click();await page.locator('[data-act=exchange-confirm]').click();
 if(matches)await page.locator('[data-act=exchange-confirm]').waitFor({state:'detached'});else await page.waitForFunction(()=>!!document.querySelector('[data-exchange-error]')?.textContent);
 assert.deepEqual(buys[0],buys[1]);assert.equal(buys.length,2);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('fells.exchange.'))),!matches);assert.deepEqual(f.errors,[]);
});

for (const scenario of [
  { status: 400, error: 'API 额度暂未开放兑换', expected: 'exchange is not currently open' },
  { status: 403, error: 'Only the signed-in customer may request this quote', expected: 'Only the signed-in customer' },
  { status: 500, error: 'Synthetic service error', expected: 'Synthetic service error' },
  { status: 503, error: 'ECB 参考汇率暂不可用，请稍后重新报价', expected: 'fresh ECB quote is unavailable', ecb: true },
  { status: 503, error: 'Synthetic origin policy error', expected: 'Synthetic origin policy error' },
  { status: 200, malformed: true, expected: 'invalid quote' },
  { network: true, expected: 'Check your connection' },
]) test(`quote failures retain their actual cause without claiming ECB is stale: ${scenario.error || scenario.expected}`, async t => {
  const f = await supportFixture(t, environment); let buys = 0;
  await f.context.route('**/api/app/allowance/quote', route => scenario.network ? route.abort('failed') : route.fulfill({ status: scenario.status, json: scenario.malformed ? { quote: { ...makeQuote(), currency: 'CNY' } } : { error: scenario.error } }));
  await f.context.route('**/api/app/allowance/buy', route => { buys++; return route.fulfill({ status: 500, json: { error: 'No financial action is permitted in a quote failure test' } }); });
  const page = await f.context.newPage(); await page.goto(`${environment.base}/app/#/billing/credits`);
  await page.locator('[data-act=exchange]').click(); await page.locator('[data-form=exchange-quote] [name=cash]').fill('7.2072');
  await page.locator('[data-form=exchange-quote] button').click();
  await page.locator('[data-exchange-error]').filter({ hasText: scenario.expected }).waitFor();
  const error = await page.locator('[data-exchange-error]').innerText();
  if (!scenario.ecb) assert.doesNotMatch(error, /fresh ECB quote|ECB 参考汇率/);
  assert.equal(await page.locator('[name=cash]').inputValue(), '7.2072');
  assert.equal(await page.locator('[data-act=exchange-confirm]').count(), 0);
  assert.equal(buys, 0); assert.deepEqual(f.errors, []);
});
