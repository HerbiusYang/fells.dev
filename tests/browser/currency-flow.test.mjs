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
  const reminders=f.state.messages.filter(m=>m.sender==='agent'&&m.text.includes('套餐与额度')&&m.text.includes('不可退款'));assert.equal(reminders.length,1,'one exchange reminder in the customer language');assert.match(reminders[0].text,/5 元/);
  assert.equal(credits,1);assert.equal(funding.length,2);assert.deepEqual(funding[0].body,funding[1].body);assert.equal(funding[0].headers['x-fells-support-audience'],'operator');assert.equal(Object.hasOwn(funding[0].body,'userId'),false);
  assert.equal(f.calls.filter(c=>c.path==='/api/app/allowance/buy').length,0);
  await f.context.route('**/api/app/allowance/quote',route=>route.fulfill({json:{quote:makeQuote()}}));
  await f.context.route('**/api/app/allowance/buy',async route=>{
    const request=route.request(),body=request.postDataJSON(),key=request.headers()['idempotency-key'];buys.push({body,key,headers:request.headers()});
    if(!exchanged.has(key)){exchanged.add(key);exchanges++;}
    if(buyLost){buyLost=false;await route.fulfill({status:503,json:{error:'Synthetic committed response lost'}});return;}
    await route.fulfill({json:{allowance:{micro:10000000},car:null,exchange:makeQuote()}});
  });
  const page=await f.context.newPage();await page.goto(`${environment.base}${locale}/app/#billing/credits`);await page.locator('[data-act=exchange]').click();await page.locator('[data-form=exchange-quote] [name=cash]').fill('7.2072');await page.locator('[data-form=exchange-quote] button').click();await page.locator('[data-act=exchange-confirm]').waitFor();
  assert.equal(await page.locator('.dlg [data-exchange-final]').count(),1,'the one-way notice is shown in the exchange dialog');const text=await page.locator('.currency-quote').textContent();for(const value of ['ECB','7.2','7.2072','0.0072','USD 1','10'])assert.ok(text.includes(value),value);assert.equal(buys.length,0);assert.equal(await page.locator('[data-exchange-keys]').count(),1);
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

test('verified CNY collection shows the original payment ID separately from its ledger ID in the Chinese mobile desk', async t => {
  const f = await supportFixture(t, environment, { viewport: { width: 320, height: 900 } });
  const calls = [];
  await f.context.route('**/api/support/conversations/21/topups', async route => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, data: { topupId: '101', ledgerId: '202', creditedCashMicro: 5_000_000, cashBalanceMicro: 17_000_000, currency: 'CNY', duplicate: false } } });
  });
  const desk = await f.operatorPage('/zh'); await desk.locator('[data-support-details]').click();
  const form = desk.locator('[data-cash-topup]');
  await form.locator('[name=amount]').fill('5'); await form.locator('[name=receipt]').fill('SYNTHETIC-original-payment');
  await form.locator('[name=memo]').fill('SYNTHETIC original receipt verified'); await form.locator('[type=submit]').click();
  await desk.locator('[data-cash-confirm]').click();
  const result = desk.locator('[data-cash-message]');
  await result.filter({ hasText: '原收款单 ID: #101' }).waitFor();
  assert.match(await result.innerText(), /账务流水编号: #202/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].amountMicro, 5_000_000);
  assert.equal(f.state.messages.filter(m => m.sender === 'agent' && m.text.includes('自行兑换美元 API 额度')).length, 1, 'the customer is told how to exchange the credited CNY');
  assert.equal(await desk.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(f.errors, []);
});
