import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportHttpService } from '../src/lib/support-http.ts';
import { APIError } from '../src/lib/app-http.ts';
import { SupportSessionEnded, InvalidSupportData } from '../src/lib/support-store.ts';
import { png } from './fixtures/support-images.mjs';

const at = i => new Date(1700000000000 + i * 1000).toISOString();
const envelope = data => ({ ok: true, data, requestId: 'test-request' });
const customer = { id:'11',name:'Customer',email:'customer@example.test',joinedAt:at(0),preferredLocale:'zh-CN',workspaceCount:3,credits:2.75,creditsCurrency:'USD',creditsKind:'api_allowance',walletCashMicro:12000000,walletCurrency:'CNY' };
const detail = (id='21',user=customer) => ({id,customer:user,status:'open',lastMessage:null,unreadCount:0,updatedAt:at(10),userRead:{lastReadMessageId:null,updatedAt:null},agentRead:{lastReadMessageId:null,updatedAt:null}});
const dtoMessage = (id='31',sender='user',text='hello') => ({id,conversationId:'21',clientMessageId:crypto.randomUUID(),sender,text,attachments:[],createdAt:at(Number(id))});
const media = audience => ({id:'image-1',name:'image.png',mimeType:'image/png',size:png.length,url:`/api/support/attachments/image-1?expires=2000000000&signature=abc&audience=${audience}`,urlExpiresAt:at(100)});
const session = { sessionId:'b'.repeat(64),operator: { id:'51',name:'Operator',email:'operator@example.test' },expiresAt:at(30000000) };
const deferred = () => { let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{resolve,reject,promise}; };

test('Access session logout broadcasts only the fixed Access exit after revocation succeeds',async()=>{
 const f=setup(async(path,options)=>path==='/api/support/session'&&options.method!=='DELETE'?envelope({...session,authMethod:'access'}):undefined);
 const agent=await f.service.readSupportSession();assert.equal(agent.authMethod,'access');
 await f.service.endSupportSession(agent.session);
 const event=f.notifications.find(([name])=>name==='fells.session.changed')[1];
 assert.equal(event.audience,'operator');assert.equal(event.redirect,'/cdn-cgi/access/logout');
 const failed=setup(async(path,options)=>{if(path==='/api/support/session'){if(options.method==='DELETE')throw new APIError(503,'Could not revoke');return envelope({...session,authMethod:'access'});}});
 const active=await failed.service.readSupportSession();await assert.rejects(failed.service.endSupportSession(active.session),APIError);
 assert.deepEqual(failed.notifications,[]);
 assert.equal((await failed.service.readSupportSession()).session,active.session);
});

test('unknown authentication methods and an expired Access identity never keep a usable operator handle',async()=>{
 const malformed=setup(async path=>path==='/api/support/session'?envelope({...session,authMethod:'external-redirect'}):undefined);
 await assert.rejects(malformed.service.readSupportSession(),InvalidSupportData);
 let denied=false;
 const f=setup(async path=>{if(path==='/api/support/session'){if(denied)throw new APIError(403,'Access required','access_required');return envelope({...session,authMethod:'access'});}});
 const agent=await f.service.readSupportSession();denied=true;
 await assert.rejects(f.service.readSupportSession(),SupportSessionEnded);
 await assert.rejects(f.service.readSupport(agent.session),SupportSessionEnded);
});

test('Access logout remains bound and retryable when SSE expires before its response',async()=>{
 const gate=deferred();let attempts=0;
 const f=setup(async(path,options)=>{
  if(path==='/api/support/session'){
   if(options.method==='DELETE'){attempts++;return attempts===1?gate.promise:envelope(null);}
   return envelope({...session,authMethod:'access'});
  }
 });
 const agent=await f.service.readSupportSession();
 f.service.openSupportEvents('operator',agent.session,()=>{});
 const first=f.service.endSupportSession(agent.session);
 f.streams[0].emit('session.expired',{});
 assert.equal(f.streams[0].closed,true);
 gate.reject(new TypeError('Lost revocation response'));await assert.rejects(first,/Lost revocation response/);
 assert.deepEqual(f.notifications,[],'A failed response must not report successful logout');
 await f.service.endSupportSession(agent.session);
 const calls=f.calls.filter(call=>call.options.method==='DELETE');
 assert.equal(calls.length,2);assert.deepEqual(calls[0].options.headers,calls[1].options.headers);
 assert.equal(calls[0].options.signal,undefined,'SSE expiry cannot abort the pending DELETE');
 assert.equal(f.notifications[0][1].redirect,'/cdn-cgi/access/logout');
 assert.equal(f.calls.filter(call=>call.path==='/api/support/session'&&!call.options.method).length,1,'Retry never bootstraps another session');
});

