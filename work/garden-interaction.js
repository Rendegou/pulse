/* 互动分支：植物、照料状态与真实指针。单文件可独立玩；配套本地服务支持多窗口。
   三座岛及植物是示例，来客均来自实际打开的连接，不生成虚拟访客。 */
let gardenReady = false, gardenHover = false, gardenYou = '', gardenOnline = false;
let gardenSource = null, gardenBusy = false, gardenNextWater = 0, gardenLastMove = 0;
let gardenState = {version:0, plants:[{care:0,last:null},{care:0,last:null},{care:0,last:null}]};
const gardenPeers = new Map(), gardenEffects = [], gardenGrowth = [0,0,0];
const gardenCopy = {
  zh:{title:'留一片绿意',desc:'这是你在海上的一小块地方。\n有人来过，便多一点生机。',near:'给相遇一点回应。\n为岛上的植物浇一捧水。',names:['你的原点','雨后的花园','远山的庭院'],
    water:'浇一点水',approach:'靠近这株植物',wait:'水正在落下…',ready:'一株植物，等一捧水。',leaf:'叶片舒展开了。',bud:'它长出了一个花苞。',bloom:'这朵花，记得来过的人。',
    detail:'点植物也可以浇水 · 不会枯萎，不用打卡',visit:'打开访客窗口',one:'此刻，只有你在这里',many:' 个窗口在同一片海上',offline:'单人预览',online:'本地联动',connecting:'正在连接',lost:'连接中断，正在重连',
    fixture:'互动 Demo · 三座示例岛',you:'你',guest:'来客',arrival:'有人来到这片海上',remote:'也浇了一捧水',thanks:'水落下了，叶片轻轻回应。',together:'两个人的水，落在同一株植物上。',saved:'生长变化已保存在本机',unsaved:'无法保存；本次变化只在当前页面',
    trace:'最近照料：',fresh:'还没有照料记录',watered:'浇过水',error:'这次浇水未确认，请稍后重试',connectingHint:'正在连接本地互动服务…',soloHint:'直接打开文件是单人体验；双人试玩请运行配套服务。',
    guide:'来这里，一起做一件小事',about:'<p>拖动海面、滚轮或双指靠近。点植物或“浇一点水”，看水滴落下、叶片舒展。三次照料后开花；之后仍会回应，不会枯萎，也不需要每日打卡。</p><p>“打开访客窗口”会打开一个真实的独立连接。把两个窗口并排，移动鼠标、分别浇水，就能看到彼此的指针和相同的植物变化。此 Demo 仅在本机联动，不是互联网邀请，也没有账号与岛屿所有权。</p><p>每座示例岛各有一株植物，生长记录保存在本机。两个人相隔六秒内浇水，会有额外的共同光点，但独自也能开花。植物碰触与按钮共用同一个动作。</p><p>设计借鉴：<a href="https://animalcrossing.nintendo.com/new-horizons/share/" target="_blank" rel="noreferrer">动物森友会的拜访</a>、<a href="https://thatgamecompany.helpshift.com/hc/en/17-sky-children-of-the-light/faq/521-what-are-message-shrines-message-candles-message-boats-shared-spaces-and-shared-memories/" target="_blank" rel="noreferrer">光·遇的共同空间与痕迹</a>。本 Demo 的规则和图形为原创实验，不复制其素材或经济系统。</p>'},
  en:{title:'A little green',desc:'A small place of your own at sea.\nA little more alive after each visit.',near:'Give an encounter a small reply.\nA handful of water is enough.',names:['Your origin','The rain garden','A distant courtyard'],
    water:'Give some water',approach:'Approach the plant',wait:'Let the water settle…',ready:'A plant. A little water.',leaf:'The leaves unfurl.',bud:'A small bud has appeared.',bloom:'A flower that remembers a visit.',
    detail:'Select the plant to water · No wilting, no daily chores',visit:'Open a visitor window',one:'Just you, for now',many:' windows on the same sea',offline:'Solo preview',online:'Local multiplayer',connecting:'Connecting',lost:'Disconnected · reconnecting',
    fixture:'Interaction demo · Three sample islands',you:'You',guest:'Visitor',arrival:'Someone has arrived',remote:'gave some water too',thanks:'A little water. A gentle reply.',together:'Two visitors. One little plant.',saved:'Growth saved on this computer',unsaved:'Storage unavailable; changes last for this page only',
    trace:'Last cared for by ',fresh:'No visits recorded yet',watered:'watered this plant',error:'Watering was not confirmed. Please try again.',connectingHint:'Connecting to the local demo…',soloHint:'A file opens in solo mode. Run the included server to try two windows.',
    guide:'A small thing to do together',about:'<p>Drag to explore. Scroll or pinch to approach. Select the plant or Give some water. Leaves unfurl; after three waterings a flower opens. It never wilts and needs no daily chores.</p><p>Open a visitor window creates a real second connection. Place the windows side by side to see each cursor and water the same plant. This is local multiplayer, not an internet invitation. There are no accounts or island ownership.</p><p>Each sample island has its own plant. Growth is saved locally. Water within six seconds of another visitor for a shared light effect; a solo visitor can also reach flowering. Reduced motion keeps feedback still.</p><p>Inspired by <a href="https://animalcrossing.nintendo.com/new-horizons/share/" target="_blank" rel="noreferrer">Animal Crossing visits</a> and <a href="https://thatgamecompany.helpshift.com/hc/en/17-sky-children-of-the-light/faq/521-what-are-message-shrines-message-candles-message-boats-shared-spaces-and-shared-memories/" target="_blank" rel="noreferrer">Sky shared spaces and memories</a>. Rules and geometry in this demo are original.</p>'}
};

