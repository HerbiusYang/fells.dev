import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserFixture } from '../helpers/browser.mjs';
import { createAppBackend } from '../helpers/app-backend.mjs';

const fixture = createBrowserFixture(); before(() => fixture.start()); after(() => fixture.stop());
const usagePath = /\/api\/app\/usage(?:\?.*)?$/;
const preferences = { theme:'light', prefs:{agent:'',send:0}, notifs:[true,true,true,false], onboarded:true, answers:[[0],[0],[0],[0]], promoClosed:true, sbHidden:false };
const usage = count => ({ usage:[{protocol:'anthropic',requests:count,tokens_in:count*1_700_000,tokens_out:count*3_039,list_micro:count*140_000,allow_micro:count*140_000}] });
const countText = page => page.locator('[data-api-usage-metrics] > div').nth(0).locator('b');
const idle = page => page.locator('[data-act=api-usage-refresh][aria-busy=false]').waitFor();

async function open(t, handler) {
  const session = await fixture.setup(t), {context,page,base} = session;
  await page.clock.install({time:new Date('2026-10-26T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-10-26T12:00:01Z'));
  await page.addInitScript(() => { window.__usageHidden=false; Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__usageHidden}); });
  const backend = createAppBackend({preferences,modelChat:true,keys:[17,18].map(id=>({id,name:`Key ${id}`,prefix:`sk-example-${id}…`,kind:'user',expires_at:0,revoked:false,created_at:1700000000}))});
  await backend.install(context);
  await context.route(/\/api\/app\/catalog(?:\?.*)?$/,route=>route.fulfill({json:{models:['claude/one','claude/two'].map(model=>({model,formats:['anthropic-messages'],offered:true,client_formats:{api:['anthropic-messages'],claude_code:['anthropic-messages']},routable:true}))}}));
  const requests=[];
  await context.route(usagePath,async route=>{requests.push({since:Number(new URL(route.request().url()).searchParams.get('since'))});await handler(route,requests.length);});
  await page.goto(base+'/app/#/api');
  await page.locator('.codebox[data-catalog-state=ready]').waitFor();await idle(page);
  return {...session,backend,requests};
}

test('visible API metrics refresh every ten seconds and manually without replacing controls, dialogs or drafts',async t=>{
  const {page,context,requests,errors}=await open(t,(route,n)=>route.fulfill({json:usage(n)}));
  assert.equal(await countText(page).innerText(),'1');
  await page.locator('[data-input=apiKey]').selectOption('18');
  await page.locator('.codebox[data-catalog-state=ready]').waitFor();
  await page.locator('[data-act=quick][data-i="2"]').click();
  await page.locator('[data-input=claudeModel]').selectOption('claude/two');
  let logs=0;await context.route(/\/api\/app\/logs(?:\?.*)?$/,route=>{logs++;return route.fulfill({json:{logs:[]}});});
  await page.locator('.bar [data-act=new-key]').click();
  await page.locator('[data-form=key] [name=name]').fill('Keep this unsaved key name');
  await page.evaluate(()=>{window.__usageNodes={key:document.querySelector('[data-input=apiKey]'),model:document.querySelector('[data-input=claudeModel]'),code:document.querySelector('.codebox[data-catalog-state] pre'),draft:document.querySelector('[data-form=key] [name=name]'),dialog:document.querySelector('.dlg')};});
  await page.clock.runFor(9_999);assert.equal(requests.length,1);
  await page.clock.runFor(1);await countText(page).filter({hasText:/^2$/}).waitFor();await idle(page);
  assert.equal(await page.locator('[data-api-usage-metrics] > div').nth(1).locator('b').innerText(),'3.41M');
  assert.equal(await page.locator('[data-api-usage-metrics] > div').nth(2).locator('b').innerText(),'$0.28');
  assert.equal(await page.locator('[data-api-usage-metrics] > div').nth(3).locator('b').innerText(),'$0.28');
  assert.equal(await page.evaluate(()=>Object.entries(window.__usageNodes).every(([name,node])=>node===document.querySelector({key:'[data-input=apiKey]',model:'[data-input=claudeModel]',code:'.codebox[data-catalog-state] pre',draft:'[data-form=key] [name=name]',dialog:'.dlg'}[name]))),true);
  assert.equal(await page.locator('[data-form=key] [name=name]').inputValue(),'Keep this unsaved key name');
  assert.equal(await page.locator('[data-form=key] [name=name]').evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.locator('[data-input=apiKey]').inputValue(),'18');assert.equal(await page.locator('[data-input=claudeModel]').inputValue(),'claude/two');
  assert.equal(await page.locator('.codebox[data-catalog-state]').getAttribute('data-claude-mode'),'saved');
  await page.keyboard.press('Escape');
  await page.locator('[data-act=api-usage-refresh]').click();await countText(page).filter({hasText:/^3$/}).waitFor();
  assert.equal(requests.length,3);assert.equal(logs,0,'metric refresh never opens or fetches request logs');assert.deepEqual(errors,[]);
});