test('only the fixed Access logout broadcast defers stream navigation while invalidating operator data',async()=>{
 for(const redirect of ['/cdn-cgi/access/logout','https://untrusted.invalid/']){
  const f=setup();const user=await f.service.readCustomerSession(),agent=await f.service.readSupportSession();let expired=0;
  f.service.openSupportEvents('operator',agent.session,()=>expired++);
  f.service.handleSessionChange({audience:'operator',source:'other-tab',redirect});
  assert.equal(f.streams[0].closed,true);assert.equal(expired,redirect==='/cdn-cgi/access/logout'?0:1);
  await assert.rejects(f.service.readSupport(agent.session),SupportSessionEnded);
  assert.equal((await f.service.readCustomerSession()).session,user.session,'Customer binding is independent');
 }
});
test('server-confirmed Access expiry reaches the fixed exit before another tab can navigate to admin',async()=>{
 const f=setup(async(path,options)=>path==='/api/support/session'&&!options.method?envelope({...session,authMethod:'access'}):undefined);
 const user=await f.service.readCustomerSession(),agent=await f.service.readSupportSession();let expired=0;
 f.service.openSupportEvents('operator',agent.session,()=>expired++);
 f.streams[0].emit('session.expired',{role:'agent',redirect:'https://untrusted.invalid/'});
 assert.equal(f.streams[0].closed,true);
 assert.equal(expired,0,'a generic expiry callback must not race the fixed Access exit');
 await assert.rejects(f.service.readSupport(agent.session),SupportSessionEnded);
 assert.equal(f.notifications.length,1);
 assert.equal(f.notifications[0][0],'fells.session.changed');
 assert.equal(f.notifications[0][1].audience,'operator');
 assert.equal(f.notifications[0][1].redirect,'/cdn-cgi/access/logout','the server payload cannot supply an arbitrary redirect');
 assert.equal((await f.service.readCustomerSession()).session,user.session);
 assert.equal(f.calls.filter(call=>call.options.method==='DELETE').length,0,'this is independent confirmation from the authenticated event stream');
});
function setup(custom) {
 const calls=[],streams=[],notifications=[];
 let messages=[],conversation=detail();
 const request=async(path,options={})=>{
  calls.push({path,options});
  if(custom){const answer=await custom(path,options,{calls,get messages(){return messages},set messages(v){messages=v},get conversation(){return conversation},set conversation(v){conversation=v}});if(answer!==undefined)return answer;}
  if(path==='/api/app/bootstrap')return{session_id:'a'.repeat(64),user:{id:11,username:'customer'}};
  if(path==='/api/support/session')return envelope(options.method==='DELETE'?null:session);
  if(path==='/api/support/conversations/current' || path==='/api/support/conversations/21')return envelope(conversation);
  if(path==='/api/support/conversations?limit=100')return envelope({items:[conversation],nextCursor:null});
  if(path==='/api/support/conversations/21/messages?limit=200')return envelope({items:messages,nextCursor:null});
  if(path==='/api/support/conversations/21/messages' && options.method==='POST'){
   const message={...dtoMessage(String(31+messages.length),options.headers['X-Fells-Support-Audience']==='operator'?'agent':'user',options.body.text),clientMessageId:options.body.clientMessageId};
   if(options.body.attachmentIds.length)message.attachments=[media(options.headers['X-Fells-Support-Audience'])];
   messages=[...messages,message];return envelope(message);
  }
  if(path==='/api/support/attachments')return envelope(media(options.headers['X-Fells-Support-Audience']));
  if(path.endsWith('/read'))return envelope({lastReadMessageId:options.body.lastReadMessageId,updatedAt:at(99)});
  if(path.endsWith('/typing'))return envelope({user:true,agent:false});
  if(path==='/api/support/availability')return envelope({online:true});
  if(path.endsWith('/status') || path.endsWith('/availability'))return envelope(null);
  throw Error(`Unhandled ${path}`);
 };
 const eventSource=url=>{
  const listeners=new Map();
  const stream={url,closed:false,readyState:0,onerror:null,addEventListener(name,listener){listeners.set(name,listener)},close(){this.closed=true;this.readyState=2},fail(readyState=2){this.readyState=readyState;this.onerror?.({})},emit(type,data,id='71'){if(type==='open')this.readyState=1;listeners.get(type)?.({data:JSON.stringify({id,type,data})})}};
  streams.push(stream);return stream;
 };
 const service=createSupportHttpService({request,eventSource,notify:(...args)=>notifications.push(args)});
 return{service,calls,streams,notifications};
}

