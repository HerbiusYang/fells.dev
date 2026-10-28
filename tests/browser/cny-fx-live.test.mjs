import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { prepareSupportOperator } from './helpers/support-live-session.mjs';

// All product replies and money movements come from the actual Go API and PG.
// Interception only loses the response AFTER the real transaction committed.
test('real CNY collection and customer ECB exchange: authority, exact money, lost replies and receipt isolation', {timeout:180000}, async t => {
  if (process.env.FELLS_CNY_FX_LIVE !== '1') { t.skip('Requires the isolated real Access, Go API and disposable DB'); return; }
  assert.equal(process.env.FELLS_ACCESS_BROWSER_TEST, '1');
  const consoleBase = new URL(process.env.FELLS_ACCESS_CONSOLE_BASE), publicBase = new URL(process.env.FELLS_ACCESS_PUBLIC_BASE);
  for (const base of [consoleBase,publicBase]) { assert.equal(base.hostname,'127.0.0.1'); assert.equal(base.protocol,'http:'); assert.equal(base.username+base.password+base.search+base.hash,''); }
  assert.notEqual(consoleBase.origin,publicBase.origin);
  const evidence=process.env.FELLS_ACCESS_EVIDENCE_DIR; assert.ok(evidence); await mkdir(evidence,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
  const livePages=[];
  t.after(async()=>{for(const [index,page] of livePages.entries())if(!page.isClosed()){await page.screenshot({path:resolve(evidence,`cny-fx-final-${index}.png`),fullPage:true,animations:'disabled',timeout:10000}).catch(()=>{});await writeFile(resolve(evidence,`cny-fx-final-${index}.json`),JSON.stringify({url:page.url(),body:(await page.locator('body').innerText({timeout:2000}).catch(()=>'' )).slice(0,12000)},null,2));}await browser.close();},{timeout:40000});
  const errors=[], funding=[], exchanges=[], plans=[], receipts={};
  async function context() {
    const ctx=await browser.newContext({viewport:{width:320,height:900},reducedMotion:'reduce'});
    await ctx.route('**/*',route=>[consoleBase.origin,publicBase.origin].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
    ctx.on('page',page=>{page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));}); return ctx;
  }
  const customers=await context(), operators=await context(), outsiders=await context();
  const user=await customers.newPage(),desk=await operators.newPage(),other=await outsiders.newPage();
  livePages.push(user,desk,other);
  const raw=(ctx,base,path,options={})=>ctx.request.fetch(new URL(path,base).href,{...options,headers:{Origin:base.origin,...options.headers}});
  async function json(ctx,base,path,options={},status=200) { const response=await raw(ctx,base,path,options); assert.equal(response.status(),status,`${path}: ${await response.text()}`);return response.json(); }
  async function login(page,name) {
    await page.goto(new URL('/zh/app/start/',publicBase).href);await page.locator('#auth-email').fill(name);await page.locator('#auth-password').fill('support-browser-password');await page.locator('[data-auth-form] [type=submit]').click();await page.waitForURL(url=>/^\/zh\/app\/?$/.test(url.pathname));
    await page.waitForFunction(()=>document.querySelector('#fx')?.getAttribute('aria-busy')!=='true');
  }
  const bootstrap=()=>json(customers,publicBase,'/api/app/bootstrap');
  const customerHeaders=b=>({'X-Fells-Support-Audience':'customer','X-Fells-Expected-User':String(b.user.id),'X-Fells-Expected-Session':b.session_id});
  await login(user,'support-browser-other'); const initial=await bootstrap(); assert.equal(initial.wallet.cash_micro,0);assert.equal(initial.api_allowance.balance.micro,0);
  const customerIdentity=customerHeaders(initial);
  await user.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
  const conversation=(await json(customers,publicBase,'/api/support/conversations/current',{headers:customerIdentity})).data;
  assert.equal(String(conversation.customer.id),String(initial.user.id));
  assert.equal((await raw(operators,consoleBase,'/__support_access_fixture/identity',{method:'POST',data:{identity:'ops'}})).status(),204);
  const session=await prepareSupportOperator(operators,{base:consoleBase});
  const agentIdentity={'X-Fells-Support-Audience':'operator','X-Fells-Expected-Operator':session.operator.id,'X-Fells-Expected-Operator-Session':session.sessionId};
  await desk.goto(new URL('/zh/support/desk/',consoleBase).href);await desk.locator(`[data-support-conversation="${conversation.id}"]`).click();await desk.locator('[data-support-details]').click();
  assert.equal(await desk.locator('input[type=password]').count(),0);
  const topupPath=`/api/support/conversations/${conversation.id}/topups`,receiptRef=`SYNTHETIC-bank-${randomUUID()}`;
  let loseFunding=true;
  await desk.route(`**${topupPath}`,async route=>{
    if(route.request().method()!=='POST')return route.continue();funding.push(route.request().postDataJSON());
    if(!loseFunding)return route.continue();loseFunding=false;
    const committed=await route.fetch();assert.equal(committed.status(),200,await committed.text());receipts.collection=await committed.json();
    await route.fulfill({status:503,json:{ok:false,error:{code:'synthetic_response_lost',message:'Committed response deliberately lost'}}});
  });
  const form=desk.locator('[data-cash-topup]');await form.locator('[name=amount]').fill('20');await form.locator('[name=receipt]').fill(receiptRef);await form.locator('[name=memo]').fill('SYNTHETIC verified actual CNY bank receipt');await form.locator('[type=submit]').click();
  assert.equal(funding.length,0);assert.equal((await bootstrap()).wallet.cash_micro,0,'Review itself cannot credit funds');
  await desk.screenshot({path:resolve(evidence,'cny-fx-cny-review-320.png'),fullPage:true,animations:'disabled',timeout:10000});
  const lostFundingReply=desk.waitForResponse(response=>new URL(response.url()).pathname===topupPath&&response.request().method()==='POST');
  await desk.locator('[data-cash-confirm]').click();assert.equal((await lostFundingReply).status(),503);await desk.locator('[data-cash-confirm]:enabled').waitFor();
  const funded=await bootstrap();assert.equal(funded.wallet.cash_micro,20_000_000);assert.equal(funded.api_allowance.balance.micro,0,'Staff collection grants CNY only');assert.equal(funded.user.self_keys,initial.user.self_keys,'Collection does not change key permissions');
  await desk.reload();await desk.locator(`[data-support-conversation="${conversation.id}"]`).click();await desk.locator('[data-support-details]').click();await desk.locator('[data-cash-confirm]').click();await desk.locator('[data-cash-topup]').waitFor();
  assert.equal(funding.length,2);assert.deepEqual(funding[0],funding[1]);assert.equal((await bootstrap()).wallet.cash_micro,20_000_000,'Lost collection reply is recovered without a second credit');
  const duplicate=(await json(operators,consoleBase,topupPath,{method:'POST',headers:agentIdentity,data:{...funding[0],operationId:randomUUID()}})).data;assert.equal(duplicate.duplicate,true);assert.equal(duplicate.topupId,receipts.collection.data.topupId);
  await json(operators,consoleBase,topupPath,{method:'POST',headers:agentIdentity,data:{...funding[0],operationId:randomUUID(),amountMicro:1_000_000}},409);
  const customerDenied=await raw(customers,publicBase,topupPath,{method:'POST',headers:customerIdentity,data:{...funding[0],operationId:randomUUID()}});assert.ok([401,403].includes(customerDenied.status()));
  const crossOrigin=await raw(operators,consoleBase,topupPath,{method:'POST',headers:{...agentIdentity,Origin:'https://untrusted.example.invalid'},data:{...funding[0],operationId:randomUUID()}});assert.ok([401,403].includes(crossOrigin.status()));
  await desk.locator('[data-order-new]').click();for(const product of ['allowance','token_plan','subscription'])assert.equal(await desk.locator(`[name=product] option[value=${product}]`).count(),0);
  await login(other,'support-browser-third');const third=await json(outsiders,publicBase,'/api/app/bootstrap');await other.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
  const thirdConversation=(await json(outsiders,publicBase,'/api/support/conversations/current',{headers:customerHeaders(third)})).data;
  await json(operators,consoleBase,`/api/support/conversations/${thirdConversation.id}/topups`,{method:'POST',headers:agentIdentity,data:{...funding[0],operationId:randomUUID()}},409);
  assert.equal((await json(outsiders,publicBase,'/api/app/bootstrap')).wallet.cash_micro,0);

  let loseExchange=true;
  await user.route('**/api/app/allowance/buy',async route=>{
    const request=route.request();exchanges.push({body:request.postDataJSON(),key:request.headers()['idempotency-key']});
    if(!loseExchange)return route.continue();loseExchange=false;
    const committed=await route.fetch();assert.equal(committed.status(),200,await committed.text());receipts.exchange=await committed.json();
    await route.fulfill({status:503,json:{error:'Committed exchange response deliberately lost'}});
  });
  await user.goto(new URL('/zh/app/#/billing/credits',publicBase).href);await user.locator('[data-act=exchange]').click();await user.locator('[data-form=exchange-quote] [name=cash]').fill('7.2072');
  const quoted=user.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/allowance/quote');await user.locator('[data-form=exchange-quote] button').click();
  const quote=(await (await quoted).json()).quote;assert.equal(quote.source,'ECB');assert.equal(quote.fee_bp,10);assert.equal(Number(quote.reference_rate),7.2);assert.equal(Number(quote.effective_rate),7.2072);assert.equal(quote.fee_cny_micro,7200);assert.equal(quote.usd_micro,1_000_000);assert.equal(quote.cash_micro,7_207_200);
  await user.locator('[data-act=exchange-confirm]').waitFor();const quoteText=await user.locator('.currency-quote').innerText();for(const value of ['ECB','7.2','7.2072','0.0072','USD 1','10'])assert.ok(quoteText.includes(value),value);
  assert.equal((await bootstrap()).wallet.cash_micro,20_000_000,'Quote and fee preview cannot charge');assert.equal(exchanges.length,0);
  assert.equal(quote.api_keys_will_enable,!initial.user.self_keys,'The quote describes automatic enablement accurately for an unblocked customer');
  await user.screenshot({path:resolve(evidence,'cny-fx-ecb-quote-320.png'),fullPage:true,animations:'disabled',timeout:10000});
  await user.waitForFunction(()=>document.querySelector('#fx')?.getAttribute('aria-busy')!=='true');
  const lostExchangeReply=user.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/allowance/buy'&&response.request().method()==='POST');
  await user.locator('[data-act=exchange-confirm]').click();assert.equal((await lostExchangeReply).status(),503);await user.locator('[data-act=exchange-confirm]:enabled').waitFor();
  const settled=await bootstrap();assert.equal(settled.wallet.cash_micro,12_792_800);assert.equal(settled.api_allowance.balance.micro,1_000_000);
  await user.reload();await user.locator('[data-act=exchange]').click();assert.equal(await user.locator('[data-form=exchange-quote]').count(),0);await user.locator('[data-act=exchange-confirm]').click();await user.locator('[data-act=exchange-confirm]').waitFor({state:'detached'});
  assert.equal(exchanges.length,2);assert.deepEqual(exchanges[0],exchanges[1]);assert.ok(exchanges[0].key);
  const recovered=await bootstrap();assert.equal(recovered.wallet.cash_micro,settled.wallet.cash_micro);assert.equal(recovered.api_allowance.balance.micro,settled.api_allowance.balance.micro);assert.deepEqual(receipts.exchange.exchange,quote);
  assert.equal(recovered.user.self_keys,true,'Successful first customer exchange delivers API key creation');
  const key=await json(customers,publicBase,'/api/app/keys',{method:'POST',headers:customerIdentity,data:{name:'synthetic-first-customer-exchange',ttl_days:1}});assert.ok(key.raw&&key.key.id);
  await json(outsiders,publicBase,'/api/app/allowance/buy',{method:'POST',headers:{...customerHeaders(third),'Idempotency-Key':randomUUID()},data:exchanges[0].body},409);
  await json(customers,publicBase,'/api/app/allowance/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':randomUUID()},data:{cash_micro:7_207_200}},409);
  assert.equal((await bootstrap()).wallet.cash_micro,settled.wallet.cash_micro);
  const owners=await context();assert.equal((await raw(owners,consoleBase,'/__support_access_fixture/identity',{method:'POST',data:{identity:'owner'}})).status(),204);
  await json(owners,consoleBase,`/admin/api/users/${initial.user.id}/self-keys`,{method:'POST',data:{allowed:false}});
  assert.equal((await bootstrap()).user.self_keys,false);
  const secondQuote=(await json(customers,publicBase,'/api/app/allowance/quote',{method:'POST',headers:customerIdentity,data:{cash_micro:7_207_200}})).quote;
  assert.equal(secondQuote.api_keys_will_enable,false,'An explicit administrator restriction wins over later purchases');
  receipts.afterRestriction=await json(customers,publicBase,'/api/app/allowance/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':randomUUID()},data:{cash_micro:7_207_200,quote_id:secondQuote.id}});
  await json(customers,publicBase,'/api/app/allowance/buy',{method:'POST',headers:{...customerIdentity,'Idempotency-Key':exchanges[0].key},data:exchanges[0].body});
  const final=await bootstrap();assert.equal(final.user.self_keys,false,'Neither new exchange nor old success replay reopens explicitly closed permission');assert.equal(final.wallet.cash_micro,5_585_600);assert.equal(final.api_allowance.balance.micro,2_000_000);
  await json(customers,publicBase,'/api/app/keys',{method:'POST',headers:customerIdentity,data:{name:'synthetic-forbidden-after-admin-close',ttl_days:1}},403);
  await json(customers,publicBase,`/api/app/keys/${key.key.id}`,{method:'DELETE',headers:customerIdentity});

  // A second customer buys a plan directly with CNY, without exchanging first.
  receipts.planFunding=(await json(operators,consoleBase,`/api/support/conversations/${thirdConversation.id}/topups`,{method:'POST',headers:agentIdentity,data:{operationId:randomUUID(),amountMicro:3_000_000,receiptRef:`SYNTHETIC-plan-${randomUUID()}`,memo:'SYNTHETIC verified CNY payment for customer-selected plan'}})).data;
  assert.equal(receipts.planFunding.creditedCashMicro,3_000_000);
  let losePlan=true;
  await other.route('**/api/app/plans/buy',async route=>{
    const request=route.request();plans.push({body:request.postDataJSON(),key:request.headers()['idempotency-key']});
    if(!losePlan)return route.continue();losePlan=false;
    const committed=await route.fetch();assert.equal(committed.status(),200,await committed.text());receipts.plan=await committed.json();
    await route.fulfill({status:503,json:{error:'Committed plan response deliberately lost'}});
  });
  await other.goto(new URL('/zh/app/#/billing/market',publicBase).href);
  await other.locator('[data-act=buy-token-plan][data-id="1000"]').click();await other.locator('[data-plan-review]').waitFor();
  const planReview=await other.locator('[data-plan-review]').innerText();assert.ok(planReview.includes('CNY 2'));assert.ok(planReview.includes('USD 1000'));
  const beforePlan=await json(outsiders,publicBase,'/api/app/bootstrap');assert.equal(beforePlan.wallet.cash_micro,3_000_000);assert.equal(beforePlan.api_allowance.balance.micro,0);assert.equal(plans.length,0,'Plan review and CNY collection do not buy anything');
  await other.screenshot({path:resolve(evidence,'cny-fx-plan-review-320.png'),fullPage:true,animations:'disabled',timeout:10000});
  await other.waitForFunction(()=>document.querySelector('#fx')?.getAttribute('aria-busy')!=='true');
  const lostPlanReply=other.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/plans/buy'&&response.request().method()==='POST');
  await other.locator('[data-act=plan-confirm]').click();assert.equal((await lostPlanReply).status(),503);
  assert.equal((await json(outsiders,publicBase,'/api/app/bootstrap')).wallet.cash_micro,1_000_000,'Plan charges its CNY price with no FX surcharge');
  await other.reload();await other.locator('[data-act=buy-token-plan][data-id="1000"]').click();await other.locator('[data-plan-review]').waitFor();
  await other.waitForFunction(()=>document.querySelector('#fx')?.getAttribute('aria-busy')!=='true');
  const recoveredPlanReply=other.waitForResponse(response=>new URL(response.url()).pathname==='/api/app/plans/buy'&&response.request().method()==='POST');
  await other.locator('[data-act=plan-confirm]').click();assert.equal((await recoveredPlanReply).status(),200);await other.locator('[data-plan-review]').waitFor({state:'detached'});
  assert.equal(plans.length,2);assert.deepEqual(plans[0],plans[1]);assert.ok(plans[0].key);assert.equal(plans[0].body.max_charge_micro,2_000_000);assert.match(plans[0].body.terms_hash,/^[a-f0-9]{64}$/);
  const finalPlan=await json(outsiders,publicBase,'/api/app/plans'),finalPlanAccount=await json(outsiders,publicBase,'/api/app/bootstrap');
  assert.equal(finalPlanAccount.wallet.cash_micro,1_000_000);assert.equal(finalPlan.current.id,receipts.plan.subscription.id);assert.equal(finalPlan.current.plan_code,'1000');assert.ok(!finalPlan.current.queued,'A lost response must not purchase a renewal');
  for(const page of [user,desk]) {assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await user.screenshot({path:resolve(evidence,'cny-fx-customer-320.png'),fullPage:true,animations:'disabled',timeout:10000});await desk.screenshot({path:resolve(evidence,'cny-fx-staff-320.png'),fullPage:true,animations:'disabled',timeout:10000});
  assert.deepEqual(errors,[]);await writeFile(resolve(evidence,'cny-fx-real-receipts.json'),JSON.stringify({environment:'85 disposable DB and real signed Access verification',syntheticReference:'7.2 fixture, actual live ECB fetched separately',initial,funded,settled,recovered,final,quote,secondQuote,beforePlan,finalPlan,finalPlanAccount,receipts,funding,exchanges,plans,errors},null,2)+'\n');
});
