import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { supportBrowser, supportFixture, locales, refresh, sendCustomer, sendOperator } from './helpers/support-http-fixture.mjs';
import { png } from '../fixtures/support-images.mjs';
let environment;
before(async()=>{environment=await supportBrowser();});
after(async()=>{await environment?.close();});
const operatorRequired=t=>{if(environment.portal)return true;t.skip('Private operator pages are intentionally omitted when SUPPORT_PORTAL_PATH is unconfigured');return false;};

test('operator login uses account/password and surfaces real authentication failure',async t=>{
 if(!operatorRequired(t))return;
 const {context,calls,errors}=await supportFixture(t,environment);
 const page=await context.newPage();await page.goto(environment.base+'/zh/'+environment.portal+'/');
 assert.equal(await page.locator('#support-password').getAttribute('type'),'password');
 await page.locator('#support-account').fill('fixture-operator');await page.locator('#support-password').fill('wrong-password');await page.locator('[type=submit]').click();
 await page.locator('[data-support-login-error]').filter({hasText:'Invalid support credentials'}).waitFor();
 assert.equal(new URL(page.url()).pathname.endsWith('/desk'),false);
 const call=calls.find(c=>c.path==='/api/support/session'&&c.method==='POST');assert.deepEqual(call.body,{email:'fixture-operator',password:'wrong-password'});
 assert.deepEqual(errors,[]);
});

test('customer and operator exchange persistent text using independently selected audiences',async t=>{
 if(!operatorRequired(t))return;
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 await user.bringToFront();await sendCustomer(user,'真实客户消息 <script>window.pwned=1</script>');
 await refresh(desk);await desk.locator('[data-support-message]').filter({hasText:'真实客户消息'}).waitFor();
 await sendOperator(desk,'客服真实回复');await refresh(user);await user.locator('[data-support-message]').filter({hasText:'客服真实回复'}).waitFor();
 assert.equal(await user.evaluate(()=>window.pwned),undefined);
 assert.equal(await desk.locator('[data-support-detail-credits]').innerText(),'USD 9.00');
 assert.match(await desk.locator('[data-support-detail-panel]').innerText(),/API 美元额度/);
 await user.reload();await user.locator('[data-support-open]').click();await user.locator('[data-support-message]').filter({hasText:'客服真实回复'}).waitFor();
 assert.deepEqual(fixture.state.messages.map(m=>m.sender),['user','agent']);
 const sends=fixture.calls.filter(c=>c.path.endsWith('/messages')&&c.method==='POST');assert.deepEqual(sends.map(c=>c.headers['x-fells-support-audience']),['customer','operator']);
 for(const c of sends){assert.equal(c.headers[c.body.text.startsWith('真实')?'x-fells-expected-user':'x-fells-expected-operator'],c.body.text.startsWith('真实')?'42':'84');assert.ok(!('sender' in c.body));}
 assert.ok(fixture.streams.some(c=>c.query.audience==='customer'&&c.query.expected_user==='42'&&c.query.expected_session==='a'.repeat(64)));
 assert.ok(fixture.streams.some(c=>c.query.audience==='operator'&&c.query.expected_operator==='84'&&c.query.expected_operator_session==='b'.repeat(64)));
 assert.equal(await user.evaluate(async()=> (await indexedDB.databases()).some(db=>db.name==='fells.preview.v2')),false);
 assert.deepEqual(fixture.errors,[]);
});

test('private images upload once, render signed URLs and use the existing image dialog',async t=>{
 if(!operatorRequired(t))return;
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 await user.bringToFront();await user.locator('#support-widget [data-support-file]').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:png});
 await user.locator('#support-widget [data-support-preview]').waitFor({state:'visible'});await user.locator('#support-widget [data-support-send]').click();
 await user.locator('#support-widget [data-support-message] img').waitFor();
 assert.match(await user.locator('#support-widget [data-support-message] img').getAttribute('src'),/^\/api\/support\/attachments\/attachment-1\?/);
 assert.equal(fixture.state.uploads,1);
 const uploaded=fixture.calls.find(c=>c.path==='/api/support/attachments'&&c.method==='POST');assert.match(uploaded.headers['content-type'],/^multipart\/form-data; boundary=/);
 const send=fixture.calls.find(c=>c.path.endsWith('/messages')&&c.method==='POST');assert.deepEqual(send.body.attachmentIds,['attachment-1']);
 await user.locator('#support-widget [data-support-image]').click();await user.locator('dialog.support-image-viewer').waitFor({state:'visible'});await user.keyboard.press('Escape');
 await refresh(desk);await desk.locator('[data-support-message] img').waitFor();assert.match(await desk.locator('[data-support-message] img').getAttribute('src'),/audience=operator/);
 await desk.locator('[data-support-image]').click();await desk.locator('dialog.support-image-viewer').waitFor({state:'visible'});await desk.keyboard.press('Escape');
 assert.deepEqual(fixture.errors,[]);
});