test('customer end uses the visible message snapshot and customer authority without modifying finance',async()=>{
 const f=setup(async(path,options,state)=>{
  if(path==='/api/support/conversations/21/end'){
   assert.equal(options.method,'POST');
   assert.equal(options.headers['X-Fells-Support-Audience'],'customer');
   assert.equal(options.body.lastMessageId,null);
   state.conversation={...state.conversation,status:'resolved'};
   return envelope(state.conversation);
  }
 });
 const customer=await f.service.readCustomerSession();
 const visible=await f.service.ensureUserConversation(customer,'en');
 const ended=await f.service.endUserConversation(customer.session,visible);
 assert.equal(ended.status,'resolved');
 assert.equal(f.calls.filter(call=>call.options.method==='POST').length,1);
 assert.equal(f.calls.some(call=>/\/orders|\/cases|\/status|\/wallet/.test(call.path)),false);
 await assert.rejects(f.service.endUserConversation(customer.session,{...visible,id:'99'}),InvalidSupportData);
});

test('a newer background read cannot replace the visible cursor used to end a conversation',async()=>{
 let newer=false;
 const f=setup(async(path,options,state)=>{
  if(path==='/api/support/conversations/current'){
   state.messages=newer?[dtoMessage('31'),dtoMessage('32','agent','Unseen reply')]:[dtoMessage('31')];
   state.conversation={...state.conversation,lastMessage:state.messages.at(-1)};
  }
  if(path==='/api/support/conversations/21/end'){
   assert.deepEqual(options.body,{lastMessageId:'31'});
   throw new APIError(409,'New reply arrived','conflict');
  }
 });
 const customer=await f.service.readCustomerSession();
 const visible=await f.service.ensureUserConversation(customer,'en');
 newer=true;await f.service.ensureUserConversation(customer,'en');
 await assert.rejects(f.service.endUserConversation(customer.session,visible),failure=>failure instanceof APIError&&failure.status===409);
 assert.equal(f.calls.filter(call=>call.path.endsWith('/end')).length,1,'End is never automatically retried against unseen messages');
});

test('customer end never refreshes or exposes a replacement account after its response arrives',async()=>{
 const gate=deferred();
 const f=setup(async(path)=>path.endsWith('/end')?gate.promise:undefined);
 const customer=await f.service.readCustomerSession(),visible=await f.service.ensureUserConversation(customer,'en');
 const ending=f.service.endUserConversation(customer.session,visible);
 f.service.handleSessionChange({audience:'customer',source:'another-tab'});
 gate.resolve(envelope({...detail(),status:'resolved'}));
 await assert.rejects(ending,SupportSessionEnded);
 assert.equal(f.calls.filter(call=>call.path==='/api/app/bootstrap').length,1);
});

test('wallet SSE notifies only its bound customer identity and never trusts payload money',async()=>{
 const f=setup(),customer=await f.service.readCustomerSession();
 const connection=f.service.openSupportEvents('customer',customer.session,()=>{});
 f.streams[0].emit('wallet.updated',{conversationId:'21',cashMicro:999999999,userId:'forged'});
 assert.deepEqual(f.notifications.filter(([name])=>name==='fells.wallet.changed'),[['fells.wallet.changed',{userId:'11',sessionId:'a'.repeat(64)}]]);
 f.service.invalidateSession('customer');f.streams[0].emit('wallet.updated',{conversationId:'21'});
 assert.equal(f.notifications.filter(([name])=>name==='fells.wallet.changed').length,1);connection.close();
 const agent=await f.service.readSupportSession();f.service.openSupportEvents('operator',agent.session,()=>{});
 f.streams[1].emit('wallet.updated',{conversationId:'21'});assert.equal(f.notifications.filter(([name])=>name==='fells.wallet.changed').length,1);
});