test('hidden and off-page API polling stops, while visibility, focus and API entry refresh immediately',async t=>{
  const {page,requests,errors}=await open(t,(route,n)=>route.fulfill({json:usage(n)}));
  await page.evaluate(()=>{window.__usageHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
  await page.clock.runFor(30_000);await page.evaluate(()=>dispatchEvent(new Event('focus')));assert.equal(requests.length,1);
  await page.evaluate(()=>{window.__usageHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await countText(page).filter({hasText:/^2$/}).waitFor();await idle(page);
  await page.evaluate(()=>dispatchEvent(new Event('focus')));await countText(page).filter({hasText:/^3$/}).waitFor();await idle(page);
  await page.evaluate(()=>{location.hash='#/settings/0';});await page.locator('[data-form=profile]').waitFor();
  const before=requests.length;await page.clock.runFor(30_000);assert.equal(requests.length,before);
  await page.evaluate(()=>{location.hash='#/api';});await countText(page).filter({hasText:/^4$/}).waitFor();
  assert.deepEqual(errors,[]);
});

test('late usage replies cannot replace a newer range or an off-page focused profile draft',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  let started;const secondStarted=new Promise(resolve=>{started=resolve;});
  let delivered;const secondDelivered=new Promise(resolve=>{delivered=resolve;});
  let releaseExit;const exitGate=new Promise(resolve=>{releaseExit=resolve;});
  let exitStarted;const exitRequestStarted=new Promise(resolve=>{exitStarted=resolve;});
  const {page,requests,errors}=await open(t,async(route,n)=>{
    if(n===2){started();await gate;await route.fulfill({json:usage(999)});delivered();}
    else if(n===4){exitStarted();await exitGate;await route.fulfill({json:usage(888)});}
    else await route.fulfill({json:usage(n)});
  });
  try {
    await page.locator('[data-act=api-range][data-i="1"]').click();await secondStarted;
    await page.locator('[data-act=api-range][data-i="2"]').click();await countText(page).filter({hasText:/^3$/}).waitFor();
    const monthStart=await page.evaluate(()=>Math.floor(new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime()/1000));
    assert.equal(requests.length,3);assert.ok(requests[1].since<requests[0].since);assert.equal(requests[2].since,monthStart);
    release();await secondDelivered;await page.clock.runFor(1);
    assert.equal(await countText(page).innerText(),'3','the old range cannot replace the newer visible range');
    await idle(page);await page.locator('[data-act=api-usage-refresh]').click();await exitRequestStarted;
    await page.evaluate(()=>{location.hash='#/settings/0';});await page.locator('[data-form=profile] [name=name]').fill('Preserve this profile draft');
    releaseExit();await page.clock.runFor(30_000);
    assert.equal(await page.locator('[data-form=profile] [name=name]').inputValue(),'Preserve this profile draft');
    assert.equal(requests.length,4);
    await page.evaluate(()=>{location.hash='#/api';});await countText(page).filter({hasText:/^5$/}).waitFor();
    assert.deepEqual(errors,[]);
  }finally{release();releaseExit();}
});

test('background failures retain good metrics quietly and overlapping focus events cannot duplicate a request',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {page,requests,errors}=await open(t,async(route,n)=>{
    if(n===2){await gate;await route.fulfill({status:503,json:{error:'Temporary usage outage'}});}
    else await route.fulfill({json:n===3?{usage:[{requests:'not-a-count',tokens_in:null,allow_micro:-1,list_micro:'Infinity'}]}:n===4?{usage:'malformed'}:usage(n)});
  });
  try {
    await page.clock.runFor(10_000);await page.locator('[data-act=api-usage-refresh][aria-busy=true]').waitFor();
    await page.evaluate(()=>{dispatchEvent(new Event('focus'));dispatchEvent(new Event('focus'));document.querySelector('[data-act=api-usage-refresh]').click();});
    assert.equal(requests.length,2);release();await idle(page);
    assert.equal(await countText(page).innerText(),'1');assert.equal(await page.locator('.toast').count(),0);
    await page.clock.runFor(10_000);await idle(page);assert.equal(requests.length,3);assert.equal(await countText(page).innerText(),'1');
    await page.clock.runFor(10_000);await idle(page);assert.equal(requests.length,4);assert.equal(await countText(page).innerText(),'1');
    await page.clock.runFor(10_000);await countText(page).filter({hasText:/^5$/}).waitFor();
    assert.equal(await page.locator('.toast').count(),0);assert.deepEqual(errors,[]);
  }finally{release();}
});

test('a stalled usage request times out without clearing metrics and a later poll recovers',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {page,requests,errors}=await open(t,async(route,n)=>{
    if(n===2){await gate;await route.fulfill({json:usage(999)});}
    else await route.fulfill({json:usage(n)});
  });
  try {
    await page.clock.runFor(10_000);await page.locator('[data-act=api-usage-refresh][aria-busy=true]').waitFor();
    await page.clock.runFor(15_000);await idle(page);
    assert.equal(requests.length,2);assert.equal(await countText(page).innerText(),'1');
    release();await page.clock.runFor(10_000);await countText(page).filter({hasText:/^3$/}).waitFor();
    assert.equal(await page.locator('.toast').count(),0);assert.deepEqual(errors,[]);
  }finally{release();}
});

test('usage refresh shares the header row with request logs across mobile and desktop widths',async t=>{
  const {page,errors}=await open(t,(route,n)=>route.fulfill({json:usage(n)}));
  for(const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    const refresh=await page.locator('[data-act=api-usage-refresh]').boundingBox(), logs=await page.locator('[data-act=api-logs]').boundingBox();
    assert.ok(refresh&&logs);assert.ok(Math.abs(refresh.y-logs.y)<2,`${width}: no orphan refresh row`);
    assert.ok(refresh.x+refresh.width<=logs.x&&logs.x+logs.width<=width,`${width}: header actions stay separate and inside the viewport`);
    assert.equal(await page.locator('.main > .scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  }
  assert.deepEqual(errors,[]);
});
