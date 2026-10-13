import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHttpService } from '../src/lib/support-http.ts';
import { APIError } from '../src/lib/app-http.ts';
import { SupportSessionEnded, InvalidSupportData } from '../src/lib/support-store.ts';
import { supportOrdersCopy } from '../src/i18n/support-orders.ts';
const at = '2026-10-13T00:00:00Z';
const envelope = data => ({ ok: true, data, requestId:'test' });
const order = { id:'00000000-0000-4000-8000-000000000090',conversationId:'21',userId:'42',title:'Paid service',product:'allowance',amountMicro:20000000,currency:'CNY',serviceDays:0,status:'awaiting_fulfillment',assigneeId:'84',assigneeName:'Operator',dueAt:null,paymentTopupId:101,subscriptionId:null,subscriptionRef:'',allowanceRef:'allow-1',note:'Public note',version:3,createdAt:at,updatedAt:at,accepted:false,acceptedAt:null,history:[{id:'1',actorName:'Operator',action:'created',note:'Quoted',createdAt:at}],poolId:null,tier:0,months:0,allowanceUsdMicro:10000000,fulfilled:true,fulfilledAt:at };
function fixture(custom) {
  const calls=[];
  const service = createSupportHttpService({ request:async(path,options={}) => {
    calls.push({path,options});
    if (custom) { const answer=await custom(path,options); if(answer!==undefined)return answer; }
    if(path==='/api/app/bootstrap')return{session_id:'a'.repeat(64),user:{id:42}};
    if(path==='/api/support/session')return envelope({sessionId:'b'.repeat(64),operator:{id:'84',name:'Operator',email:'operator@test'},expiresAt:'2035-01-01T00:00:00Z'});
    if(path==='/api/support/operators')return envelope({items:[{id:'84',name:'Operator'}]});
    if(path==='/api/support/catalog')return envelope({subscriptions:[{poolId:11,poolName:'Plan',tier:1,monthlyMicro:120000000}],allowance:{priceCny:2}});
    if(path.includes('/orders?'))return envelope({items:[order],nextCursor:null,hasMore:false});
    if(path.includes('/orders'))return envelope(order);
    throw Error('Unhandled '+path);
  },notify:()=>{} });
  return {service,calls};
}
test('sales and acceptance use expected Cookie audience, numeric money and original version',async()=>{
  const {service,calls}=fixture(),agent=await service.readSupportSession(),customer=await service.readCustomerSession();
  assert.equal(agent.id,'84');
  assert.equal((await service.listSupportOperators(agent.session))[0].name,'Operator');
  await service.getSupportCatalog(agent.session);
  const page=await service.listSupportOrders('operator',agent.session,'21');
  assert.equal(page.items[0].id,'00000000-0000-4000-8000-000000000090');
  assert.equal(page.items[0].history[0].id,'1','history retains its decimal identity');
  assert.equal(page.items[0].paymentTopupId,'101');assert.equal(page.items[0].subscriptionId,'');
  await service.createSupportOrder(agent.session,'21',{clientOrderId:crypto.randomUUID(),title:'Quote',product:'allowance',amountMicro:20000000,serviceDays:0,poolId:null,tier:0,months:0,dueAt:null,note:''});
  await service.updateSupportOrder(agent.session,'00000000-0000-4000-8000-000000000090',{version:3,paymentTopupId:101,status:'awaiting_fulfillment'});
  const intent={version:3,operationId:crypto.randomUUID(),enableApiKeys:true};
  await service.fulfillSupportOrder(agent.session,'00000000-0000-4000-8000-000000000090',intent);
  await service.listSupportOrders('customer',customer.session,'21');
  await service.acceptSupportOrder(customer.session,'00000000-0000-4000-8000-000000000090',3);
  for(const c of calls.filter(c=>c.path.startsWith('/api/support/')&&c.path!=='/api/support/session')){
    assert.ok(c.options.signal instanceof AbortSignal);
    assert.ok(c.options.headers['X-Fells-Expected-Operator-Session']||c.options.headers['X-Fells-Expected-Session']);
  }
  assert.equal(calls.find(c=>c.path.endsWith('/accept')).options.headers['X-Fells-Support-Audience'],'customer');
  assert.deepEqual(calls.find(c=>c.path.endsWith('/fulfill')).options.body,intent);
  assert.ok(calls.find(c=>c.path.endsWith('/fulfill')).path.includes(order.id));
  await assert.rejects(service.updateSupportOrder(agent.session,'90',{version:3,note:'wrong ID'}),InvalidSupportData);
  await assert.rejects(service.listSupportOrders('customer',customer.session),InvalidSupportData);
});
test('stale sessions cannot write orders and malformed financial response is rejected',async()=>{
  const f=fixture(),agent=await f.service.readSupportSession();
  f.service.invalidateSession('operator');
  await assert.rejects(f.service.updateSupportOrder(agent.session,'00000000-0000-4000-8000-000000000090',{version:3,note:'stale'}),SupportSessionEnded);
  assert.equal(f.calls.filter(c=>c.options.method==='PATCH').length,0);
  const malformed=fixture(path=>path.includes('/orders?')?envelope({items:[{...order,amountMicro:0.2}],nextCursor:null}):undefined);
  const next=await malformed.service.readSupportSession();
  await assert.rejects(malformed.service.listSupportOrders('operator',next.session,'21'),InvalidSupportData);
  const decimal=fixture(path=>path.includes('/orders?')?envelope({items:[{...order,id:'90'}],nextCursor:null}):undefined);
  const decimalAgent=await decimal.service.readSupportSession();
  await assert.rejects(decimal.service.listSupportOrders('operator',decimalAgent.session,'21'),InvalidSupportData);
});
test('failed order saves propagate actual backend error without a fabricated completion',async()=>{
  const f=fixture(path=>{if(path.endsWith('/fulfill'))throw new APIError(409,'Payment not verified','conflict');});
  const agent=await f.service.readSupportSession();
  await assert.rejects(f.service.fulfillSupportOrder(agent.session,'00000000-0000-4000-8000-000000000090',{version:3,operationId:crypto.randomUUID(),enableApiKeys:true}),error=>error instanceof APIError&&error.message==='Payment not verified');
});
test('work-item customer copy is complete in all six locales',()=>{
  for(const locale of ['en','zh-CN','zh-TW','ja','ko','es']){
    const copy=supportOrdersCopy(locale);
    for(const [key,value] of Object.entries(copy))assert.ok(value&&typeof value==='object'||typeof value==='string'&&value.length>0,`${locale}:${key}`);
    assert.equal(Object.keys(copy.statuses).length,8);
  }
});
test('order SSE event reaches the UI refresh path with the authenticated operator audience',async()=>{
  const listeners=new Map(),received=[];
  const service=createSupportHttpService({
    request:async()=>envelope({sessionId:'b'.repeat(64),operator:{id:'84',name:'Operator',email:'operator@test'},expiresAt:'2035-01-01T00:00:00Z'}),
    eventSource:url=>{assert.match(url,/audience=operator/);return{addEventListener:(kind,callback)=>listeners.set(kind,callback),close(){},onerror:null};},
    notify:()=>{},
  });
  const agent=await service.readSupportSession();
  const connection=service.openSupportEvents('operator',agent.session,event=>received.push(event));
  listeners.get('order.updated')({data:JSON.stringify({id:'100',type:'order.updated',data:{conversationId:'21',orderId:'00000000-0000-4000-8000-000000000090',version:4}})});
  assert.equal(received[0].type,'order.updated');assert.equal(received[0].data.version,4);
  connection.close();
});