test('native CONNECTING errors retain the same stream and binding through transient probes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let unavailable=false;
 const f=setup(async path=>{if(path==='/api/support/session'&&unavailable)throw new APIError(503,'Restarting');});
 const agent=await f.service.readSupportSession(),events=[];
 const connection=f.service.openSupportEvents('operator',agent.session,event=>events.push(event));
 unavailable=true;f.streams[0].fail(0);await new Promise(setImmediate);
 t.mock.timers.tick(120000);
 assert.equal(f.streams.length,1);assert.equal(f.streams[0].closed,false);assert.deepEqual(events,[]);
 unavailable=false;assert.equal((await f.service.readSupportSession()).session,agent.session);connection.close();
});

test('CLOSED streams use six bounded backoff replacements and a successful open resets the budget',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=setup(),agent=await f.service.readSupportSession(),events=[];
 const connection=f.service.openSupportEvents('operator',agent.session,event=>events.push(event));
 for(const delay of [1000,2000,4000,8000,16000,30000]){
  const prior=f.streams.at(-1),count=f.streams.length;
  prior.fail();prior.fail();await new Promise(setImmediate);
  t.mock.timers.tick(delay-1);assert.equal(f.streams.length,count,'one timer follows the required backoff');
  t.mock.timers.tick(1);assert.equal(f.streams.length,count+1);assert.equal(prior.closed,true);
  assert.equal(f.streams.at(-1).url,f.streams[0].url,'the expected identity never changes');
  prior.emit('message.created',{});assert.deepEqual(events,[],'late events from replaced sources are ignored');
 }
 f.streams.at(-1).fail();await new Promise(setImmediate);t.mock.timers.tick(120000);
 assert.equal(f.streams.length,7,'the exhausted budget leaves UI polling, not unlimited retries');connection.close();
 const recovered=setup(),same=await recovered.service.readSupportSession();
 const next=recovered.service.openSupportEvents('operator',same.session,()=>{});
 recovered.streams[0].fail();await new Promise(setImmediate);t.mock.timers.tick(1000);
 recovered.streams[1].emit('open',{});recovered.streams[1].fail();await new Promise(setImmediate);
 t.mock.timers.tick(999);assert.equal(recovered.streams.length,2);t.mock.timers.tick(1);assert.equal(recovered.streams.length,3);
 next.close();
});

test('pending identity rejection invalidates the binding before or after a retry timer replaces its source',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const status of [401,403])for(const replaceFirst of [false,true]){
  const gate=deferred();let probing=false;
  const f=setup(async path=>{if(path==='/api/support/session'&&probing)return gate.promise;});
  const agent=await f.service.readSupportSession(),events=[];
  f.service.openSupportEvents('operator',agent.session,event=>events.push(event));
  probing=true;f.streams[0].fail();await new Promise(setImmediate);
  if(replaceFirst)t.mock.timers.tick(1000);
  assert.equal(f.streams.length,replaceFirst?2:1,'a pending probe does not block bounded recovery');
  gate.reject(new APIError(status,'Identity rejected'));await new Promise(setImmediate);
  assert.equal(events.at(-1).type,'session.expired');assert.ok(f.streams.every(stream=>stream.closed));
  await assert.rejects(f.service.readSupport(agent.session),SupportSessionEnded);
  const count=f.streams.length;t.mock.timers.tick(120000);assert.equal(f.streams.length,count);
 }
});