// gardenNotice 只播报有意义的动作和连接变化，定时清理提示，不显示伪造的来访。
function gardenNotice(message) {
  $('toast').textContent=message; $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  // 提示不拦截鼠标；四秒后退场，下一条提示会重置计时。
  toastTimer=setTimeout(()=>{$('toast').classList.remove('visible');$('toast').textContent='';},4000);
}

// gardenActionText 在镜头跨越远近阈值时更新按钮语义，避免“浇水”按钮第一次点击只靠近却没有说明。
function gardenActionText() {
  const c=gardenCopy[lang];
  $('water-label').textContent=gardenBusy||Date.now()<gardenNextWater?c.wait:nearState?c.water:c.approach;
  $('plant-caption').textContent=nearState?c.water:c.approach;
  $('plant-hit').ariaLabel=nearState?c.water:c.approach;
}

// gardenText 共用当前语言和主题系统；只改变界面，不翻译用户内容。
function gardenText() {
  const c=gardenCopy[lang];
  Object.assign(copy[lang], {headline:c.title,description:c.desc,nearDesc:c.near,names:c.names,approach:c.approach,nearby:lang==='zh'?'去海的另一边':'Across the water',fixture:c.fixture,about:c.about,aboutTitle:c.guide,articles:''});
  $('edition').textContent=lang==='zh'?'来过，便有回响':'A SMALL SHARED MOMENT';
  $('fixture').textContent=c.fixture; $('about-title').textContent=c.guide; $('about-copy').innerHTML=c.about;
  $('visit').textContent=c.visit; $('plant-caption').textContent=nearState?c.water:c.approach;
  $('plant-hit').ariaLabel=nearState?c.water:c.approach;
  $('care-panel').ariaLabel=lang==='zh'?'照料植物':'Care for the plant';
  $('brand').ariaLabel=lang==='zh'?'回到初始视角':'Return to the starting view';
  document.querySelector('.tools').ariaLabel=lang==='zh'?'显示设置':'Display settings';
  $('nearby').ariaLabel=lang==='zh'?'附近岛屿':'Nearby islands';
  $('water-label').textContent=gardenBusy||Date.now()<gardenNextWater?c.wait:c.water;
  $('care-detail').textContent=c.detail;
  const plant=gardenState.plants[selected], stage=Math.min(3,plant.care);
  $('care-note').textContent=[c.ready,c.leaf,c.bud,c.bloom][stage];
  $('trace').textContent=plant.last?c.trace+(plant.last.id===gardenYou?c.you:c.guest+' '+plant.last.name)+' · '+c.watered:c.fresh;
  $('offline').textContent=location.protocol==='file:'?c.offline:gardenOnline?c.online:c.connecting;
  $('presence').textContent=location.protocol==='file:'?c.offline:!gardenOnline?c.lost:gardenPeers.size<=1?c.one:gardenPeers.size+c.many;
  for(let i=0;i<3;i++)nearbyButtons[i].firstElementChild.textContent=c.names[i];
  updateMode(true);
}

