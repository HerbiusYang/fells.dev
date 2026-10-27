import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createBrowserFixture} from '../helpers/browser.mjs';
import {createAppBackend} from '../helpers/app-backend.mjs';
const fixture=createBrowserFixture();before(()=>fixture.start());after(()=>fixture.stop());
const preferences={theme:'light',prefs:{agent:'',send:0},notifs:[true,true,true,false],onboarded:true,answers:[[0],[0],[0],[0]],promoClosed:true,sbHidden:false};
async function open(t,logs){
  const session=await fixture.setup(t);const backend=createAppBackend({preferences,modelChat:true,keys:[{id:17,name:'Personal key',kind:'user',prefix:'sk-example…',expires_at:0,revoked:false,created_at:1700000000}]});
  await backend.install(session.context);let reads=0;
  await session.context.route(/\/api\/app\/logs(?:\?.*)?$/,route=>{reads++;return route.fulfill({json:{logs,retention_days:30}})});
  await session.page.goto(session.base+'/app/#/api');await session.page.locator('[data-act=api-logs]').waitFor();
  return {...session,readCount:()=>reads};
}
test('request metrics stay inside the logs dialog and use recorded cache partitions and duration bins',async t=>{
  const rows=[0,500,1500,3000,6000].map((latency_ms,index)=>({id:index+1,model:`recorded-${index}`,protocol:index===1?'openai':'anthropic',ts:1700000000,status:index===4?502:200,latency_ms,tokens_in:100,tokens_out:20,tokens_cache_r:50,tokens_cache_w:30,tokens_cache_w1h:10,allow_micro:0}));
  const {page,errors,readCount}=await open(t,rows);
  assert.equal(readCount(),0);assert.equal(await page.locator('[data-request-tokens],[data-request-durations]').count(),0);
  await page.locator('[data-act=api-logs]').click();const dialog=page.locator('.api-log-dialog');await dialog.locator('.api-log-row').first().waitFor();
  assert.equal(readCount(),1);assert.equal(await dialog.locator('[data-request-durations]').getAttribute('open'),null);
  await dialog.locator('[data-request-durations] > summary').click();
  assert.match(await dialog.locator('[data-request-durations]').innerText(),/P50 1500 ms · P95 6000 ms/);
  assert.deepEqual(await dialog.locator('.api-duration-buckets dd').allTextContents(),['1','1','1','1','1']);
  assert.match(await dialog.locator('[data-request-durations]').innerText(),/loaded search results.*including errors/i);
  const first=dialog.locator('.api-log-row').filter({hasText:'recorded-0'});await first.locator('[data-request-tokens] > summary').click();
  assert.deepEqual(await first.locator('.api-token-parts dd').allTextContents(),['100','50','20','10','20','200']);
  const second=dialog.locator('.api-log-row').filter({hasText:'recorded-1'});await second.locator('[data-request-tokens] > summary').click();
  assert.deepEqual(await second.locator('.api-token-parts dd').allTextContents(),['50','50','20','10','20','150']);
  await dialog.locator('[data-input=logsQuery]').fill('recorded-3');
  await dialog.locator('[data-request-durations] > summary').click();
  assert.match(await dialog.locator('[data-request-durations]').innerText(),/P50 3000 ms · P95 3000 ms/);
  assert.equal(readCount(),1,'sample search is local and never performs inference');
  await dialog.locator('[data-act=close]').click();assert.equal(await page.locator('[data-request-tokens],[data-request-durations]').count(),0);assert.deepEqual(errors,[]);
});
test('missing metrics stay unavailable while genuine zero counters and latency remain zero',async t=>{
  const {page,errors}=await open(t,[{id:1,model:'missing',ts:1700000000,status:502},{id:2,model:'zero',ts:1700000000,status:200,protocol:'anthropic',latency_ms:0,tokens_in:0,tokens_out:0,tokens_cache_r:0,tokens_cache_w:0}]);
  await page.locator('[data-act=api-logs]').click();const dialog=page.locator('.api-log-dialog');await dialog.locator('.api-log-row').first().waitFor();
  const missing=dialog.locator('.api-log-row').filter({hasText:'missing'});await missing.locator('[data-request-tokens] > summary').click();assert.match(await missing.innerText(),/not recorded/);assert.equal(await missing.locator('.api-token-bar').count(),0);
  const zero=dialog.locator('.api-log-row').filter({hasText:'zero'});await zero.locator('[data-request-tokens] > summary').click();assert.deepEqual(await zero.locator('.api-token-parts dd').allTextContents(),['0','0','0','0','0','0']);
  await dialog.locator('[data-request-durations] > summary').click();assert.match(await dialog.locator('[data-request-durations]').innerText(),/P50 0 ms · P95 0 ms/);
  await dialog.locator('[data-input=logsQuery]').fill('missing');await dialog.locator('[data-request-durations] > summary').click();assert.match(await dialog.locator('[data-request-durations]').innerText(),/No recorded durations/);assert.equal(await dialog.locator('.api-duration-buckets').count(),0);assert.deepEqual(errors,[]);
});
