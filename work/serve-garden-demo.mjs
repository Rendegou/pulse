import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// createGardenServer 构建只监听回环地址的独立 Demo；文件路径由调用者传入，浏览器不能读取仓库其他文件。
export function createGardenServer({stateFile=path.resolve('work/garden-play-state.json'),htmlFile=path.resolve('outputs/pulse-tidal-garden.html')}={}) {
  let state={version:0,plants:[{care:0,last:null},{care:0,last:null},{care:0,last:null}]},serial=0;
  const peers=new Map();
  if(fs.existsSync(stateFile)){
    const saved=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    if(!Number.isInteger(saved.version)||!Array.isArray(saved.plants)||saved.plants.length!==3||!saved.plants.every(p=>Number.isInteger(p.care)&&p.care>=0&&p.care<=3))throw new Error('Invalid garden state; preserve file and repair explicitly');
    state=saved;
  }
  // publicPeer 只输出显示资料与坐标，不序列化响应流、令牌和事件去重缓存。
  function publicPeer(peer){return{id:peer.id,name:peer.name,cursor:peer.cursor};}
  // send 在写缓冲超预算时断开慢连接，避免访问者无限占用内存。
  function send(peer,event){if(peer.res.writableLength>65536){peer.res.destroy();return;}peer.res.write('data: '+JSON.stringify(event)+'\n\n');}
  // broadcast 向当前真实连接扇出事件；没有定时生成的假访客。
  function broadcast(event){for(const peer of peers.values())send(peer,event);}
  // json 统一错误与确认响应，禁止浏览器缓存状态。
  function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
  // persist 先完整写临时文件再替换；失败时不更新内存、不广播成功。
  function persist(next){const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,stateFile);}
  // handleAction 验证单个实际会话的水动作；同步提交保证并发请求串行看到最新版本。
  function handleAction(res,data){
    const peer=peers.get(data.id);if(!peer){json(res,401,{error:'Session expired'});return;}
    const now=Date.now();
    if(data.type==='cursor'){
      if(now-peer.lastCursor<45){json(res,429,{error:'Too fast'});return;}
      const c=data.cursor;if(!c||!['x','y','z'].every(k=>Number.isFinite(c[k]))||Math.abs(c.x)>1e6||Math.abs(c.y)>1e6||c.z<0||c.z>500){json(res,400,{error:'Invalid cursor'});return;}
      peer.lastCursor=now;peer.cursor={x:c.x,y:c.y,z:c.z};broadcast({type:'cursor',id:peer.id,cursor:peer.cursor});json(res,200,{ok:true});return;
    }
    if(data.type!=='water'||!Number.isInteger(data.island)||data.island<0||data.island>2||typeof data.eventId!=='string'||data.eventId.length>80){json(res,400,{error:'Invalid action'});return;}
    if(peer.events.has(data.eventId)){json(res,200,{state,duplicate:true});return;}
    if(now-peer.lastWater<2000){json(res,429,{error:'Let the water settle'});return;}
    const next=structuredClone(state),plant=next.plants[data.island];
    const together=!!plant.last&&plant.last.id!==peer.id&&now-plant.last.at<6000&&peers.has(plant.last.id);
    plant.care=Math.min(3,plant.care+1);plant.last={id:peer.id,name:peer.name,at:now};next.version++;
    try{persist(next);}catch{json(res,500,{error:'Could not save; action not applied'});return;}
    state=next;peer.lastWater=now;peer.events.add(data.eventId);if(peer.events.size>64)peer.events.delete(peer.events.values().next().value);
    broadcast({type:'water',id:peer.id,name:peer.name,island:data.island,together,state});json(res,200,{state});
  }
  // HTTP 路由只允许固定资源；限制请求体、来源、SSE 数量，Demo 不向局域网或互联网开放。
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.headers.host!==`127.0.0.1:${server.address().port}`){json(res,403,{error:'Host denied'});return;}
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){json(res,403,{error:'Origin denied'});return;}
    if(req.method==='GET'&&url.pathname==='/'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(htmlFile).pipe(res);return;
    }
    if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.method==='GET'&&url.pathname==='/state'){json(res,200,{state,connections:peers.size});return;}
    if(req.method==='GET'&&url.pathname==='/events'){
      if(peers.size>=16){json(res,503,{error:'Demo supports 16 windows'});return;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
      const peer={id:crypto.randomUUID(),name:String(++serial).padStart(2,'0'),cursor:null,res,lastCursor:0,lastWater:0,events:new Set()};
      peers.set(peer.id,peer);send(peer,{type:'welcome',you:peer.id,peers:Array.from(peers.values(),publicPeer),state});
      for(const other of peers.values())if(other.id!==peer.id)send(other,{type:'join',peer:publicPeer(peer)});
      // 响应连接真正关闭时释放会话；读完 GET 请求本身不算离开。
      res.on('close',()=>{if(peers.delete(peer.id))broadcast({type:'leave',id:peer.id});});return;
    }
    if(req.method==='POST'&&url.pathname==='/action'){
      let body='',size=0,rejected=false;
      // 超过 4KiB 立即拒绝，后续片段丢弃，不继续增长缓冲。
      req.on('data',chunk=>{size+=chunk.length;if(size>4096){if(!rejected)json(res,413,{error:'Too large'});rejected=true;return;}if(!rejected)body+=chunk;});
      // 完整 JSON 解码后才进入动作契约；语法错误不会部分执行。
      req.on('end',()=>{if(rejected)return;let data;try{data=JSON.parse(body);}catch{json(res,400,{error:'Invalid JSON'});return;}if(!data||typeof data!=='object'){json(res,400,{error:'Invalid payload'});return;}handleAction(res,data);});return;
    }
    json(res,404,{error:'Not found'});
  });
  // SSE 注释心跳不构成 UI 行为，保持连接并检查慢消费者。
  const heartbeat=setInterval(()=>{for(const peer of peers.values()){if(peer.res.writableLength>65536)peer.res.destroy();else peer.res.write(': keepalive\n\n');}},15000);
  heartbeat.unref();server.requestTimeout=10000;
  // 测试与本地停服共用清理入口，先断开长连接再等待监听器关闭。
  function close(){clearInterval(heartbeat);for(const peer of peers.values())peer.res.destroy();return new Promise(resolve=>server.close(resolve));}
  return {server,close};
}

// 直接运行才监听；测试 import 不会意外启动另一个服务。
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=createGardenServer();
  app.server.listen(0,'127.0.0.1',()=>console.log('Garden demo: http://127.0.0.1:'+app.server.address().port+'/'));
  // Ctrl+C 只清理本脚本建立的连接与监听器。
  process.on('SIGINT',()=>{app.close().then(()=>process.exit(0));});
}