// plantWorld 锚定岛屿本地坐标与地形高度；相机移动不会改变植物的归属与位置。
function plantWorld(index,x=0,y=0,z=0) {
  const s=islands[index]; return localWorld(s,x,y-12,terrainHeight(s,0,-12)+z);
}

// plantProject 让茎、叶片、花瓣与命中入口共享同一投影；越过近裁剪返回 null。
function plantProject(index,x,y,z) {
  const p=plantWorld(index,x,y,z); return project(p.x,p.y,p.z);
}

// pickPlant 命中视觉植物区域；拖动是否构成点击仍交给现有手势阈值判定。
function pickPlant(x,y) {
  const p=plantProject(selected,0,0,48);
  return !!p && Math.hypot(x-p.x,(y-p.y)*.75)<Math.max(30,48*p.s);
}

// positionGarden 将透明语义按钮贴合植物；画面外隐藏，固定照料按钮始终可键盘操作。
function positionGarden() {
  if(!gardenReady)return;
  const p=plantProject(selected,0,0,48), el=$('plant-target');
  el.hidden=!p||p.x<30||p.x>W-30||p.y<90||p.y>H-210;
  if(!el.hidden){el.style.left=p.x+'px';el.style.top=p.y+'px';el.style.width=clamp(95*p.s,64,210)+'px';el.style.height=clamp(115*p.s,75,230)+'px';}
  const disabled=gardenBusy||Date.now()<gardenNextWater||(location.protocol!=='file:'&&!gardenOnline);
  if($('water').disabled!==disabled){$('water').disabled=disabled;gardenText();}
  $('plant-hit').disabled=disabled;
  document.body.dataset.garden=JSON.stringify({stage:gardenState.plants[selected].care,selected,online:gardenOnline,peers:gardenPeers.size,version:gardenState.version});
}

// leafShape 用两条参数曲线构成有折面和中脉的叶片；顶点在三维空间计算，没有图片资源。
function leafShape(index,base,angle,length,width,lift,opacity,petal=false) {
  const edgeA=[],edgeB=[],vein=[];
  for(let k=0;k<=18;k++){
    const t=k/18,w=Math.sin(t*Math.PI)*width,c=Math.cos(angle),s=Math.sin(angle);
    const x=base.x+c*t*length,y=base.y+s*t*length,z=base.z+Math.sin(t*Math.PI*.7)*lift;
    edgeA.push(plantWorld(index,x-s*w,y+c*w,z));edgeB.push(plantWorld(index,x+s*w,y-c*w,z-2*Math.sin(t*Math.PI)));
    vein.push(plantWorld(index,x,y,z+1.5));
  }
  polygon(ac,[...edgeA,...edgeB.reverse()],rgba(petal?P.shore:P.land,opacity),rgba(P.foam,.55*opacity),.7);
  drawLine(ac,vein,rgba(P.shore,.75*opacity),.85);
  // 少量固定颗粒沿叶脉展开，让近景材质与岛屿一致；不使用每帧随机噪声。
  for(let j=0;j<22;j++){
    const t=(j+.5)/22,w=Math.sin(t*Math.PI)*width*(hash(j,3,9)-.5)*1.6;
    const p=plantProject(index,base.x+Math.cos(angle)*t*length-Math.sin(angle)*w,base.y+Math.sin(angle)*t*length+Math.cos(angle)*w,base.z+Math.sin(t*Math.PI*.7)*lift+1);
    if(p){ac.fillStyle=rgba(P.foam,.52*opacity);ac.fillRect(p.x,p.y,clamp(p.s*.6,.5,1.4),clamp(p.s*.6,.5,1.4));}
  }
}