test('replacement streams preserve an exact valid event cursor only within the existing identity',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=setup(),agent=await f.service.readSupportSession();
 f.service.openSupportEvents('operator',agent.session,()=>{});
 const cursor='9007199254740993';
 f.streams[0].emit('message.created',{},cursor);
 for(const invalid of ['-1','1e9','99999999999999999999','9223372036854775808'])f.streams[0].emit('message.created',{},invalid);
 f.streams[0].emit('message.created',{},'3');
 f.streams[0].fail();await new Promise(setImmediate);t.mock.timers.tick(1000);
 const query=new URL(f.streams[1].url,'https://test.invalid').searchParams;
 assert.equal(query.get('lastEventId'),cursor);assert.equal(query.get('expected_operator'),'51');assert.equal(query.get('expected_operator_session'),'b'.repeat(64));
 f.service.handleSessionChange({audience:'operator',source:'another-tab'});
 const next=await f.service.readSupportSession();
 const connection=f.service.openSupportEvents('operator',next.session,()=>{});
 assert.equal(new URL(f.streams[2].url,'https://test.invalid').searchParams.has('lastEventId'),false,'a new binding starts without the old cursor');connection.close();
});

test('close and logout cancel replacements while late probes cannot restore or silently change identities',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const action of ['close','logout','identity-change']){
  const gate=deferred(),logout=deferred();let probing=false;
  const f=setup(async(path,options)=>{
   if(path==='/api/support/session'){
    if(options.method==='DELETE')return logout.promise;
    if(probing)return gate.promise;
   }
  });
  const agent=await f.service.readSupportSession();
  const connection=f.service.openSupportEvents('operator',agent.session,()=>{});
  probing=true;f.streams[0].fail();await new Promise(setImmediate);
  let leaving;
  if(action==='close')connection.close();
  if(action==='logout')leaving=f.service.endSupportSession(agent.session);
  if(action==='identity-change')f.service.handleSessionChange({audience:'operator',source:'another-tab'});
  assert.equal(f.streams[0].closed,true);
  gate.resolve(envelope({...session,sessionId:'c'.repeat(64),operator:{...session.operator,id:'52'}}));await new Promise(setImmediate);
  t.mock.timers.tick(120000);assert.equal(f.streams.length,1);
  await assert.rejects(f.service.readSupport(agent.session),SupportSessionEnded,'a late new identity is never bound by the probe');
  if(leaving){logout.resolve(envelope(null));await leaving;}
 }
});

test('logout does not hide a pending valid authorization failure or revive a closed stream',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const status of [401,403]){
  const gate=deferred(),logout=deferred();let probing=false;
  const f=setup(async(path,options)=>{if(path==='/api/support/session'){if(options.method==='DELETE')return logout.promise;if(probing)return gate.promise;}});
  const agent=await f.service.readSupportSession();f.service.openSupportEvents('operator',agent.session,()=>{});
  probing=true;f.streams[0].fail();await new Promise(setImmediate);
  const leaving=f.service.endSupportSession(agent.session);
  gate.reject(new APIError(status,'Identity rejected'));await new Promise(setImmediate);
  await assert.rejects(f.service.readSupport(agent.session),SupportSessionEnded);
  t.mock.timers.tick(120000);assert.equal(f.streams.length,1);assert.equal(f.streams[0].closed,true);
  logout.resolve(envelope(null));await leaving;
 }
});

test('support HTTP selects real Cookie audience and expected server identity for every action',async()=>{
 const {service,calls}=setup();
 const user=await service.readCustomerSession();
 assert.equal(user.userId,'11');assert.notEqual(user.session,'11');
 const conv=await service.ensureUserConversation(user,'zh-CN');
 assert.equal(conv.demo,false);assert.equal(conv.user.credits,2.75);
 assert.equal(calls.some(c=>c.path.endsWith('/current')&&c.options.method==='POST'),false,'existing conversation is not recreated on refresh');
 await service.sendUserMessage(user.session,'customer text');
 await service.markUserRead(user.session);
 await service.setUserTyping(user.session,true,crypto.randomUUID());
 assert.equal(await service.readUserTyping(user.session),false);
 assert.equal(await service.readSupportAvailability(user.session),true);
 const operator=await service.readSupportSession();
 await service.readSupport(operator.session);
 await service.sendAgentMessage(operator.session,'21','operator text');
 await service.markAgentRead(operator.session,'21');
 await service.setConversationStatus(operator.session,'21','resolved');
 await service.setAgentTyping(operator.session,'21',true,crypto.randomUUID());
 assert.equal(await service.readAgentTyping(operator.session,'21'),true);
 await service.setAgentAvailability(operator.session,true,crypto.randomUUID());
 for(const call of calls.filter(c=>c.path.startsWith('/api/support/')&&c.path!='/api/support/session')){
  const role=call.options.headers['X-Fells-Support-Audience'];
  assert.ok(role==='customer'||role==='operator');
  assert.equal(call.options.headers[role==='customer'?'X-Fells-Expected-User':'X-Fells-Expected-Operator'],role==='customer'?'11':'51');
  assert.ok(call.options.signal instanceof AbortSignal);
 }
 const sends=calls.filter(c=>c.options.method==='POST'&&c.path.endsWith('/messages'));
 assert.deepEqual(sends.map(c=>c.options.headers['X-Fells-Support-Audience']),['customer','operator']);
 assert.ok(sends.every(c=>!('sender' in c.options.body)));
});

