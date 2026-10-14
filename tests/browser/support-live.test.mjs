import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { png } from '../fixtures/support-images.mjs';

// Explicitly enabled against an isolated local backend; no credentials are
// committed, and the fixture suites exercise the same UI without a running DB.
test('isolated live backend: real UI login, SSE text/image exchange, reads, typing, resolution and independent logout',async t=>{
 const password=process.env.FELLS_LIVE_TEST_PASSWORD;
 if(!process.env.FELLS_LIVE_TEST||!password){t.skip('Set FELLS_LIVE_TEST and FELLS_LIVE_TEST_PASSWORD for the isolated local backend');return;}
 const base=process.env.FELLS_BROWSER_BASE??'http://127.0.0.1:4321';
 const url=new URL(base);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'live tests target an isolated loopback backend');
 const portal=process.env.FELLS_TEST_SUPPORT_PORTAL??(await readFile('.env.local','utf8')).match(/^SUPPORT_PORTAL_PATH=([a-z-]+)$/m)?.[1];assert.ok(portal);
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(!existsSync(chromium.executablePath())&&existsSync(chrome)?chrome:undefined);
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});t.after(()=>browser.close());
 const customers=await browser.newContext(),operators=await browser.newContext();
 // These tests exercise the real isolated API/SSE, not Google's font service.
 // Keep external font transport from blocking document load on the test VPS.
 for (const context of [customers, operators]) await context.route('https://fonts.googleapis.com/**', route => route.fulfill({status:200,contentType:'text/css',body:''}));
 const user=await customers.newPage(),desk=await operators.newPage(),errors=[],eventResponses=[],calls=[],httpFailures=[];
 const observe = page => {page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/support/'))calls.push({path:u.pathname,method:r.method(),headers:r.headers(),query:Object.fromEntries(u.searchParams)});});page.on('response',r=>{const path=new URL(r.url()).pathname;if(path==='/api/support/events')eventResponses.push(r.status());if(path.startsWith('/api/support/')&&r.status()>=400)void r.text().then(body=>httpFailures.push({path,status:r.status(),body})); });};
 for(const page of [user,desk]) observe(page);
 await user.goto(base+'/zh/app/start/');await user.locator('#auth-email').fill(process.env.FELLS_TEST_USER??'support-browser');await user.locator('#auth-password').fill(password);await user.locator('[data-auth-form] [type=submit]').click();await user.waitForURL(/\/zh\/app\/?$/);
 await user.waitForFunction(()=>document.querySelector('#fx')?.getAttribute('aria-busy')!=='true');const skip=user.locator('[data-act=ob-skip]');try{await skip.waitFor({state:'visible',timeout:3000});await skip.click();}catch{/* Existing account may already be onboarded. */}
 try{await user.locator('[data-support-open]').waitFor({state:'visible'});}catch(failure){console.error(JSON.stringify({modal:await user.locator('.scrim').allTextContents(),widget:await user.locator('#support-widget').getAttribute('style'),errors,httpFailures}));throw failure;}await user.locator('[data-support-open]').click();
 const marker='live-support-'+crypto.randomUUID();
 const imageName=marker+'.png';
 await user.locator('#support-widget [data-support-text]').fill(marker+' <script>window.supportPwned=1</script>');await user.locator('#support-widget [data-support-send]').click();try{await user.locator('[data-support-message]').filter({hasText:marker}).waitFor();}catch(failure){console.error(JSON.stringify({supportError:await user.locator('[data-support-error]').textContent(),errors,httpFailures,calls:calls.map(c=>({path:c.path,method:c.method}))}));throw failure;}
 await desk.goto(base+'/zh/'+portal+'/');await desk.locator('#support-account').fill(process.env.FELLS_TEST_OPERATOR??'support@fells.local');await desk.locator('#support-password').fill(password);await desk.locator('[data-support-login-form] [type=submit]').click();await desk.waitForURL(/\/desk\/?$/);
 await desk.locator('[data-support-conversation]').filter({hasText:marker}).click();await desk.locator('[data-support-message]').filter({hasText:marker}).waitFor();
 await desk.bringToFront();await desk.evaluate(()=>dispatchEvent(new Event('focus')));
 await user.locator('[data-support-message]').filter({hasText:marker}).locator('[data-support-receipt][data-read="true"]').waitFor();
 const reply=marker+'-reply';await desk.locator('[data-support-text]').fill(reply);await desk.locator('[data-support-send]').click();
 // No focus refresh on the recipient: this proves the live SSE update path.
 await user.locator('[data-support-message]').filter({hasText:reply}).waitFor();
 assert.equal(await user.evaluate(()=>window.supportPwned),undefined);assert.equal(await desk.evaluate(()=>window.supportPwned),undefined);
 await user.bringToFront();await user.evaluate(()=>dispatchEvent(new Event('focus')));
 await desk.locator('[data-support-message]').filter({hasText:reply}).locator('[data-support-receipt][data-read="true"]').waitFor();
 await user.locator('#support-widget [data-support-file]').setInputFiles({name:imageName,mimeType:'image/png',buffer:png});await user.locator('#support-widget [data-support-preview]').waitFor({state:'visible'});await user.locator('#support-widget [data-support-send]').click();
 await desk.locator(`[data-support-message] img[alt="${imageName}"]`).waitFor();
 const signed=await user.locator(`#support-widget [data-support-message] img[alt="${imageName}"]`).getAttribute('src');assert.match(signed,/^\/api\/support\/attachments\/.*signature=/);
 const unauth=await browser.newContext();const denied=await unauth.request.get(base+signed);assert.equal(denied.status(),401);await unauth.close();
 await desk.bringToFront();await desk.locator('[data-support-text]').fill('正在输入');
 await user.locator('#support-widget [data-support-typing]').waitFor({state:'visible'});await desk.locator('[data-support-text]').fill('');await user.locator('#support-widget [data-support-typing]').waitFor({state:'hidden'});
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'重新打开'}).waitFor();await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'标记已解决'}).waitFor();
 await user.screenshot({path:'reports/frontend-support-connected-customer.png',fullPage:true});await desk.screenshot({path:'reports/frontend-support-connected-desk.png',fullPage:true});
 assert.ok(eventResponses.length>=2&&eventResponses.every(s=>s===200),'both live SSE streams opened');
 assert.ok(calls.some(c=>c.path==='/api/support/events'&&c.query.audience==='customer'&&c.query.expected_session));assert.ok(calls.some(c=>c.path==='/api/support/events'&&c.query.audience==='operator'&&c.query.expected_operator_session));
 const other=await operators.newPage();await other.goto(base+'/zh/'+portal+'/desk/');await other.locator('[data-support-search]').waitFor();await desk.locator('[data-support-logout]').click();await desk.waitForURL(u=>!u.pathname.includes('/desk'));await other.waitForURL(u=>!u.pathname.includes('/desk'));
 await user.bringToFront();const last=marker+'-after-operator-logout';await user.locator('#support-widget [data-support-text]').fill(last);await user.locator('#support-widget [data-support-send]').click();await user.locator('[data-support-message]').filter({hasText:last}).waitFor();
 await user.reload();await user.locator('[data-support-open]').click();await user.locator('[data-support-message]').filter({hasText:last}).waitFor();
 // More than the per-actor quota sequentially: closing a page must release its
 // upstream SSE slot rather than leaving the development proxy connected.
 for(let i=0;i<6;i++){
  const transient=await customers.newPage();observe(transient);
  const connected=transient.waitForResponse(r=>new URL(r.url()).pathname==='/api/support/events');
  await transient.goto(base+'/zh/app/');
  assert.equal((await connected).status(),200,'closed page releases SSE admission');
  await transient.locator('[data-support-open]').waitFor({state:'visible'});
  await transient.locator('[data-support-open]').click();await transient.locator('[data-support-close]').click();
  await transient.close();
 }
 assert.equal(httpFailures.some(r=>r.path==='/api/support/events'&&r.status===429),false,'no SSE admission leak after repeated page close');
 assert.deepEqual(errors,[]);
});