// drawPlant 绘制细茎、分层叶片和花朵；生长只读状态，缓动不产生业务写入。
function drawPlant(index,now) {
  const p=plantProject(index,0,0,0); if(!p||p.x<-200||p.x>W+200||p.y<-200||p.y>H+220)return;
  const growth=gardenGrowth[index], sway=reduced.matches?0:Math.sin(time*.8+index)*2;
  const stem=[],height=56+growth*13;
  for(let k=0;k<=24;k++){const t=k/24;stem.push(plantWorld(index,Math.sin(t*2.2)*6+sway*t*t,0,height*t));}
  // 土壤投影和细粒点圈使植物落在岛面上；不使用逐粒子阴影滤镜。
  const ring=[];for(let j=0;j<=64;j++){const a=j/64*TAU;ring.push(plantWorld(index,Math.cos(a)*28,Math.sin(a)*20,.5));}
  polygon(ac,ring,rgba(P.contour,.14),rgba(P.shore,.32),.6);
  drawLine(ac,stem,rgba(P.foam,.9),Math.max(1.1,p.s*1.4));
  leafShape(index,{x:5,y:0,z:25},2.9,34+growth*5,9+growth*1.4,13,.8);
  leafShape(index,{x:6,y:0,z:40},-.3,30+growth*6,9+growth*1.6,20,.86);
  if(growth>.2)leafShape(index,{x:6,y:0,z:55},-2.2,24+growth*4,7+growth,18,Math.min(.8,growth));
  if(growth>1.1)leafShape(index,{x:6,y:0,z:68},.9,23,7,13,Math.min(.8,growth-1));
  const top=plantProject(index,6+sway,0,height);
  if(top&&growth>1.25){
    const opening=smooth(1.8,3,growth);
    for(let j=0;j<7;j++){
      const angle=j/7*TAU+.3;
      leafShape(index,{x:6+sway,y:0,z:height},angle,6+opening*21,3+opening*6,12-opening*4,.92,true);
    }
    ac.fillStyle=P.gold;ac.beginPath();ac.arc(top.x,top.y-4*p.s,Math.max(1.7,3.2*p.s),0,TAU);ac.fill();
  }
  if(index===selected&&gardenHover){drawLine(ac,ring,rgba(P.shore,.7),1.1);}
}

// drawGarden 与已有空气层共享 30Hz 绘制；叶片缓动、限量水滴与远端插值都不重绘地形。
function drawGarden(now) {
  if(!gardenReady)return;
  for(let i=0;i<3;i++){
    const desired=Math.min(3,gardenState.plants[i].care);
    gardenGrowth[i]+=reduced.matches?desired-gardenGrowth[i]:(desired-gardenGrowth[i])*.055;
    if(i===selected)drawPlant(i,now);
  }
  for(let i=gardenEffects.length-1;i>=0;i--){
    const e=gardenEffects[i],life=(Date.now()-e.time)/2400;
    if(life>=1){gardenEffects.splice(i,1);continue;}
    if(e.island!==selected)continue;
    if(reduced.matches){const p=plantProject(e.island,0,0,10);if(p){ac.strokeStyle=P.gold;ac.beginPath();ac.ellipse(p.x,p.y,35*p.s,18*p.s,0,0,TAU);ac.stroke();}continue;}
    // 水滴按固定种子落下，随后变成向外扩散的土壤光点；每次动作最多 56 个点。
    for(let j=0;j<56;j++){
      const n=hash(j,5,17),a=hash(j,2,8)*TAU,q=clamp(life*1.65-n*.32,0,1);
      const r=q<.65?12+n*19:18+(q-.65)*130;
      const z=q<.65?155*(1-q/.65)+8:5+Math.sin((q-.65)*Math.PI)*18;
      const p=plantProject(e.island,Math.cos(a)*r,Math.sin(a)*r,z);if(!p||q===0)continue;
      ac.fillStyle=rgba(e.together?P.shore:P.foam,Math.sin(q*Math.PI)*.85);
      ac.beginPath();ac.ellipse(p.x,p.y,clamp(p.s*(.6+n),.6,3),clamp(p.s*(q<.65?3:1),1,5),0,0,TAU);ac.fill();
    }
  }
  for(const [id,peer]of gardenPeers){
    if(id===gardenYou||!peer.cursor)continue;
    const c=peer.cursor,shown=peer.shown||(peer.shown={...c});
    shown.x+=(c.x-shown.x)*.3;shown.y+=(c.y-shown.y)*.3;shown.z+=(c.z-shown.z)*.3;
    const p=project(shown.x,shown.y,shown.z);if(!p||p.x<0||p.x>W||p.y<0||p.y>H)continue;
    ac.save();ac.translate(p.x,p.y);ac.strokeStyle=rgba(P.foam,.95);ac.fillStyle=P.bg;ac.lineWidth=1.3;
    ac.beginPath();ac.moveTo(0,0);ac.lineTo(5,16);ac.lineTo(9,10);ac.lineTo(16,7);ac.closePath();ac.fill();ac.stroke();
    ac.fillStyle=rgba(P.foam,.95);ac.font='11px sans-serif';ac.fillText(gardenCopy[lang].guest+' '+peer.name,19,18);ac.restore();
  }
}

