import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { trackCoverage, readBuildHeaders } from '../../helpers/browser.mjs';
import { png } from '../../fixtures/support-images.mjs';

export const locales=['','/zh','/zh-hant','/ja','/ko','/es'];
const at=i=>new Date(1700000000000+i).toISOString();
const customer={id:'42',name:'Customer',email:'customer@example.test',joinedAt:at(0),preferredLocale:'zh-CN',workspaceCount:2,credits:9,creditsCurrency:'USD',creditsKind:'api_allowance',walletCashMicro:12000000,walletCurrency:'CNY'};
const bootstrap={schema_version:1,session_id:'a'.repeat(64),user:{id:42,username:'customer',name:customer.name,email:customer.email,joined_at:1700000000,self_keys:true},wallet:{currency:'CNY',cash_micro:12000000,grant_micro:2000000,grant_expires_at:0},api_allowance:{currency:'USD',balance:{micro:9000000,expires_at:1900000000},term_months:12,exchange_policy:{source:'ECB',fee_bp:10,customer_only:true,fee_included:true}},agreement:{accepted:true},capabilities:{workspace_storage:true,chat_history:true,agent_execution:false,cloud_computer:false}};
export async function supportBrowser() {
 const dist=resolve(process.env.TEST_DIST_DIR||'dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
 const portal='support';
 const headers=await readBuildHeaders(dist);
 const server=createServer(async(req,res)=>{
  try{let path=resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(path!==dist&&!path.startsWith(dist+'/')){res.writeHead(403,headers).end();return;}if((await stat(path)).isDirectory())path+='/index.html';res.writeHead(200,{...headers,'content-type':mime[extname(path)]??'application/octet-stream'});res.end(await readFile(path));}catch{res.writeHead(404,headers).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(!existsSync(chromium.executablePath())&&existsSync(chrome)?chrome:undefined);
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const base=`http://127.0.0.1:${server.address().port}`;
 return{browser,base,portal,dist,async close(){await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
export async function supportFixture(t,environment,options={}){
 const context=await environment.browser.newContext({reducedMotion:'reduce',...options});await trackCoverage(context,options);t.after(()=>context.close());
 const calls=[],errors=[],streams=[];
 const state={historySyncPending:false,customerSignedIn:true,operatorSignedIn:false,messages:[],status:'open',userRead:null,agentRead:null,userTyping:false,agentTyping:false,online:false,failSend:false,uploads:0,attachments:new Map(),orders:[],cases:[],operations:[],operatorRole:'ops',sseEvents:[],orderReplyGate:/** @type {Promise<void>|null} */(null),orderSaveGate:/** @type {Promise<void>|null} */(null),caseReplyGate:/** @type {Promise<void>|null} */(null),orderAcceptGate:/** @type {Promise<void>|null} */(null),caseAcceptGate:/** @type {Promise<void>|null} */(null),failCaseExecute:false,failOrderSave:false,failCreateAfterCommit:false,failFulfill:false,failBootstrap:false};
 const session={sessionId:'b'.repeat(64),authMethod:'access',operator:{id:'84',name:'Support operator',email:'operator@example.test'},expiresAt:'2035-01-01T00:00:00Z'};
 const detail=()=>({id:'21',customer,status:state.status,lastMessage:state.messages.at(-1)??null,unreadCount:0,updatedAt:state.messages.at(-1)?.createdAt??at(0),userRead:{lastReadMessageId:state.userRead,updatedAt:null},agentRead:{lastReadMessageId:state.agentRead,updatedAt:null}});
 const attachment=(id,audience)=>({id,name:state.attachments.get(id)?.name??'sample.png',mimeType:'image/png',size:png.length,url:`/api/support/attachments/${id}?expires=2000000000&signature=fixture&audience=${audience}`,urlExpiresAt:'2035-01-01T00:00:00Z'});
 const mapped=audience=>state.messages.map(m=>({...m,attachments:m.attachments.map(a=>attachment(a.id,audience))}));
 const orderView=o=>({...o,waitingOn:o.waitingOn??(['completed','refunded','cancelled'].includes(o.status)?'none':o.fulfilled?'customer':'team'),acceptanceKind:o.acceptanceKind??(o.accepted?'customer':''),acceptanceDeadline:o.acceptanceDeadline??null,hasPendingActivationCase:state.cases.some(c=>c.orderId===o.id&&c.caseType==='activation'&&['open','executed','needs_review'].includes(c.status)),openCaseCount:state.cases.filter(c=>c.orderId===o.id&&['open','executed','needs_review'].includes(c.status)).length,refundedMicro:o.refundedMicro??0,refundPendingMicro:o.refundPendingMicro??0,afterSalesStatus:o.afterSalesStatus??'none'});
 const caseView=c=>({...c,waitingOn:c.waitingOn??(['closed','cancelled','reversed'].includes(c.status)?'none':c.status==='executed'&&c.caseType!=='refund'?'customer':'team'),acceptanceKind:c.acceptanceKind??'',acceptanceDeadline:c.acceptanceDeadline??null});
 const fulfill=(route,data,status=200)=>route.fulfill({status,json:data});
 await context.route('**/*',route=>new URL(route.request().url()).origin===environment.base?route.continue():route.abort());
 await context.route('**/cdn-cgi/access/logout',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Access signed out</title><p>Access signed out</p>'}));
 await context.route('**/admin/',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Management console</title><p>Management console</p>'}));
 await context.route('**/api/app/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,method=request.method();calls.push({path,method,headers:request.headers()});
  if(path==='/api/app/bootstrap'&&state.failBootstrap){await fulfill(route,{error:'Temporary failure'},503);return;}
  if(path==='/api/app/session'&&method==='DELETE'){state.customerSignedIn=false;await route.fulfill({status:204});return;}
  if(!state.customerSignedIn){await fulfill(route,{error:'Sign in required'},401);return;}
  const data={
   '/api/app/bootstrap':bootstrap,'/api/app/session':{user:bootstrap.user},'/api/app/profile':{profile:{name:customer.name,avatar:0},email:customer.email},'/api/app/preferences':{theme:'system',prefs:{agent:'',send:0},notifs:[true,true,true,false],onboarded:true,answers:[[],[],[],[]],promoClosed:false,sbHidden:false},'/api/app/workspaces':{workspaces:[]},'/api/app/keys':{keys:[],self_keys:true},
  };
  await fulfill(route,data[path]??{ok:true});
 });
 await context.route('**/api/support/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method(),headers=request.headers();
  const audience=headers['x-fells-support-audience']??url.searchParams.get('audience');
  const body=method!=='GET'&&headers['content-type']?.includes('application/json')?request.postDataJSON():undefined;
  calls.push({path,method,headers,body,query:Object.fromEntries(url.searchParams)});
  if(path==='/api/support/session'){
   if(method==='POST'){
    if(body.password!=='fixture-password'){await fulfill(route,{ok:false,error:{code:'unauthorized',message:'Invalid support credentials'},requestId:'test'},401);return;}
    state.operatorSignedIn=true;await fulfill(route,{ok:true,data:session,requestId:'test'});return;
   }
   if(method==='DELETE'){state.operatorSignedIn=false;state.online=false;await fulfill(route,{ok:true,data:null,requestId:'test'});return;}
   await fulfill(route,{ok:true,data:state.operatorSignedIn?session:null,requestId:'test'});return;
  }
  const authorized=audience==='customer'?state.customerSignedIn:audience==='operator'?state.operatorSignedIn:false;
  if(!authorized){await fulfill(route,{ok:false,error:{code:'unauthorized',message:'Sign in required'},requestId:'test'},401);return;}
  if(path==='/api/support/events'){
   streams.push(calls.at(-1));
   const events=state.sseEvents.filter(event=>!event.audience||event.audience===audience);state.sseEvents=state.sseEvents.filter(event=>event.audience&&event.audience!==audience);
   await route.fulfill({status:200,contentType:'text/event-stream',body:': connected\n\n'+events.map((event,index)=>`id: ${100+index}\nevent: ${event.type}\ndata: ${JSON.stringify({id:String(100+index),type:event.type,data:event.data})}\n\n`).join('')});return;
  }
  if(path.startsWith('/api/support/attachments/')){await route.fulfill({status:200,contentType:'image/png',body:png});return;}
  if(path==='/api/support/attachments'){
   const id='attachment-'+(++state.uploads);state.attachments.set(id,{name:'sample.png'});await fulfill(route,{ok:true,data:attachment(id,audience),requestId:'test'});return;
  }
  if(path==='/api/support/operators'){await fulfill(route,{ok:true,data:{items:[{id:'84',name:'Support operator'}]},requestId:'test'});return;}
  if(path==='/api/support/compensation-report'){const month=url.searchParams.get('month');await fulfill(route,{ok:true,data:{month,items:[...new Set(state.cases.filter(c=>c.caseType==='compensation'&&c.executedAt).map(c=>c.userId))].map(userId=>{const items=state.cases.filter(c=>c.userId===userId&&c.caseType==='compensation'&&c.executedAt);return{userId,allowanceMicro:items.reduce((n,c)=>n+c.requestedAllowanceMicro,0),hours:items.reduce((n,c)=>n+c.requestedHours,0),planPeriods:items.reduce((n,c)=>n+(c.requestedPlanPeriods||0),0),caseCount:items.length};})},requestId:'test'});return;}
  if(path==='/api/support/catalog'){await fulfill(route,{ok:true,data:{subscriptions:[{poolId:11,poolName:'Test plan',tier:1,monthlyMicro:120000000}],tokenPlans:[{code:'token-standard',name:'Token Standard',priceMicro:88000000,periodDays:30,enabled:true}],allowance:{priceCny:2}},requestId:'test'});return;}
  if(path==='/api/support/operations') {
   const userId=url.searchParams.get('userId'),limit=Number(url.searchParams.get('limit')||100),cursor=url.searchParams.get('cursor');
   const all=state.operations.filter(op=>op.status==='pending'&&(!userId||op.userId===userId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
   const start=cursor?all.findIndex(op=>op.id===cursor)+1:0,items=all.slice(start,start+limit),hasMore=start+limit<all.length;
   await fulfill(route,{ok:true,data:{items,nextCursor:hasMore?items.at(-1).id:null,hasMore,totalPending:all.length},requestId:'test'});return;
  }
  if(path.startsWith('/api/support/operations/')) {
   const id=path.split('/')[4],op=state.operations.find(item=>item.id===id);
   if(!op){await fulfill(route,{ok:false,error:{message:'Not found'},requestId:'test'},404);return;}
   if(method==='POST'){
    if(body.version!==op.version){await fulfill(route,{ok:false,error:{message:'Version conflict'},requestId:'test'},409);return;}
    if(body.action==='confirm_committed'&&op.outcome!=='committed'||body.action==='confirm_not_executed'&&op.outcome!=='not_executed'){await fulfill(route,{ok:false,error:{message:'Unknown outcome'},requestId:'test'},409);return;}
    op.note=body.note;op.version++;if(body.action!=='needs_review'){op.status='completed';op.outcome='completed';op.httpStatus=200;}
   }
   await fulfill(route,{ok:true,data:op,requestId:'test'});return;
  }
  if(path==='/api/support/cases'||path==='/api/support/conversations/21/cases'||path.endsWith('/cases')) {
   const orderId=path.startsWith('/api/support/orders/')?path.split('/')[4]:null;
   if(method==='POST') {
    const order=state.orders.find(o=>o.id===orderId);
    if(audience!=='operator'||!order){await fulfill(route,{ok:false,error:{message:'Forbidden'},requestId:'test'},403);return;}
    if(body.caseType!=='activation'&&!state.messages.some(m=>m.id===body.evidenceMessageId)&&!body.evidenceAttachmentId){await fulfill(route,{ok:false,error:{message:'Actual conversation evidence required'},requestId:'test'},400);return;}
    if(body.caseType==='compensation'&&order.product==='token_plan'&&(!order.fulfilled||body.requestedPlanPeriods!==1||body.requestedAllowanceMicro||body.requestedHours)){await fulfill(route,{ok:false,error:{message:'Delivered original Token Plan and one period required'},requestId:'test'},400);return;}
    let item=state.cases.find(c=>c.clientCaseId===body.clientCaseId);
    if(!item){item={...body,id:'20000000-0000-4000-8000-'+String(91+state.cases.length).padStart(12,'0'),orderId,conversationId:'21',userId:'42',status:'open',assigneeId:'84',assigneeName:'Support operator',note:'',refundProof:'',refundProofMessageId:null,refundProofAttachmentId:null,receipt:null,version:1,createdAt:at(1000),updatedAt:at(1000),executedAt:null,closedAt:null,history:[{id:'1',actorName:'Support operator',action:'created',note:body.reason,createdAt:at(1000)}]};state.cases.push(item);}
    if(state.caseReplyGate)await state.caseReplyGate;
    await fulfill(route,{ok:true,data:item,requestId:'test'});return;
   }
   let items=state.cases.filter(c=>!orderId||c.orderId===orderId);
   const status=url.searchParams.get('status'),assignee=url.searchParams.get('assignee'),limit=Number(url.searchParams.get('limit')||100);
   if(status)items=items.filter(c=>status==='active'?['open','executed','needs_review'].includes(c.status):c.status===status);
   if(assignee)items=items.filter(c=>c.assigneeId===assignee);
   items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
   const cursor=url.searchParams.get('cursor');if(cursor){const [created,id]=JSON.parse(Buffer.from(cursor,'base64url').toString());items=items.filter(item=>item.createdAt<created||item.createdAt===created&&item.id>id);}
   if(url.searchParams.get('waitingOn'))items=items.filter(c=>caseView(c).waitingOn===url.searchParams.get('waitingOn'));
   const page=items.slice(0,limit),hasMore=items.length>limit,last=page.at(-1),nextCursor=hasMore?Buffer.from(JSON.stringify([last.createdAt,last.id])).toString('base64url'):null;
   await fulfill(route,{ok:true,data:{items:page.map(caseView),nextCursor,hasMore},requestId:'test'});return;
  }
  if(path.startsWith('/api/support/cases/')) {
   const id=path.split('/')[4],item=state.cases.find(c=>c.id===id),order=state.orders.find(o=>o.id===item?.orderId);
   if(!item||!order){await fulfill(route,{ok:false,error:{message:'Not found'},requestId:'test'},404);return;}
   if(method==='GET'){await fulfill(route,{ok:true,data:caseView(item),requestId:'test'});return;}
   if(body.version!==item.version){await fulfill(route,{ok:false,error:{message:'Version conflict'},requestId:'test'},409);return;}
   if(item.status==='reversed'){await fulfill(route,{ok:false,error:{message:'Reversed case is terminal; create a linked correction'},requestId:'test'},409);return;}
   if(path.endsWith('/dispute')) {if(audience!=='customer'||!body.reason?.trim()){await fulfill(route,{ok:false,error:{message:'Problem description required'},requestId:'test'},400);return;}item.disputedAt=new Date().toISOString();item.disputeReason=body.reason;item.waitingOn='team';item.acceptanceDeadline=null;item.status='needs_review';}
   else if(path.endsWith('/refund-plan')) {item.refund??={plan:null,stage:'pending',claimedStage:'',provider:'',account:'',refundId:'',executedBy:'',recordedBy:'',reviewedBy:'',reversalRef:'',reversedAt:null,recovery:{}};if(body.action==='approve'){if(state.operatorRole!=='owner'||item.refund.plan?.proposedBy==='84'){await fulfill(route,{ok:false,error:{message:'Independent Owner approval required'},requestId:'test'},403);return;}Object.assign(item.refund.plan,{approvedBy:'84',approvedAt:new Date().toISOString()});}else item.refund.plan={mode:body.mode,reason:body.reason,proposedBy:'84',approvedBy:'',approvedAt:null};}
   else if(path.endsWith('/refund-channel')) {if(body.amountMicro!==item.refundMicro||body.currency!=='CNY'){await fulfill(route,{ok:false,error:{message:'Exact refund amount and currency required'},requestId:'test'},400);return;}if(body.stage==='unknown')item.refund.stage='unknown';Object.assign(item.refund,{claimedStage:body.stage,provider:body.provider,account:body.account,refundId:body.refundId,recordedBy:'84',reviewedBy:'',channelAmountMicro:body.amountMicro,channelCurrency:body.currency});item.refundProof=body.note;item.refundProofMessageId=body.proofMessageId;item.refundProofAttachmentId=body.proofAttachmentId;item.waitingOn='team';item.acceptanceDeadline=null;}
   else if(path.endsWith('/refund-review')) {if(item.refund.executedBy==='84'||item.refund.recordedBy==='84'){await fulfill(route,{ok:false,error:{message:'Independent reviewer required'},requestId:'test'},403);return;}item.refund.stage=item.refund.claimedStage;item.refund.reviewedBy='84';if(item.refund.stage==='paid'){item.waitingOn='customer';item.acceptanceDeadline=new Date(Date.now()+14*86400000).toISOString();}if(item.refund.stage==='failed'){item.reversalRef=item.refund.reversalRef='reverse:'+id;item.reversedAt=item.refund.reversedAt=new Date().toISOString();item.status='reversed';item.waitingOn='none';}}
   else if(path.endsWith('/reverse')) {if(state.operatorRole!=='owner'){await fulfill(route,{ok:false,error:{message:'Owner required'},requestId:'test'},403);return;}item.reversalRef='reverse:'+id;item.reversedAt=new Date().toISOString();item.status='reversed';item.waitingOn='none';}
   else if(path.endsWith('/execute')) {
    if(item.caseType==='compensation'&&state.operatorRole!=='owner'){await fulfill(route,{ok:false,error:{message:'Owner required'},requestId:'test'},403);return;}
    if(item.caseType==='refund'&&(order.fulfilled||order.allowanceRef||order.subscriptionId||order.tokenPlanRef)&&!item.refund?.plan?.approvedAt){await fulfill(route,{ok:false,error:{message:'Delivered entitlements require manual review'},requestId:'test'},400);return;}
    if(item.caseType==='activation'&&(order.product==='other'||order.status!=='awaiting_fulfillment'||!order.paymentTopupId)){await fulfill(route,{ok:false,error:{message:'Payment not verified'},requestId:'test'},409);return;}
    if(state.failCaseExecute){await fulfill(route,{ok:false,error:{message:'Temporary case failure'},requestId:'test'},503);return;}
    if(item.caseType==='activation'){order.fulfilled=true;order.fulfilledAt=at(3000);order.enableApiKeys=item.enableApiKeys;if(order.product==='token_plan')order.tokenPlanRef='support-case:'+id;else order.allowanceRef='support-case:'+id;order.version++;order.updatedAt=at(3000);order.history.push({id:String(order.history.length+1),actorName:'Support operator',action:'fulfilled',note:item.reason,createdAt:at(3000)});}
    if(item.caseType==='refund'){item.refund??={plan:null,stage:'pending',claimedStage:'',provider:'',account:'',refundId:'',recordedBy:'',reviewedBy:'',reversalRef:'',reversedAt:null,recovery:{}};item.refund.executedBy='84';item.waitingOn='team';}else{item.waitingOn='customer';item.acceptanceDeadline=new Date(Date.now()+14*86400000).toISOString();}
    item.status='executed';item.executedAt=at(3000);item.receipt={actionRef:'support-case:'+id,ledgerRef:item.caseType==='activation'?(order.tokenPlanRef||order.allowanceRef):'case-ledger-'+id,allowanceMicro:item.caseType==='compensation'?item.requestedAllowanceMicro:0,subscriptionId:null,subscriptionHours:item.requestedHours,tokenPlanRef:order.product==='token_plan'?'support-case:'+id:'',tokenPlanSubscriptionId:order.product==='token_plan'?501:null,tokenPlanPeriods:item.caseType==='compensation'?item.requestedPlanPeriods:order.product==='token_plan'?1:0,cashRefundMicro:item.refundMicro,before:{balanceMicro:12000000,grantMicro:0,allowanceMicro:9000000,allowanceGrantMicro:0,selfKeys:false,rideMode:'allowance',allowanceExpiresAt:1900000000,subscriptionExpiresAt:0},after:{balanceMicro:12000000,grantMicro:0,allowanceMicro:9000000+item.requestedAllowanceMicro,allowanceGrantMicro:item.requestedAllowanceMicro,selfKeys:item.enableApiKeys,rideMode:'allowance',allowanceExpiresAt:1900000000,subscriptionExpiresAt:0}};
   } else if(path.endsWith('/accept')) {
    if(audience!=='customer'||!['executed','needs_review'].includes(item.status)||item.reversedAt||item.caseType==='refund'&&(item.refund?item.refund.stage!=='paid':!item.refundProof||!item.refundProofMessageId&&!item.refundProofAttachmentId)){await fulfill(route,{ok:false,error:{message:'Actual refund proof required'},requestId:'test'},400);return;}
    item.status='closed';item.closedAt=at(4000);item.acceptanceKind='customer';item.waitingOn='none';if(item.caseType==='activation'){order.status='completed';order.accepted=true;order.acceptedAt=at(4000);order.version++;order.history.push({id:String(order.history.length+1),actorName:'Customer',action:'case_accepted',note:item.reason,createdAt:at(4000)});}
   } else {
    if(item.status==='closed'){await fulfill(route,{ok:false,error:{message:'Closed case proof immutable'},requestId:'test'},409);return;}
    if(body.status==='executed'&&item.status!=='executed'&&!(item.status==='needs_review'&&item.executedAt&&item.receipt?.actionRef&&body.note?.trim())){await fulfill(route,{ok:false,error:{message:'Verified execution receipt and review notes required'},requestId:'test'},409);return;}
    Object.assign(item,body);
   }
   item.version++;item.updatedAt=at(5000);item.history.push({id:String(item.history.length+1),actorName:audience==='operator'?'Support operator':'Customer',action:'updated',note:item.note||item.reason,createdAt:at(5000)});
   if(path.endsWith('/accept')&&state.caseAcceptGate)await state.caseAcceptGate;
   await fulfill(route,{ok:true,data:caseView(item),requestId:'test'});return;
  }
  if(path==='/api/support/orders'||path==='/api/support/conversations/21/orders') {
   if(method==='POST'){
    if(!Number.isSafeInteger(body.amountMicro)||body.amountMicro<=0){await fulfill(route,{ok:false,error:{message:'Positive amount required'},requestId:'test'},400);return;}
    if(body.product==='token_plan'&&(body.planCode!=='token-standard'||body.amountMicro!==88000000||body.serviceDays!==30||body.months!==0||body.poolId!==null)){await fulfill(route,{ok:false,error:{message:'One catalog Token Plan period required'},requestId:'test'},400);return;}
    if(audience!=='operator'){await fulfill(route,{ok:false,error:{message:'Forbidden'},requestId:'test'},403);return;}
    let order=state.orders.find(o=>o.clientOrderId===body.clientOrderId);
    if(!order){order={...body,id:'00000000-0000-4000-8000-'+String(90+state.orders.length).padStart(12,'0'),conversationId:'21',userId:'42',currency:'CNY',status:'quoted',assigneeId:'84',assigneeName:'Support operator',paymentTopupId:null,subscriptionId:null,subscriptionRef:'',tokenPlanRef:'',allowanceRef:'',version:1,createdAt:at(1000),updatedAt:at(1000),accepted:false,acceptedAt:null,fulfilled:false,fulfilledAt:null,allowanceUsdMicro:body.product==='allowance'?body.amountMicro/2:0,history:[{id:'1',actorName:'Support operator',action:'created',note:body.note,createdAt:at(1000)}]};state.orders.push(order);}
    if(state.orderReplyGate)await state.orderReplyGate;
    if(state.failCreateAfterCommit){await fulfill(route,{ok:false,error:{message:'Lost create response'},requestId:'test'},503);return;}
    await fulfill(route,{ok:true,data:order,requestId:'test'});return;
   }
   let items=state.orders.map(orderView);const status=url.searchParams.get('status'),limit=Number(url.searchParams.get('limit')||100);if(status)items=items.filter(o=>status==='active'?['quoted','awaiting_payment','awaiting_fulfillment','needs_review','refunding'].includes(o.status):o.status===status);
   if(url.searchParams.get('waitingOn'))items=items.filter(o=>o.waitingOn===url.searchParams.get('waitingOn'));if(url.searchParams.get('assignee'))items=items.filter(o=>o.assigneeId===url.searchParams.get('assignee'));if(url.searchParams.get('overdue')==='true')items=items.filter(o=>o.dueAt&&Date.parse(o.dueAt)<Date.now());
   items.sort((a,b)=>(a.dueAt??'9999').localeCompare(b.dueAt??'9999')||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
   const cursor=url.searchParams.get('cursor');if(cursor){const index=items.findIndex(item=>item.id===cursor);if(index>=0)items=items.slice(index+1);}
   const page=items.slice(0,limit),hasMore=items.length>limit;await fulfill(route,{ok:true,data:{items:page,nextCursor:hasMore?page.at(-1).id:null,hasMore,historySyncPending:state.historySyncPending},requestId:'test'});return;
  }
  if(path.startsWith('/api/support/orders/')) {
   const id=path.split('/')[4],order=state.orders.find(o=>o.id===id);
   if(!order){await fulfill(route,{ok:false,error:{message:'Not found'},requestId:'test'},404);return;}
   if(method==='GET'){await fulfill(route,{ok:true,data:orderView(order),requestId:'test'});return;}
   if(state.failOrderSave){await fulfill(route,{ok:false,error:{message:'Injected save failure'},requestId:'test'},503);return;}
   if(body.version!==order.version){await fulfill(route,{ok:false,error:{message:'Version conflict'},requestId:'test'},409);return;}
   if(path.endsWith('/requote')){order.quoteReconfirmation={state:'pending',reason:body.reason,proposedAt:new Date().toISOString(),confirmedAt:null,quoteSnapshot:{currency:'CNY',amountMicro:order.amountMicro,product:order.product,serviceDays:30,provenance:'owner_requote',tokenPlan:{code:order.planCode,name:'Requoted Token Plan',quota_usd_micro:5000000,burst_usd_micro:10000000}}};}else if(path.endsWith('/confirm-quote')){order.quoteReconfirmation.state='confirmed';order.quoteReconfirmation.confirmedAt=new Date().toISOString();}else if(path.endsWith('/dispute')){order.disputedAt=new Date().toISOString();order.disputeReason=body.reason;order.status='needs_review';order.waitingOn='team';order.acceptanceDeadline=null;}else if(path.endsWith('/fulfill')) {
    if(state.failFulfill){await fulfill(route,{ok:false,error:{message:'Temporary fulfilment failure'},requestId:'test'},503);return;}
    if(order.status!=='awaiting_fulfillment'||!order.paymentTopupId){await fulfill(route,{ok:false,error:{message:'Payment not verified'},requestId:'test'},409);return;}
    order.fulfilled=true;order.fulfilledAt=at(3000);order.enableApiKeys=body.enableApiKeys;order.allowanceRef='support-order-'+order.id;
   } else if(path.endsWith('/accept')) {
    if(audience!=='customer'||!order.fulfilled){await fulfill(route,{ok:false,error:{message:'Delivery not verified'},requestId:'test'},409);return;}
    order.status='completed';order.accepted=true;order.acceptedAt=at(4000);if(state.orderAcceptGate)await state.orderAcceptGate;
   } else {
    if(order.fulfilled&&['paymentTopupId','subscriptionId','subscriptionRef','allowanceRef'].some(field=>field in body)){await fulfill(route,{ok:false,error:{message:'Delivered evidence immutable'},requestId:'test'},409);return;}
    if(body.status==='completed'&&!order.accepted){await fulfill(route,{ok:false,error:{message:'Customer confirmation required'},requestId:'test'},409);return;}
    if(body.status==='awaiting_fulfillment'&&!body.paymentTopupId){await fulfill(route,{ok:false,error:{message:'Payment not verified'},requestId:'test'},409);return;}
    Object.assign(order,body);
   }
   order.version++;order.updatedAt=at(5000);order.history.push({id:String(order.history.length+1),actorName:audience==='operator'?'Support operator':'Customer',action:'updated',note:order.note,createdAt:at(5000)});
   if(method==='PATCH'&&state.orderSaveGate)await state.orderSaveGate;
   await fulfill(route,{ok:true,data:order,requestId:'test'});return;
  }
  let data=null;
  if(path==='/api/support/conversations/current'||path==='/api/support/conversations/21')data=detail();
  else if(path==='/api/support/conversations')data={items:[detail()],nextCursor:null};
  else if(path==='/api/support/conversations/21/messages'){
   if(method==='POST'){
    if(state.failSend){await fulfill(route,{ok:false,error:{code:'internal_error',message:'Injected network failure'},requestId:'test'},503);return;}
    const previous=state.messages.find(m=>m.clientMessageId===body.clientMessageId);
    const order=body.orderId?state.orders.find(o=>o.id===body.orderId):null;if(body.orderId&&!order){await fulfill(route,{ok:false,error:{message:'Order not found'},requestId:'test'},404);return;}
    data=previous??{...(order?{orderId:order.id,orderTitle:order.title,orderAmountMicro:order.amountMicro,orderProduct:order.product}:{}),id:String(31+state.messages.length),conversationId:'21',clientMessageId:body.clientMessageId,sender:audience==='operator'?'agent':'user',text:body.text,attachments:body.attachmentIds.map(id=>attachment(id,audience)),createdAt:at(1000+state.messages.length)};
    if(!previous)state.messages.push(data);state.status='open';
   }else data={items:mapped(audience),nextCursor:null};
  }else if(path.endsWith('/read')){if(audience==='customer')state.userRead=body.lastReadMessageId;else state.agentRead=body.lastReadMessageId;data={lastReadMessageId:body.lastReadMessageId,updatedAt:at(5000)};}
  else if(path.endsWith('/status')){state.status=body.status;data=detail();}
  else if(path.endsWith('/typing')){if(method==='PUT'){if(audience==='customer')state.userTyping=body.typing;else state.agentTyping=body.typing;}data={user:state.userTyping,agent:state.agentTyping};}
  else if(path==='/api/support/availability')data={online:state.online};
  else if(path==='/api/support/session/availability'){state.online=body.online;data=null;}
  else {await fulfill(route,{ok:false,error:{code:'not_found',message:'Unhandled support contract route'},requestId:'test'},404);return;}
  await fulfill(route,{ok:true,data,requestId:'test'});
 });
 context.on('page',page=>{page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));});
 const customerPage=async(locale='/zh')=>{const page=await context.newPage();await page.goto(environment.base+locale+'/app/');await page.locator('[data-support-open]').waitFor({state:'visible'});await page.locator('[data-support-open]').click();return page;};
 const operatorPage=async(locale='/zh')=>{state.operatorSignedIn=true;const page=await context.newPage();await page.goto(environment.base+locale+'/support/desk/');await page.locator('[data-support-conversation="21"]').click();await page.locator('[data-support-chat]').waitFor({state:'visible'});return page;};
 return{context,calls,errors,streams,state,customerPage,operatorPage};
}
export async function refresh(page){await page.bringToFront();await page.evaluate(()=>dispatchEvent(new Event('focus')));}
export async function sendCustomer(page,text){await page.locator('#support-widget [data-support-text]').fill(text);await page.locator('#support-widget [data-support-send]').click();await page.locator('#support-widget [data-support-message]').filter({hasText:text}).waitFor();}
export async function sendOperator(page,text){await page.locator('[data-support-console] [data-support-text]').fill(text);await page.locator('[data-support-console] [data-support-send]').click();await page.locator('[data-support-console] [data-support-message]').filter({hasText:text}).waitFor();}