test('signed API allowance loads customer details and the complete operator inbox',async()=>{
 const negative=detail('21',{...customer,credits:-0.1});
 const normal=detail('22',{...customer,id:'12'});
 const {service}=setup(async path=>{
  if(path==='/api/support/conversations?limit=100')return envelope({items:[negative,normal],nextCursor:null});
  if(path==='/api/support/conversations/current'||path==='/api/support/conversations/21')return envelope(negative);
  if(path==='/api/support/conversations/22')return envelope(normal);
  if(path==='/api/support/conversations/22/messages?limit=200')return envelope({items:[],nextCursor:null});
 });
 const user=await service.readCustomerSession();
 assert.equal((await service.ensureUserConversation(user,'en')).user.credits,-0.1);
 const operator=await service.readSupportSession();
 const inbox=await service.readSupport(operator.session);
 assert.deepEqual(inbox.map(item=>[item.id,item.user.credits]),[['21',-0.1],['22',2.75]]);
});

test('signed allowance still rejects nonfinite balances and invalid customer metadata',async()=>{
 for(const altered of [{credits:NaN},{credits:Infinity},{credits:-Infinity},{credits:'-0.1'},{workspaceCount:-1},{creditsCurrency:'CNY'},{creditsKind:'cash'}]){
  const {service}=setup(async path=>path==='/api/support/conversations/current'?envelope(detail('21',{...customer,...altered})):undefined);
  const user=await service.readCustomerSession();
  await assert.rejects(service.ensureUserConversation(user,'en'),InvalidSupportData);
 }
});

