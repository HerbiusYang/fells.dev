import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {supportBrowser,supportFixture,locales,sendCustomer,refresh} from './helpers/support-http-fixture.mjs';
import {png} from '../fixtures/support-images.mjs';
let environment;
before(async()=>{environment=await supportBrowser();});
after(async()=>{await environment?.close();});
async function fits(page,selector,label){const r=await page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth-el.clientWidth};});assert.ok(r.left>=-1&&r.right<=r.width+1,`${label} fits horizontally ${JSON.stringify(r)}`);assert.ok(r.top>=-1&&r.bottom<=r.height+1,`${label} fits vertically ${JSON.stringify(r)}`);assert.ok(r.overflow<=1,`${label} has no horizontal overflow`);}

test('all six localized HTTP customer widgets preserve 320px composer and message layouts',async t=>{
 for(const locale of locales){
  const fixture=await supportFixture(t,environment,{viewport:{width:320,height:568},isMobile:true,hasTouch:true});
  const user=await fixture.customerPage(locale);await sendCustomer(user,'局部客服测试 abcdefghijklmnopqrstuvwxyz'.repeat(4));
  await fits(user,'#support-panel','customer panel');await fits(user,'#support-widget [data-support-text]','customer text');await fits(user,'#support-widget [data-support-send]','customer send');
  assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(fixture.errors,[]);
 }
});

test('short landscape and enlarged text leave customer controls usable',async t=>{
 for(const viewport of [{width:568,height:320},{width:320,height:450}]){
  const fixture=await supportFixture(t,environment,{viewport,isMobile:true,hasTouch:true});
  const user=await fixture.customerPage();await user.locator('#support-widget [data-support-text]').fill('a'.repeat(3800));
  await fits(user,'#support-panel','short customer panel');await fits(user,'#support-widget [data-support-send]','short customer send');
  assert.equal(await user.locator('[data-support-character-count]').isVisible(),true);
  await user.locator('[data-support-close]').click();await user.locator('[data-support-open]').click();assert.equal(await user.locator('#support-widget [data-support-text]').inputValue().then(v=>v.length),3800);assert.deepEqual(fixture.errors,[]);
 }
});

test('all six localized HTTP operator desks keep mobile navigation and customer-details focus intact',async t=>{
 if(!environment.portal){t.skip('SUPPORT_PORTAL_PATH is unconfigured');return;}
 for(const locale of locales){
  const fixture=await supportFixture(t,environment,{viewport:{width:320,height:568},isMobile:true,hasTouch:true});
  const desk=await fixture.operatorPage(locale);await fits(desk,'[data-support-text]','operator composer');await fits(desk,'[data-support-send]','operator send');
  const detailButton=desk.locator('[data-support-details]');await detailButton.click();await desk.locator('[data-support-detail-panel][aria-modal="true"]').waitFor({state:'visible'});
  await fits(desk,'[data-support-detail-panel]','customer detail drawer');await desk.keyboard.press('Tab');
  assert.equal(await desk.evaluate(()=>Boolean(document.activeElement?.closest('[data-support-detail-panel]'))),true);
  await desk.keyboard.press('Escape');assert.equal(await detailButton.getAttribute('aria-expanded'),'false');assert.equal(await detailButton.evaluate(el=>el===document.activeElement),true);
  await desk.locator('[data-support-back]').click();await desk.locator('[data-support-conversation="21"]').waitFor({state:'visible'});await desk.locator('[data-support-conversation="21"]').click();await desk.locator('[data-support-chat]').waitFor({state:'visible'});
  assert.equal(await desk.locator('[data-support-seed]').isVisible(),false);assert.equal(await desk.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(fixture.errors,[]);
 }
});

test('private image dialogs keep keyboard focus contained and restore the original message',async t=>{
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage();
 await user.locator('#support-widget [data-support-file]').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:png});await user.locator('#support-widget [data-support-preview]').waitFor({state:'visible'});await user.locator('#support-widget [data-support-send]').click();
 const trigger=user.locator('#support-widget [data-support-image]');await trigger.waitFor();await trigger.click();await user.locator('dialog.support-image-viewer').waitFor({state:'visible'});
 await user.keyboard.press('Tab');assert.equal(await user.evaluate(()=>Boolean(document.activeElement?.closest('dialog.support-image-viewer'))),true);
 await user.keyboard.press('Escape');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 if(environment.portal){const desk=await fixture.operatorPage();await refresh(desk);const trigger=desk.locator('[data-support-image]');await trigger.waitFor();await trigger.click();await desk.keyboard.press('Escape');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);}
 assert.deepEqual(fixture.errors,[]);
});

test('live message history refresh keeps keyboard focus on the image being read',async t=>{
 const fixture=await supportFixture(t,environment),user=await fixture.customerPage();
 await user.locator('#support-widget [data-support-file]').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:png});
 await user.locator('#support-widget [data-support-preview]').waitFor({state:'visible'});
 await user.locator('#support-widget [data-support-send]').click();
 const customerImage=user.locator('#support-widget [data-support-image]');await customerImage.waitFor();await customerImage.focus();
 fixture.state.messages.push({id:'32',clientMessageId:'external-agent-message',conversationId:'21',sender:'agent',text:'Live reply',attachments:[],createdAt:new Date(1700000002000).toISOString()});
 const customerRefresh=user.waitForResponse(response=>new URL(response.url()).pathname==='/api/support/conversations/21/messages'&&response.request().method()==='GET');
 await user.evaluate(()=>{const channel=new BroadcastChannel('fells.support.changed.v1');channel.postMessage('changed');channel.close();});
 await customerRefresh;
 await user.locator('#support-widget [data-support-message]').filter({hasText:'Live reply'}).waitFor();
 assert.equal(await customerImage.evaluate(element=>element===document.activeElement),true);
 if(environment.portal){
  const desk=await fixture.operatorPage(),operatorImage=desk.locator('[data-support-image]').first();await operatorImage.focus();
  fixture.state.messages.push({id:'33',clientMessageId:'external-customer-message',conversationId:'21',sender:'user',text:'Another live message',attachments:[],createdAt:new Date(1700000003000).toISOString()});
  const operatorRefresh=desk.waitForResponse(response=>new URL(response.url()).pathname==='/api/support/conversations/21/messages'&&response.request().method()==='GET');
  await desk.evaluate(()=>{const channel=new BroadcastChannel('fells.support.changed.v1');channel.postMessage('changed');channel.close();});
  await operatorRefresh;
  await desk.locator('[data-support-message]').filter({hasText:'Another live message'}).waitFor();
  assert.equal(await operatorImage.evaluate(element=>element===document.activeElement),true);
 }
 assert.deepEqual(fixture.errors,[]);
});
