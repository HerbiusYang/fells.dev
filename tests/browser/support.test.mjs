import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { supportBrowser, supportFixture, locales, refresh, sendCustomer, sendOperator } from './helpers/support-http-fixture.mjs';
import { png } from '../fixtures/support-images.mjs';
let environment;
before(async()=>{environment=await supportBrowser();});
after(async()=>{await environment?.close();});

test('authenticated app loads the current workspace members from the server API',async t=>{
 const fixture=await supportFixture(t,environment),workspace={id:'workspace-1',name:'测试工作区',region:'auto',tz:'UTC',created:1700000000000,role:'owner'};
 await fixture.context.route('**/api/app/workspaces',route=>route.fulfill({status:200,json:{workspaces:[workspace]}}));
 await fixture.context.route('**/api/app/workspaces/workspace-1/chats',route=>route.fulfill({status:200,json:{chats:[]}}));
 await fixture.context.route('**/api/app/workspaces/workspace-1/members',route=>route.fulfill({status:200,json:{members:[{user_id:42,name:'Customer',role:'owner'}]}}));
 const page=await fixture.context.newPage();await page.goto(environment.base+'/zh/app/#/members');
 await page.locator('#fx .sb').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#fx')?.dataset.route==='#/members');
 await page.locator('[data-act=invite-link][data-role=editor]').waitFor({state:'visible'});
 await page.locator('#fx-main').getByText('Customer').waitFor();
 assert.match(await page.locator('#fx-main').innerText(),/Customer/);
 assert.deepEqual(fixture.errors,[]);
});

test('operator Access session opens the desk without a password request',async t=>{
 const {context,calls,errors,state}=await supportFixture(t,environment);
 state.operatorSignedIn=true;
 const page=await context.newPage();await page.goto(environment.base+'/zh/support/');
 await page.locator('[data-support-agent-name]').filter({hasText:'Support operator'}).waitFor();
 assert.equal(await page.locator('input[type=password],[data-support-login-form]').count(),0);
 assert.ok(calls.some(c=>c.path==='/api/support/session'&&c.method==='GET'));
 assert.equal(calls.filter(c=>c.path==='/api/support/session'&&c.method==='POST').length,0);
 assert.deepEqual(errors,[]);
});

