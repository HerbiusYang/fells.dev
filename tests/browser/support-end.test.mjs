import test from 'node:test';
import assert from 'node:assert/strict';
import { supportBrowser, supportFixture, locales, sendCustomer } from './helpers/support-http-fixture.mjs';
let environment;
test.before(async()=>{environment=await supportBrowser();});
test.after(async()=>{await environment?.close();});

function existingQuestion(f){
 f.state.messages.push({id:'31',conversationId:'21',clientMessageId:crypto.randomUUID(),sender:'user',text:'Original support question',attachments:[],createdAt:'2023-11-14T22:13:20.000Z'});
}

for(const locale of locales)test(`customer can end and reopen support with retained history ${locale||'en'}`,async t=>{
 const f=await supportFixture(t,environment,{viewport:{width:320,height:568},isMobile:true,hasTouch:true});
 existingQuestion(f);
 const page=await f.customerPage(locale),button=page.locator('[data-support-end]');
 await button.waitFor({state:'visible'});
 assert.ok((await button.textContent()).trim());
 const close=page.locator('[data-support-close]');
 assert.notEqual(await close.getAttribute('aria-label'),await button.textContent());
 await close.click();
 assert.equal(f.state.status,'open');
 assert.equal(f.calls.filter(call=>call.path.endsWith('/end')).length,0,'X only minimizes');
 await page.locator('[data-support-open]').click();
 await page.locator('[data-support-text]').fill('Retained draft after ending');
 const rect=await button.boundingBox();
 assert.ok(rect.height>=44&&rect.x>=0&&rect.x+rect.width<=320,'End action remains visible and tappable');
 await button.click();
 await page.locator('[data-support-session-notice]').waitFor({state:'visible'});
 assert.equal(f.state.status,'resolved');
 assert.equal(await page.locator('[data-support-text]').inputValue(),'Retained draft after ending');
 assert.equal(await page.locator('[data-support-message]').count(),1);
 const ends=f.calls.filter(call=>call.path.endsWith('/end'));
 assert.equal(ends.length,1);assert.equal(ends[0].headers['x-fells-support-audience'],'customer');assert.deepEqual(ends[0].body,{lastMessageId:'31'});
 assert.equal(f.calls.some(call=>call.method!=='GET'&&/\/orders(?:\/|$)|\/cases(?:\/|$)|\/status$|\/topups$/.test(call.path)),false,'Ending does not submit financial or acceptance mutations');
 await close.click();await page.locator('[data-support-open]').click();
 await page.locator('[data-support-session-notice]').waitFor({state:'visible'});
 await sendCustomer(page,'Continue previous consultation');
 assert.equal(f.state.status,'open');
 await button.waitFor({state:'visible'});
 assert.equal(await page.locator('[data-support-message]').count(),2);
 assert.equal(await page.locator('[data-support-session-notice]').isHidden(),true);
 assert.deepEqual(f.errors,[]);
});

test('new reply conflicts refresh history without automatically ending the reply',async t=>{
 const f=await supportFixture(t,environment);existingQuestion(f);f.state.endReplyRace=true;
 const page=await f.customerPage('/zh');
 await page.locator('[data-support-end]').click();
 await page.locator('[data-support-error]').filter({hasText:'收到新回复'}).waitFor();
 await page.locator('[data-support-message]').filter({hasText:'New reply while ending'}).waitFor();
 assert.equal(f.state.status,'open');assert.equal(f.calls.filter(call=>call.path.endsWith('/end')).length,1);
 await page.locator('[data-support-end]:enabled').click();
 await page.locator('[data-support-session-notice]').waitFor({state:'visible'});
 assert.deepEqual(f.calls.filter(call=>call.path.endsWith('/end')).map(call=>call.body.lastMessageId),['31','32']);
 assert.equal(f.state.status,'resolved');assert.deepEqual(f.errors,[]);
});

test('pending and failed end retain the draft and permit an explicit retry',async t=>{
 const f=await supportFixture(t,environment);existingQuestion(f);f.state.failEnd=true;
 let release;f.state.endGate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 const page=await f.customerPage('/zh');
 await page.locator('[data-support-text]').fill('Keep draft while request is pending');
 const pending=page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/end'));
 await page.locator('[data-support-end]').click();await pending;
 assert.equal(await page.locator('[data-support-end]').isDisabled(),true);
 assert.equal(await page.locator('[data-support-send]').isDisabled(),true);
 release();await page.locator('[data-support-end]:enabled').waitFor();
 assert.equal(f.state.status,'open');
 assert.equal(await page.locator('[data-support-text]').inputValue(),'Keep draft while request is pending');
 assert.equal(await page.locator('[data-support-error]').isVisible(),true);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/end')).length,1);
 f.state.failEnd=false;
 await page.locator('[data-support-end]').click();
 await page.locator('[data-support-session-notice]').waitFor({state:'visible'});
 assert.equal(f.state.status,'resolved');assert.deepEqual(f.errors,[]);
});
