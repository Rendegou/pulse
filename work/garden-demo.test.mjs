import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createGardenServer} from './serve-garden-demo.mjs';

const stateFile='work/garden-test-'+crypto.randomUUID()+'.json';
let app=createGardenServer({stateFile});
const clients=[];
// listen 让系统分配回环端口，测试不占用产品端口。
async function listen(instance){await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+instance.server.address().port;}
// connect 打开真实 SSE 流并保存业务事件；用 abort 释放，不模拟浏览器 UI。
async function connect(base){
  const controller=new AbortController(),res=await fetch(base+'/events',{signal:controller.signal});
  const client={events:[],controller,reader:res.body.getReader()};clients.push(client);
  // 后台解码完整 SSE 边界；连接取消是测试清理，不是失败。
  client.pump=(async()=>{let pending='';const decoder=new TextDecoder();try{while(true){const {done,value}=await client.reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let cut;while((cut=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,cut);pending=pending.slice(cut+2);if(frame.startsWith('data: '))client.events.push(JSON.parse(frame.slice(6)));}}}catch(error){if(!controller.signal.aborted)throw error;}})();
  const welcome=await event(client,'welcome');client.id=welcome.you;return client;
}
// event 等待实际服务消息，三秒无响应则失败；不以假事件通过协议验收。
async function event(client,type){const end=Date.now()+3000;while(Date.now()<end){const index=client.events.findIndex(e=>e.type===type);if(index>=0)return client.events.splice(index,1)[0];await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Missing '+type);}
// action 通过与前端一致的 HTTP 路由发送输入，保留状态码和确认载荷。
async function action(base,client,body){const res=await fetch(base+'/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:client.id,...body})});return{status:res.status,body:await res.json()};}
let base;
try{
  base=await listen(app);const a=await connect(base),b=await connect(base);
  assert.equal((await event(a,'join')).peer.id,b.id);
  const cursor={x:28,y:-7,z:53};assert.equal((await action(base,a,{type:'cursor',cursor})).status,200);
  assert.deepEqual((await event(b,'cursor')).cursor,cursor);
  const id=crypto.randomUUID();const water=await action(base,a,{type:'water',island:0,eventId:id});assert.equal(water.status,200);
  const wa=await event(a,'water'),wb=await event(b,'water');assert.deepEqual(wa.state,wb.state);assert.equal(wb.state.plants[0].care,1);
  const duplicate=await action(base,a,{type:'water',island:0,eventId:id});assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.state.version,1);
  assert.equal((await action(base,a,{type:'water',island:0,eventId:crypto.randomUUID()})).status,429);
  assert.equal((await action(base,b,{type:'water',island:-1,eventId:'bad'})).status,400);
  assert.equal((await action(base,b,{type:'water',island:0,eventId:crypto.randomUUID()})).status,200);
  assert.equal((await event(a,'water')).together,true);assert.equal((await event(b,'water')).state.plants[0].care,2);
  assert.equal((await action(base,{id:'unknown'},{type:'water',island:0,eventId:'bad'})).status,401);
  const saved=JSON.parse(fs.readFileSync(stateFile));assert.equal(saved.version,2);assert.equal(saved.plants[1].care,0);
  b.controller.abort();assert.equal((await event(a,'leave')).id,b.id);a.controller.abort();await app.close();
  app=createGardenServer({stateFile});base=await listen(app);
  assert.equal((await (await fetch(base+'/state')).json()).state.plants[0].care,2);
  const c=await connect(base),d=await connect(base);
  const results=await Promise.all([action(base,c,{type:'water',island:1,eventId:'c-1'}),action(base,d,{type:'water',island:2,eventId:'d-1'})]);
  assert.ok(results.every(r=>r.status===200));const final=(await (await fetch(base+'/state')).json()).state;
  assert.deepEqual(final.plants.map(p=>p.care),[2,1,1]);assert.equal(final.version,4);
  for(const client of clients)client.controller.abort();await app.close();
  app=createGardenServer({stateFile:'work/nonexistent-'+crypto.randomUUID()+'/state.json'});base=await listen(app);const e=await connect(base);
  assert.equal((await action(base,e,{type:'water',island:0,eventId:'disk-failure'})).status,500);
  assert.equal((await (await fetch(base+'/state')).json()).state.version,0);
  const report={passed:true,checks:['real SSE welcome/join/leave','world cursor broadcast','two-client identical watering snapshot','duplicate id is idempotent','cooldown/invalid island/unknown session rejected','shared watering within six seconds','restart restores saved plants','concurrent actions on separate islands preserve both','disk failure has no successful state mutation'],scope:'Local protocol integration; not browser or production verification'};
  fs.writeFileSync('work/garden-protocol-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
  for(const client of clients)client.controller.abort();await app.close();for(const name of [stateFile,stateFile+'.tmp'])if(fs.existsSync(name))fs.unlinkSync(name);
}