test('failed send keeps draft and attachment; retry uses the same message operation and upload',async t=>{
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage();
 await user.locator('#support-widget [data-support-text]').fill('保存草稿');await user.locator('#support-widget [data-support-file]').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:png});await user.locator('#support-widget [data-support-preview]').waitFor({state:'visible'});
 fixture.state.failSend=true;await user.locator('#support-widget [data-support-send]').click();await user.locator('[data-support-error]').filter({hasText:'Injected network failure'}).waitFor();
 assert.equal(await user.locator('#support-widget [data-support-text]').inputValue(),'保存草稿');assert.equal(await user.locator('#support-widget [data-support-preview]').isVisible(),true);
 fixture.state.failSend=false;await user.locator('#support-widget [data-support-send]').click();await user.locator('[data-support-message]').filter({hasText:'保存草稿'}).waitFor();
 const sends=fixture.calls.filter(c=>c.path.endsWith('/messages')&&c.method==='POST');assert.equal(sends[0].body.clientMessageId,sends[1].body.clientMessageId);assert.equal(fixture.state.uploads,1);
 assert.deepEqual(fixture.errors,[]);
});

test('read receipts advance only for a focused visible conversation',async t=>{
 if(!operatorRequired(t))return;
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 await user.bringToFront();await sendCustomer(user,'需要客服阅读');
 await refresh(desk);await desk.locator('[data-support-message]').filter({hasText:'需要客服阅读'}).waitFor();
 await desk.waitForFunction(()=>document.querySelector('[data-support-text]')?.disabled===false);
 await new Promise(resolve=>setTimeout(resolve,200));await refresh(user);
 await user.locator('[data-support-receipt][data-read="true"]').waitFor();assert.equal(fixture.state.agentRead,fixture.state.messages[0].id);
 await user.locator('[data-support-close]').click();await refresh(desk);await sendOperator(desk,'尚未打开的回复');
 await refresh(user);await user.locator('[data-support-unread]').waitFor({state:'visible'});assert.notEqual(fixture.state.userRead,fixture.state.messages.at(-1).id);
 await user.locator('[data-support-open]').click();await user.waitForFunction(()=>document.querySelector('[data-support-unread]')?.hidden===true);
 assert.equal(fixture.state.userRead,fixture.state.messages.at(-1).id);assert.deepEqual(fixture.errors,[]);
});

test('resolve and reopen persist, and customer reply reopens a resolved conversation',async t=>{
 if(!operatorRequired(t))return;
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'重新打开'}).waitFor();assert.equal(fixture.state.status,'resolved');
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'标记已解决'}).waitFor();assert.equal(fixture.state.status,'open');
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'重新打开'}).waitFor();
 await user.bringToFront();await sendCustomer(user,'继续咨询');assert.equal(fixture.state.status,'open');
 await refresh(desk);await desk.locator('[data-support-status]').filter({hasText:'标记已解决'}).waitFor();assert.deepEqual(fixture.errors,[]);
});

test('operator logout clears other desks while the same browser customer remains usable',async t=>{
 if(!operatorRequired(t))return;
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 const other=await fixture.context.newPage();await other.goto(environment.base+'/zh/'+environment.portal+'/desk/');await other.locator('[data-support-search]').waitFor();
 await desk.locator('[data-support-logout]').click();await desk.waitForURL(url=>!url.pathname.includes('/desk'));await other.waitForURL(url=>!url.pathname.includes('/desk'));
 await user.bringToFront();await sendCustomer(user,'客服退出后仍能留言');assert.equal(fixture.state.messages.at(-1).sender,'user');assert.deepEqual(fixture.errors,[]);
});

test('customer session change purges old history and prompts a real account sign-in',async t=>{
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage();await sendCustomer(user,'私有历史');
 fixture.state.customerSignedIn=false;
 await user.evaluate(()=>dispatchEvent(new CustomEvent('fells.session.changed',{detail:{audience:'customer'}})));
 await user.waitForURL(/\/app\/start\/?$/);
 assert.equal(await user.locator('[data-support-message]').count(),0);
 await user.locator('#auth-password').waitFor({state:'visible'});
 assert.equal(await user.locator('#auth-password').getAttribute('type'),'password');assert.deepEqual(fixture.errors,[]);
});

test('private operator portal metadata excludes indexable public-page metadata',async t=>{
 if(!operatorRequired(t))return;
 for(const locale of locales)for(const suffix of ['/','/desk/']){
  const html=await (await fetch(environment.base+locale+'/'+environment.portal+suffix)).text();assert.match(html,/noindex,\s*nofollow,\s*noarchive/);assert.doesNotMatch(html.slice(0,html.indexOf("</head>")),/rel="canonical"|hreflang=|property="og:url"|fonts\.googleapis\.com|fonts\.gstatic\.com/);
 }
 const visit=async directory=>{for(const item of await readdir(directory,{withFileTypes:true})){const file=resolve(directory,item.name);if(item.isDirectory()){await visit(file);continue;}const parts=relative(environment.dist,file).split('/');if(parts[0]===environment.portal||parts[1]===environment.portal)continue;assert.equal((await readFile(file)).includes(Buffer.from(environment.portal)),false,'public output omits private portal address');}};
 await visit(environment.dist);
});