test('message retry preserves UUID and uploaded attachment after a lost success response',async()=>{
 let lost=true;
 const ids=[];
 const {service,calls}=setup(async(path,options,state)=>{
  if(path.endsWith('/messages')&&options.method==='POST'){
   ids.push(options.body.clientMessageId);
   if(lost){lost=false;state.messages=[{...dtoMessage(),attachments:[media('customer')]}];throw new TypeError('network response lost');}
   return envelope(state.messages[0]);
  }
 });
 const user=await service.readCustomerSession();await service.ensureUserConversation(user,'en');
 const image={name:'image.png',type:'image/png',size:png.length,dataUrl:`data:image/png;base64,${png.toString('base64')}`};
 await assert.rejects(service.sendUserMessage(user.session,'with image',image),/network response lost/);
 const result=await service.sendUserMessage(user.session,'with image',image);
 assert.equal(ids[0],ids[1]);assert.equal(calls.filter(c=>c.path==='/api/support/attachments').length,1);
 assert.ok(calls.find(c=>c.path==='/api/support/attachments').options.body instanceof FormData);
 assert.match(result.messages[0].image.dataUrl,/^\/api\/support\/attachments\//);
 await service.sendUserMessage(user.session,'with image',image);
 assert.notEqual(ids[1],ids[2],'confirmed next send creates a new operation');
});

test('all message pages load without preview limits and reads use the visible message cursor',async()=>{
 const first=Array.from({length:200},(_,i)=>dtoMessage(String(100+i),'agent',String(i)));
 const {service,calls}=setup(async(path,_options)=>{
  if(path.endsWith('/messages?limit=200'))return envelope({items:first,nextCursor:'299'});
  if(path.endsWith('/messages?limit=200&cursor=299'))return envelope({items:[dtoMessage('300','agent','final')],nextCursor:null});
 });
 const user=await service.readCustomerSession();const conv=await service.ensureUserConversation(user,'en');
 assert.equal(conv.messages.length,201);
 await service.markUserRead(user.session,Date.parse(first[49].createdAt));
 assert.equal(calls.find(c=>c.path.endsWith('/read')).options.body.lastReadMessageId,'149');
});

test('pagination rejects repeated cursors and image URLs reject remote or wrong audience sources',async()=>{
 const repeated=setup(async path=>path.includes('/messages?')?envelope({items:[],nextCursor:'31'}):undefined);
 const user=await repeated.service.readCustomerSession();
 await assert.rejects(repeated.service.ensureUserConversation(user,'en'),InvalidSupportData);
 for(const altered of [{url:'https://remote.example/image.png'},{url:media('operator').url}]){
  const {service}=setup(async path=>path.includes('/messages?')?envelope({items:[{...dtoMessage(),attachments:[{...media('customer'),...altered}]}],nextCursor:null}):undefined);
  const user=await service.readCustomerSession();await assert.rejects(service.ensureUserConversation(user,'en'),InvalidSupportData);
 }
});

test('customer and operator SSE bind expected identities and independent logout closes only one audience',async()=>{
 const {service,streams}=setup();
 const user=await service.readCustomerSession(),agent=await service.readSupportSession();
 const userEvents=[],agentEvents=[];
 service.openSupportEvents('customer',user.session,event=>userEvents.push(event));
 service.openSupportEvents('operator',agent.session,event=>agentEvents.push(event));
 assert.match(streams[0].url,/audience=customer&expected_user=11/);assert.match(streams[1].url,/audience=operator&expected_operator=51/);
 streams[0].emit('message.created',{conversationId:'21'});assert.equal(userEvents[0].type,'message.created');
 service.handleSessionChange({audience:'operator'});
 assert.equal(streams[0].closed,false);assert.equal(streams[1].closed,true);assert.equal(agentEvents.at(-1).type,'session.expired');
 await service.ensureUserConversation(user,'en');
 service.handleSessionChange({audience:'customer'});assert.equal(streams[0].closed,true);
 await assert.rejects(async()=>service.sendUserMessage(user.session,'stale'),SupportSessionEnded);
});

test('account switching aborts pending requests and rejects late history instead of rendering another customer',async()=>{
 const pending=deferred();let started=false;
 const {service,calls}=setup(async path=>{
  if(path==='/api/support/conversations/current'){started=true;return pending.promise;}
 });
 const user=await service.readCustomerSession();
 const history=service.ensureUserConversation(user,'en');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(started,true);
 service.handleSessionChange({audience:'customer'});
 assert.equal(calls.at(-1).options.signal.aborted,true);
 pending.resolve(envelope(detail('21',{...customer,id:'12'})));
 await assert.rejects(history,SupportSessionEnded);
});

test('server 401 and SSE expiry invalidate handles while missing session returns signed-out state',async()=>{
 const unauth=setup(async path=>{if(path==='/api/app/bootstrap')throw new APIError(401,'login required');});
 assert.equal(await unauth.service.readCustomerSession(),null);
 const {service,streams}=setup(async path=>{if(path==='/api/support/availability')throw new APIError(401,'account changed');});
 const user=await service.readCustomerSession();service.openSupportEvents('customer',user.session,()=>{});
 await assert.rejects(service.readSupportAvailability(user.session),SupportSessionEnded);assert.equal(streams[0].closed,true);
 const other=setup();const agent=await other.service.readSupportSession();const events=[];
 other.service.openSupportEvents('operator',agent.session,e=>events.push(e));
 other.streams[0].emit('session.expired',{role:'agent'});
 assert.equal(other.streams[0].closed,true);assert.equal(events.at(-1).type,'session.expired');
});

test('UTF16 limit rejects 2001 emoji without sending and a changed draft has a new idempotent operation',async()=>{
 const ids=[];const {service,calls}=setup(async(path,options)=>{
  if(path.endsWith('/messages')&&options.method==='POST'){ids.push(options.body.clientMessageId);throw new TypeError('offline');}
 });
 const user=await service.readCustomerSession();await service.ensureUserConversation(user,'en');
 await assert.rejects(service.sendUserMessage(user.session,'😀'.repeat(2001)),InvalidSupportData);
 assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
 await assert.rejects(service.sendUserMessage(user.session,'one'),/offline/);
 await assert.rejects(service.sendUserMessage(user.session,'two'),/offline/);
 assert.notEqual(ids[0],ids[1]);
});


test('same-millisecond messages keep distinct ordered UI read positions and exact server read cursors',async()=>{
 const raw=[dtoMessage('31','agent'),{...dtoMessage('32','agent'),createdAt:at(31)}];
 const {service,calls}=setup(async(path,_options,state)=>{
  state.conversation={...state.conversation,userRead:{lastReadMessageId:'31',updatedAt:at(99)}};
  if(path.includes('/messages?'))return envelope({items:raw,nextCursor:null});
 });
 const user=await service.readCustomerSession(),conversation=await service.ensureUserConversation(user,'en');
 assert.equal(conversation.messages[1].created,conversation.messages[0].created+1);
 assert.equal(conversation.userReadAt,conversation.messages[0].created);
 await service.markUserRead(user.session,conversation.messages[0].created);
 assert.equal(calls.find(c=>c.path.endsWith('/read')).options.body.lastReadMessageId,'31');
});


test('conversation creation and operator logout send explicit empty JSON for strict media guards',async()=>{
 let created=false;
 const {service,calls}=setup(async(path,options)=>{
  if(path==='/api/support/conversations/current'&&options.method!=='POST'&&!created)return envelope(null);
  if(path==='/api/support/conversations/current'&&options.method==='POST'){created=true;assert.deepEqual(options.body,{});return envelope(detail());}
 });
 const user=await service.readCustomerSession();await service.ensureUserConversation(user,'en');
 const operator=await service.readSupportSession();await service.endSupportSession(operator.session);
 assert.deepEqual(calls.find(c=>c.path==='/api/support/session'&&c.options.method==='DELETE').options.body,{});
});

test('operation recovery pagination preserves opaque cursors and rejects incomplete backlog responses',async()=>{
 const op={id:'10000000-0000-4000-8000-000000000003',userId:'11',userName:'Customer',scope:'allowance',businessRef:'',status:'pending',outcome:'not_executed',httpStatus:0,createdAt:at(1),evidence:{kind:'none',reference:''},assigneeId:'',assigneeName:'',note:'',reviewedAt:null,version:1};
 let page={items:[op],nextCursor:'opaque+/=bound',hasMore:true,totalPending:103};
 const {service,calls}=setup(async path=>path.startsWith('/api/support/operations?')?envelope(page):undefined);
 const agent=await service.readSupportSession();
 assert.equal((await service.listSupportOperations(agent.session,'11',{limit:1})).totalPending,103);
 await service.listSupportOperations(agent.session,'11',{cursor:'opaque+/=bound'});
 const url=new URL(calls.at(-1).path,'https://test.invalid');
 assert.equal(url.searchParams.get('cursor'),'opaque+/=bound');assert.equal(url.searchParams.get('userId'),'11');assert.equal(url.searchParams.get('status'),'pending');
 assert.equal(calls.at(-1).options.headers['X-Fells-Expected-Operator-Session'],'b'.repeat(64));
 for(const invalid of [{items:[]},{...page,nextCursor:null},{...page,nextCursor:''},{...page,totalPending:-1},{...page,totalPending:2**53},{...page,items:Array(101).fill(op)},{...page,hasMore:false}]){
  page=invalid;await assert.rejects(service.listSupportOperations(agent.session),InvalidSupportData);
 }
 const before=calls.length;
 for(const query of [{limit:0},{limit:101},{cursor:''},{cursor:'x'.repeat(2049)}])await assert.rejects(service.listSupportOperations(agent.session,undefined,query),InvalidSupportData);
 assert.equal(calls.length,before);
 page={items:[],nextCursor:null,hasMore:false,totalPending:0};assert.equal((await service.listSupportOperations(agent.session)).hasMore,false);
});