// surfaceWorld 反求岛面或海面上的指向位置，使用同一地形高度；远端相机独立时仍指向同一物件。
function surfaceWorld(sx,sy) {
  let p=unprojectSea(sx,sy);
  // heightAt 将世界坐标变回各岛局部坐标，仅在岛内返回地形高度。
  function heightAt(x,y){for(const s of islands){const dx=x-s.x,dy=y-s.y,c=Math.cos(s.rot),sn=Math.sin(s.rot),lx=dx*c+dy*sn,ly=-dx*sn+dy*c;if(Math.hypot(lx,ly/s.sy)<s.r*.98)return terrainHeight(s,lx,ly)+2;}return 0;}
  for(let i=0;i<9;i++){
    const z=heightAt(p.x,p.y),q=project(p.x,p.y,z),qx=project(p.x+1,p.y,heightAt(p.x+1,p.y)),qy=project(p.x,p.y+1,heightAt(p.x,p.y+1));
    if(!q||!qx||!qy)break;
    const a=qx.x-q.x,b=qy.x-q.x,c=qx.y-q.y,d=qy.y-q.y,det=a*d-b*c;if(Math.abs(det)<.00001)break;
    const ex=sx-q.x,ey=sy-q.y;p.x+=clamp((ex*d-ey*b)/det,-400,400);p.y+=clamp((ey*a-ex*c)/det,-400,400);
  }
  return {...p,z:heightAt(p.x,p.y)};
}

// acceptGarden 只接受不倒退的权威快照；重连 welcome 可显式重设版本，动画与确认分离。
function acceptGarden(next,reset=false) {
  if(!next||!Array.isArray(next.plants)||next.plants.length!==3)return;
  if(!reset&&next.version<gardenState.version)return;
  gardenState=next;gardenText();dirty=true;lastSea=0;wake();
}

// postGarden 为本地会话发送有界动作；超时和 HTTP 错误不会假装照料成功。
async function postGarden(payload) {
  const response=await fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,id:gardenYou}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Action '+response.status);
  return response.json();
}

// waterPlant 统一按钮和画布命中入口；服务端确认后才生长，离线时明确只保存在本机。
async function waterPlant() {
  if(gardenBusy||Date.now()<gardenNextWater)return;
  if(!nearState){approachIsland(selected);return;}
  if(location.protocol!=='file:'&&!gardenOnline){gardenNotice(gardenCopy[lang].connectingHint);return;}
  const index=selected;gardenBusy=true;gardenText();positionGarden();
  try{
    if(location.protocol==='file:'){
      const next=JSON.parse(JSON.stringify(gardenState));next.version++;next.plants[index].care=Math.min(3,next.plants[index].care+1);
      next.plants[index].last={id:'solo',name:'',at:Date.now()};gardenYou='solo';acceptGarden(next);
      gardenEffects.push({island:index,time:Date.now(),together:false});
      try{localStorage.setItem('pulse-garden-state-v1',JSON.stringify(next));gardenNotice(gardenCopy[lang].thanks);}catch{gardenNotice(gardenCopy[lang].unsaved);}
    }else{
      const result=await postGarden({type:'water',island:index,eventId:crypto.randomUUID()});acceptGarden(result.state);
    }
    gardenNextWater=Date.now()+2500;
  }catch{gardenNotice(gardenCopy[lang].error);}
  finally{
    gardenBusy=false;gardenText();dirty=true;wake();
    // 冷却结束必须唤醒减少动态模式下已停止的画面，恢复可操作按钮。
    setTimeout(()=>{gardenText();positionGarden();lastSea=0;wake();},2600);
  }
}

