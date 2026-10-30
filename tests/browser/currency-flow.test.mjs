import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, locales } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async()=>{environment=await supportBrowser();});
test.after(async()=>{await environment?.close();});
for (const locale of locales) test(`manual API allowance consultation does not debit or request an ECB quote ${locale||'en'}`, async t=>{
 const f=await supportFixture(t,environment,{viewport:{width:320,height:900}}), page=await f.context.newPage();
 await page.goto(`${environment.base}${locale}/app/#/billing/credits`);
 await page.locator('[data-support-product=allowance]').click();
 await page.locator('#support-panel:not([hidden])').waitFor();
 assert.equal(f.calls.some(call=>/\/api\/app\/allowance\/(buy|quote)$/.test(call.path)),false);
 assert.equal(await page.locator('[data-act=exchange-confirm],[data-form=exchange-quote]').count(),0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(f.errors,[]);
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
