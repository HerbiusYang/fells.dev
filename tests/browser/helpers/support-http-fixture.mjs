import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { png } from '../../fixtures/support-images.mjs';

export const locales=['','/zh','/zh-hant','/ja','/ko','/es'];
const at=i=>new Date(1700000000000+i).toISOString();
const customer={id:'42',name:'Customer',email:'customer@example.test',joinedAt:at(0),preferredLocale:'zh-CN',workspaceCount:2,credits:9,creditsCurrency:'USD',creditsKind:'api_allowance'};
const bootstrap={schema_version:1,session_id:'a'.repeat(64),user:{id:42,username:'customer',name:customer.name,email:customer.email,joined_at:1700000000,self_keys:true},wallet:{currency:'CNY',cash_micro:12000000,grant_micro:2000000,grant_expires_at:0},api_allowance:{currency:'USD',balance:{micro:9000000,expires_at:1900000000},term_months:12,price_cny:2},agreement:{accepted:true},capabilities:{workspace_storage:true,chat_history:true,agent_execution:false,cloud_computer:false}};
export async function supportBrowser() {
 const dist=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
 let portal=null;
 for(const entry of await readdir(dist,{withFileTypes:true})){
  if(!entry.isDirectory())continue;
  try{if((await readFile(resolve(dist,entry.name,'index.html'),'utf8')).includes('data-support-login'))portal=entry.name;}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const server=createServer(async(req,res)=>{
  try{let path=resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(path!==dist&&!path.startsWith(dist+'/')){res.writeHead(403).end();return;}if((await stat(path)).isDirectory())path+='/index.html';res.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream'});res.end(await readFile(path));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||(!existsSync(chromium.executablePath())&&existsSync(chrome)?chrome:undefined);
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const base=`http://127.0.0.1:${server.address().port}`;
 return{browser,base,portal,dist,async close(){await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
export async function supportFixture(t,environment,options={}){
 const context=await environment.browser.newContext({reducedMotion:'reduce',...options});t.after(()=>context.close());
 const calls=[],errors=[],streams=[];
 const state={customerSignedIn:true,operatorSignedIn:false,messages:[],status:'open',userRead:null,agentRead:null,userTyping:false,agentTyping:false,online:false,failSend:false,uploads:0,attachments:new Map()};
 const session={sessionId:'b'.repeat(64),operator:{id:'84',name:'Support operator',email:'operator@example.test'},expiresAt:'2035-01-01T00:00:00Z'};
 const detail=()=>({id:'21',customer,status:state.status,lastMessage:state.messages.at(-1)??null,unreadCount:0,updatedAt:state.messages.at(-1)?.createdAt??at(0),userRead:{lastReadMessageId:state.userRead,updatedAt:null},agentRead:{lastReadMessageId:state.agentRead,updatedAt:null}});
 const attachment=(id,audience)=>({id,name:state.attachments.get(id)?.name??'sample.png',mimeType:'image/png',size:png.length,url:`/api/support/attachments/${id}?expires=2000000000&signature=fixture&audience=${audience}`,urlExpiresAt:'2035-01-01T00:00:00Z'});
 const mapped=audience=>state.messages.map(m=>({...m,attachments:m.attachments.map(a=>attachment(a.id,audience))}));
 const fulfill=(route,data,status=200)=>route.fulfill({status,json:data});
 await context.route('**/*',route=>new URL(route.request().url()).origin===environment.base?route.continue():route.abort());
 await context.route('**/api/app/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname,method=request.method();calls.push({path,method,headers:request.headers()});
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
   await route.fulfill({status:200,contentType:'text/event-stream',body:': connected\n\n'});return;
  }
  if(path.startsWith('/api/support/attachments/')){await route.fulfill({status:200,contentType:'image/png',body:png});return;}
  if(path==='/api/support/attachments'){
   const id='attachment-'+(++state.uploads);state.attachments.set(id,{name:'sample.png'});await fulfill(route,{ok:true,data:attachment(id,audience),requestId:'test'});return;
  }
  let data=null;
  if(path==='/api/support/conversations/current'||path==='/api/support/conversations/21')data=detail();
  else if(path==='/api/support/conversations')data={items:[detail()],nextCursor:null};
  else if(path==='/api/support/conversations/21/messages'){
   if(method==='POST'){
    if(state.failSend){await fulfill(route,{ok:false,error:{code:'internal_error',message:'Injected network failure'},requestId:'test'},503);return;}
    const previous=state.messages.find(m=>m.clientMessageId===body.clientMessageId);
    data=previous??{id:String(31+state.messages.length),conversationId:'21',clientMessageId:body.clientMessageId,sender:audience==='operator'?'agent':'user',text:body.text,attachments:body.attachmentIds.map(id=>attachment(id,audience)),createdAt:at(1000+state.messages.length)};
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
 const operatorPage=async(locale='/zh')=>{if(!environment.portal)throw Error('SUPPORT_PORTAL_PATH must be configured for operator UI tests');const page=await context.newPage();await page.goto(environment.base+locale+'/'+environment.portal+'/');await page.locator('#support-account').fill('fixture-operator');await page.locator('#support-password').fill('fixture-password');await page.locator('[data-support-login-form] [type=submit]').click();await page.waitForURL(/\/desk\/?$/);await page.locator('[data-support-conversation="21"]').click();await page.locator('[data-support-chat]').waitFor({state:'visible'});return page;};
 return{context,calls,errors,streams,state,customerPage,operatorPage};
}
export async function refresh(page){await page.bringToFront();await page.evaluate(()=>dispatchEvent(new Event('focus')));}
export async function sendCustomer(page,text){await page.locator('#support-widget [data-support-text]').fill(text);await page.locator('#support-widget [data-support-send]').click();await page.locator('#support-widget [data-support-message]').filter({hasText:text}).waitFor();}
export async function sendOperator(page,text){await page.locator('[data-support-console] [data-support-text]').fill(text);await page.locator('[data-support-console] [data-support-send]').click();await page.locator('[data-support-console] [data-support-message]').filter({hasText:text}).waitFor();}