// connectGarden 接收实际本地连接；网络断开清理来客，重连 welcome 重建快照而不是重复入场动画。
function connectGarden() {
  gardenSource=new EventSource('/events');
  // 事件解码失败只报告并等待下一帧快照，不把未知载荷写进页面 HTML。
  gardenSource.onmessage=(event)=>{
    let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='welcome'){
      gardenYou=data.you;gardenOnline=true;gardenPeers.clear();for(const peer of data.peers)gardenPeers.set(peer.id,peer);acceptGarden(data.state,true);
      for(let i=0;i<3;i++)gardenGrowth[i]=gardenState.plants[i].care;
    }else if(data.type==='join'){
      gardenPeers.set(data.peer.id,data.peer);gardenNotice(gardenCopy[lang].arrival);gardenText();
    }else if(data.type==='leave'){
      gardenPeers.delete(data.id);gardenText();
    }else if(data.type==='cursor'){
      const peer=gardenPeers.get(data.id);if(peer)peer.cursor=data.cursor;
    }else if(data.type==='water'){
      acceptGarden(data.state);gardenEffects.push({island:data.island,time:Date.now(),together:data.together});
      if(gardenEffects.length>12)gardenEffects.shift();
      gardenNotice(data.together?gardenCopy[lang].together:data.id===gardenYou?gardenCopy[lang].thanks:gardenCopy[lang].guest+' '+data.name+' '+gardenCopy[lang].remote);
    }
    lastSea=0;wake();
  };
  // 断线后立即禁用需要确认的动作，不显示过期的访客数量。
  gardenSource.onerror=()=>{gardenOnline=false;gardenPeers.clear();gardenText();positionGarden();lastSea=0;wake();};
}

// startGarden 安装一次互动层；本地服务失败不降级伪造多人，直接文件模式才使用本地存储。
function startGarden() {
  gardenReady=true;
  if(location.protocol==='file:'){
    gardenYou='solo';try{const saved=JSON.parse(localStorage.getItem('pulse-garden-state-v1'));if(saved&&saved.plants?.every(p=>Number.isInteger(p.care)&&p.care>=0&&p.care<=3))acceptGarden(saved,true);}catch{}
    for(let i=0;i<3;i++)gardenGrowth[i]=gardenState.plants[i].care;
    $('visit').href='#';
    // 文件来源没有共享服务，明确提示启动方法，不打开假的访客。
    $('visit').addEventListener('click',e=>{e.preventDefault();gardenNotice(gardenCopy[lang].soloHint);});
  }else connectGarden();
  // 可访问的按钮和画布入口使用同一水动作；悬停仅改变可供操作的提示。
  $('water').addEventListener('click',waterPlant);$('plant-hit').addEventListener('click',waterPlant);
  $('plant-hit').addEventListener('pointerenter',()=>{gardenHover=true;lastSea=0;wake();});
  $('plant-hit').addEventListener('pointerleave',()=>{gardenHover=false;lastSea=0;wake();});
  // 指针最多每 65ms 上报一次，窗口失焦不生成假动作；不在 UI 面板上广播空间位置。
  document.addEventListener('pointermove',e=>{
    if(!gardenOnline||performance.now()-gardenLastMove<65||!(e.target===land||e.target===$('plant-hit')))return;
    gardenLastMove=performance.now();
    const cursor=e.target===$('plant-hit')?plantWorld(selected,0,0,65):surfaceWorld(e.clientX,e.clientY);
    // 指针包允许丢弃；下次移动即覆盖，不用重试旧坐标。
    postGarden({type:'cursor',cursor}).catch(()=>{});
  });
  // 本窗口退出释放 SSE；来客离开由服务器的连接关闭广播。
  addEventListener('pagehide',()=>gardenSource?.close());
  gardenText();positionGarden();dirty=true;wake();
}
