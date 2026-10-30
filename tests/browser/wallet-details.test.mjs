import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture} from '../helpers/browser.mjs';
import {createAppBackend} from '../helpers/app-backend.mjs';
const fixture=createBrowserFixture();before(()=>fixture.start());after(()=>fixture.stop());
const preferences={theme:'light',prefs:{agent:'',send:0},notifs:[true,true,true,false],onboarded:true,answers:[[0],[0],[0],[0]],promoClosed:true,sbHidden:false};
test('wallet paginates the original server ledger and shows signed CNY amounts',async t=>{
 const f=await fixture.setup(t);await createAppBackend({preferences}).install(f.context);const pages=[];
 await f.context.route('**/api/app/wallet/ledger*',route=>{const page=Number(new URL(route.request().url()).searchParams.get('page'));pages.push(page);return route.fulfill({json:{page,size:15,total:16,entries:[{id:page,kind:page===1?'seat':'topup',memo:`Original memo ${page}`,delta_micro:page===1?-12000000:5000000,created_at:1700000000}]}});});
 await f.page.goto(f.base+'/app/#/billing/credits');await f.page.locator('[data-act=wallet-tab][data-v=ledger]').click();
 await f.page.getByText('Original memo 1',{exact:true}).waitFor();assert.match(await f.page.locator('#wallet-panel-ledger').innerText(),/-¥12\.00/);assert.equal(await f.page.locator('[data-act=ledger-page][data-page="0"]').isDisabled(),true);
 await f.page.locator('[data-act=ledger-page][data-page="2"]').click();await f.page.getByText('Original memo 2',{exact:true}).waitFor();assert.match(await f.page.locator('#wallet-panel-ledger').innerText(),/¥5\.00/);assert.equal(await f.page.locator('[data-act=ledger-page][data-page="3"]').isDisabled(),true);assert.deepEqual(pages,[1,2]);assert.deepEqual(f.errors,[]);
});
test('a coupon claim with a lost reply keeps one operation identity and cannot purchase anything',async t=>{
 const f=await fixture.setup(t);const backend=createAppBackend({preferences});await backend.install(f.context);const claims=[];
 await f.context.route('**/api/app/coupons/claim',route=>{claims.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});return claims.length===1?route.fulfill({status:503,json:{error:'Synthetic reply unavailable'}}):route.fulfill({json:{ok:true}});});
 await f.page.goto(f.base+'/app/#/billing/credits');await f.page.locator('[data-act=wallet-tab][data-v=coupons]').click();const form=f.page.locator('[data-form=coupon-claim]');await form.locator('[name=code]').fill('SYNTHETIC-COUPON');await form.locator('button').click();await form.locator('[name=code][readonly]').waitFor();await f.page.locator('#fx:not([aria-busy=true])').waitFor();await form.locator('button:not([disabled])').click();await form.locator('[name=code]:not([readonly])').waitFor();assert.equal(claims.length,2);assert.deepEqual(claims[0],claims[1]);assert.ok(claims[0].key);assert.equal(backend.state.writes.some(row=>/\/buy|\/upgrade/.test(row.path)),false);assert.deepEqual(f.errors,[]);
});