test('missing or denied Access identity shows a console return path without redirect loops',async t=>{
 for(const status of [200,401,403]){
  const f=await supportFixture(t,environment),requests=[];
  await f.context.route('**/api/support/session',route=>{requests.push(route.request().method());return route.fulfill({status,json:status===200?{ok:true,data:null}:{ok:false,error:{code:status===401?'session_changed':'access_required',message:'Access identity required'}}});});
  const page=await f.context.newPage();await page.goto(environment.base+'/zh/support/desk/');
  await page.locator('[data-support-session-error]').filter({hasText:'Cloudflare Access'}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/zh/support/desk/');
  assert.equal(await page.locator('[data-support-console-return]').getAttribute('href'),'/admin/');
  assert.equal(await page.locator('input[type=password],[data-support-login-form]').count(),0);
  assert.deepEqual(requests,['GET']);
  assert.equal(await page.locator('[data-support-send]').isDisabled(),true);
  assert.deepEqual(f.errors,[]);await f.context.close();
 }
});

test('failed Access logout keeps the current location and permits retry before redirecting',async t=>{
 const f=await supportFixture(t,environment),page=await f.operatorPage();
 let reject=true,logoutRequests=0;
 await f.context.route('**/api/support/session',route=>{
  if(route.request().method()!=='DELETE')return route.fallback();
  logoutRequests++;
  if(reject)return route.fulfill({status:503,json:{ok:false,error:{code:'unavailable',message:'Logout could not be saved'}}});
  return route.fallback();
 });
 await page.locator('[data-support-logout]').click();
 await page.locator('[data-support-session-error]').filter({hasText:'Logout could not be saved'}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/zh/support/desk/');
 assert.equal(await page.locator('[data-support-logout]').isDisabled(),false);
 assert.equal(f.state.operatorSignedIn,true);
 reject=false;await page.locator('[data-support-logout]').click();await page.waitForURL(url=>url.pathname==='/cdn-cgi/access/logout');
 assert.equal(logoutRequests,2);assert.equal(f.state.operatorSignedIn,false);assert.deepEqual(f.errors,[]);
});

test('an early SSE expiry cannot cancel logout or navigate before its retry succeeds',async t=>{
 const f=await supportFixture(t,environment);
 await f.context.addInitScript(()=>{
  const Native=window.EventSource;
  window.EventSource=class extends Native{constructor(url,options){super(url,options);if(String(url).includes('audience=operator'))window.__operatorEvents=this;}};
 });
 const page=await f.operatorPage();await page.waitForFunction(()=>Boolean(window.__operatorEvents));
 let release;const gate=new Promise(resolve=>release=resolve);let attempts=0;const requests=[];
 await f.context.route('**/api/support/session',async route=>{
  if(route.request().method()!=='DELETE')return route.fallback();
  requests.push(route.request().headers());attempts++;
  if(attempts===1){await gate;return route.fulfill({status:503,json:{ok:false,error:{code:'unavailable',message:'Revocation reply lost'}}});}
  return route.fallback();
 });
 const started=page.waitForRequest(request=>request.method()==='DELETE'&&new URL(request.url()).pathname==='/api/support/session');
 await page.locator('[data-support-logout]').click();await started;
 f.state.operatorSignedIn=false;
 await page.evaluate(()=>window.__operatorEvents.dispatchEvent(new MessageEvent('session.expired',{data:JSON.stringify({id:'early-expiry',type:'session.expired',data:{role:'agent'}})})));
 assert.equal(new URL(page.url()).pathname,'/zh/support/desk/');
 assert.equal(await page.locator('[data-support-logout]').isDisabled(),true);
 assert.equal(await page.locator('.support-console-workspace').isVisible(),false);
 release();await page.locator('[data-support-session-error]').filter({hasText:'Revocation reply lost'}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/zh/support/desk/');
 await page.locator('[data-support-logout]').click();await page.waitForURL(url=>url.pathname==='/cdn-cgi/access/logout');
 assert.equal(attempts,2);
 assert.equal(requests[0]['x-fells-expected-operator-session'],requests[1]['x-fells-expected-operator-session']);
 assert.deepEqual(f.errors,[]);
});

test('customer and operator exchange persistent text using independently selected audiences',async t=>{
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
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'重新打开'}).waitFor();assert.equal(fixture.state.status,'resolved');
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'标记已解决'}).waitFor();assert.equal(fixture.state.status,'open');
 await desk.locator('[data-support-status]').click();await desk.locator('[data-support-status]').filter({hasText:'重新打开'}).waitFor();
 await user.bringToFront();await sendCustomer(user,'继续咨询');assert.equal(fixture.state.status,'open');
 await refresh(desk);await desk.locator('[data-support-status]').filter({hasText:'标记已解决'}).waitFor();assert.deepEqual(fixture.errors,[]);
});

test('operator logout clears another desk with a pending session read while the same browser customer remains usable',async t=>{
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage(),desk=await fixture.operatorPage();
 const other=await fixture.context.newPage();await other.goto(environment.base+'/zh/'+environment.portal+'/desk/');await other.locator('[data-support-search]:enabled').waitFor();
 let release;const gate=new Promise(resolve=>release=resolve);
 await other.route('**/api/support/session',async route=>{if(route.request().method()==='GET')await gate;try{await route.fallback();}catch{/* Navigation cancels this deliberately delayed read. */}});
 const pending=other.waitForRequest(request=>request.method()==='GET'&&new URL(request.url()).pathname==='/api/support/session');
 await other.evaluate(()=>dispatchEvent(new Event('focus')));await pending;
 try{await desk.locator('[data-support-logout]').click();await desk.waitForURL(url=>url.pathname==='/cdn-cgi/access/logout');await other.waitForURL(url=>url.pathname==='/cdn-cgi/access/logout');}finally{release();}
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

test('fixed operator pages exclude public metadata and never restore a retired portal',async t=>{
 for(const locale of locales)for(const suffix of ['/','/desk/']){
  const html=await (await fetch(environment.base+locale+'/'+environment.portal+suffix)).text();assert.match(html,/noindex,\s*nofollow,\s*noarchive/);assert.doesNotMatch(html.slice(0,html.indexOf("</head>")),/rel="canonical"|hreflang=|property="og:url"|fonts\.googleapis\.com|fonts\.gstatic\.com/);
 }
 for(const locale of locales)for(const suffix of ['/','/desk/'])assert.equal((await fetch(environment.base+locale+'/fells-test-portal'+suffix)).status,404,'retired configured entry returns 404');
 const visit=async directory=>{for(const item of await readdir(directory,{withFileTypes:true})){const file=resolve(directory,item.name);if(item.isDirectory()){await visit(file);continue;}assert.equal((await readFile(file)).includes(Buffer.from('fells-test-portal')),false,'all output omits the retired portal address');}};
 await visit(environment.dist);
});
