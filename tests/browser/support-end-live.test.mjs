import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Explicit disposable real API/PostgreSQL fixture. No product response is
// intercepted, no production credentials and no external payment calls.
test('live customer end persists across reload and new messages reopen the same history', {timeout:90000},async t=>{
 if(process.env.FELLS_SUPPORT_END_LIVE!=='1'){t.skip('Requires the isolated real API/PostgreSQL support fixture');return;}
 const fixture=JSON.parse(await readFile(process.env.FELLS_SUPPORT_END_FIXTURE,'utf8'));
 const publicBase=new URL(fixture.publicBase),consoleBase=new URL(fixture.consoleBase);
 for(const base of [publicBase,consoleBase]){assert.equal(base.hostname,'127.0.0.1');assert.equal(base.protocol,'http:');}
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const customer=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 const operator=await browser.newContext(),foreign=await browser.newContext();
 const errors=[];
 for(const ctx of [customer,operator,foreign]){
  await ctx.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,route=>route.abort());
  ctx.on('page',page=>{page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));});
 }
 async function request(ctx,base,path,method='GET',body,identity={}){
  const response=await ctx.request.fetch(new URL(path,base).href,{method,headers:{Origin:base.origin,...identity},...(body!==undefined?{data:body}:{})});
  return{response,data:await response.json()};
 }
 async function login(ctx,person){
  assert.equal((await request(ctx,publicBase,'/api/app/session','POST',{username:person.username,password:person.password})).response.status(),200);
  const bootstrap=(await request(ctx,publicBase,'/api/app/bootstrap')).data;
  return{'X-Fells-Support-Audience':'customer','X-Fells-Expected-User':String(bootstrap.user.id),'X-Fells-Expected-Session':bootstrap.session_id};
 }
 const ci=await login(customer,fixture.customers.primary),fi=await login(foreign,fixture.customers.other);
 const selected=await operator.request.post(new URL('/__support_access_fixture/identity',consoleBase).href,{data:{identity:'ops'}});assert.equal(selected.status(),204);
 const session=await request(operator,consoleBase,'/api/support/session','GET',undefined,{'X-Fells-Support-Audience':'operator'});
 assert.equal(session.response.status(),200);assert.equal(session.data.data.authMethod,'access');
 const oi={'X-Fells-Support-Audience':'operator','X-Fells-Expected-Operator':session.data.data.operator.id,'X-Fells-Expected-Operator-Session':session.data.data.sessionId};
 const page=await customer.newPage();await page.goto(new URL('/zh/app/',publicBase).href);
 await page.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
 const first='Live end consultation '+crypto.randomUUID();
 await page.locator('[data-support-text]').fill(first);await page.locator('[data-support-send]').click();
 await page.locator('[data-support-message]').filter({hasText:first}).waitFor();
 const current=(await request(customer,publicBase,'/api/support/conversations/current','GET',undefined,ci)).data.data;
 const base='/api/support/conversations/'+current.id;
 const call=async(path,method='GET',body)=>{const result=await request(customer,publicBase,path,method,body,ci);assert.equal(result.response.status(),200,`${method} ${path}: ${JSON.stringify(result.data)}`);return result.data.data;};
 const beforeMoney=(await request(customer,publicBase,'/api/app/bootstrap')).data;
 const orders=await call(base+'/orders'),cases=await call(base+'/cases');
 await page.locator('[data-support-close]').click();
 assert.equal((await call(base)).status,'open','X only minimizes');
 await page.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
 const endReply=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/end');
 await page.locator('[data-support-end]').click();assert.equal((await endReply).status(),200);
 await page.locator('[data-support-session-notice]').waitFor({state:'visible'});
 assert.equal((await call(base)).status,'resolved');
 const desk=(await request(operator,consoleBase,base,'GET',undefined,oi));
 assert.equal(desk.response.status(),200);assert.equal(desk.data.data.status,'resolved','Support sees the persisted customer end');
 assert.deepEqual(await call(base+'/orders'),orders);assert.deepEqual(await call(base+'/cases'),cases);
 const afterMoney=(await request(customer,publicBase,'/api/app/bootstrap')).data;
 assert.deepEqual(afterMoney.wallet,beforeMoney.wallet);assert.deepEqual(afterMoney.api_allowance,beforeMoney.api_allowance);
 await page.reload();await page.locator('[data-chat-support]:visible,[data-support-open]:visible').click();
 await page.locator('[data-support-session-notice]').waitFor({state:'visible'});
 await page.locator('[data-support-message]').filter({hasText:first}).waitFor();
 const next=first+' reopened';await page.locator('[data-support-text]').fill(next);await page.locator('[data-support-send]').click();
 await page.locator('[data-support-message]').filter({hasText:next}).waitFor();
 assert.equal((await call(base)).status,'open');
 assert.equal((await request(operator,consoleBase,base,'GET',undefined,oi)).data.data.status,'open');
 const history=await call(base+'/messages');assert.ok(history.items.some(message=>message.text===first)&&history.items.some(message=>message.text===next));
 const rejected=await request(foreign,publicBase,base+'/end','POST',{lastMessageId:history.items.at(-1).id},fi);
 assert.equal(rejected.response.status(),404);
 assert.equal((await call(base)).status,'open');assert.deepEqual(errors,[]);
});
