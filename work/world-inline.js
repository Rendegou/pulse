
'use strict';
const canvas = document.getElementById('world'), ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const camera = { x:0, y:0, zoom:1 };
const palette = { paper:'#e6b48a', night:'#bca6e4', blue:'#79e6ff' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let width=1,height=1,district='',base={x:0,y:0},houses=[],ownHouse=null,draft=null,selection=null;
let placing=false,drag=null,hover=null,pointer={x:0,y:0,inside:false},showGhosts=true,toastTimer=0,storageOK=true;
// $ 将稳定的元素 ID 映射到页面节点，仅由界面层使用。
function $(id){return document.getElementById(id);}
// hash 将规范地址映射为稳定的 32 位示意种子；不承担身份或安全保证。
function hash(text){let n=2166136261;for(const c of text){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return n>>>0;}
// cleanAddress 去掉首尾空白并统一 Unicode 组合形式，大小写保留以形成明确的地址规则。
function cleanAddress(value){return value.trim().normalize('NFC').slice(0,40);}
// clamp 限制相机缩放与坐标的数值范围，避免极端输入造成不可绘制状态。
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
// notify 提供一次操作反馈，替换上次定时器避免多个提示互相隐藏。
function notify(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').classList.remove('show');},3200);}
// storageKey 用完整地址隔离本机内容，地图示意种子的碰撞不会混淆存储记录。
function storageKey(){return 'pulse-world-demo-v1:'+district;}
// validHouse 对本地存储做最小结构校验，避免损坏数据破坏画布和编辑器。
function validHouse(h){return h&&['studio','loft','garden'].includes(h.shape)&&Object.hasOwn(palette,h.theme)&&['name','author','title','body'].every(k=>typeof h[k]==='string')&&h.name.length<=24&&h.author.length<=20&&h.title.length<=60&&h.body.length<=5000&&Number.isFinite(h.x)&&Number.isFinite(h.y)&&Math.abs(h.x)<=1e7&&Math.abs(h.y)<=1e7;}
// saveLocal 只保存这个街区的一间自建房；存储不可用时保留当前会话并明确反馈。
function saveLocal(){try{localStorage.setItem(storageKey(),JSON.stringify(ownHouse));storageOK=true;}catch{storageOK=false;notify('浏览器没有允许存储；这间房子暂时只留在当前页面。');}}
// examples 为街区生成少量固定示例内容，不将样本房子或指针计作真实居民。
function examples(seed){const dx=(seed%3-1)*30;return [
 {id:'sample-0',x:-320+dx,y:-65,name:'深夜杂货铺',author:'阿澈',title:'今天没有什么大事发生',shape:'studio',theme:'paper',body:'晚上十一点，楼下的面包店还亮着灯。\n\n我绕了一点路回家，把最后一袋吐司带走。生活有时很小，小到只是有人问你，要不要帮忙切片。\n\n想把这样的事情写在这里。你不用点赞，路过就很好。'},
 {id:'sample-1',x:-20,y:-210,name:'一平米实验室',author:'Lin',title:'把一个小想法，做成能碰到的东西',shape:'loft',theme:'blue',body:'这个房间里没有很厉害的作品，只有一些正在发生的实验。\n\n比如：文章可以是一扇门吗？光标可以变成打招呼的方式吗？\n\n先做一点点，看看另一个人走过来时会发生什么。'},
 {id:'sample-2',x:275,y:-10,name:'慢慢生长的花园',author:'小满',title:'有些页面可以慢一点',shape:'garden',theme:'paper',body:'在信息流里，总有人急着让你看下一条。\n\n我想做一块没有下一条的地方。种一棵树，放一把椅子，把读到一半的书摊开。\n\n今天的更新：薄荷长出了新的叶子。'},
 {id:'sample-3',x:-20,y:190,name:'收集未完成',author:'Nora',title:'一个还没有结尾的故事',shape:'studio',theme:'night',body:'如果互联网是一座城，那些很久没更新的博客，会不会是窗台积了一层灰的小房子？\n\n也许哪一天，主人突然回来，打开窗户。\n\n我想在这里等那盏灯亮起来。'}];}
// enterDistrict 以字符串切换示意街区并恢复本地房子；显式跳转重置编辑状态和相机。
function enterDistrict(value){const name=cleanAddress(value);if(!name){notify('给这片街区起一个名字。');return;}district=name;$('address').value=name;$('district').textContent=name;const seed=hash(name);base={x:(seed%20001-10000)*64,y:(hash(name+'y')%20001-10000)*64};houses=examples(seed);ownHouse=null;try{const saved=JSON.parse(localStorage.getItem(storageKey())||'null');if(validHouse(saved)){ownHouse={...saved,id:'mine',mine:true};houses.push(ownHouse);}}catch{notify('没有读取到本地房子；你仍然可以浏览和搭建。');}camera.x=0;camera.y=0;camera.zoom=width<600?.62:.9;cancelPlacement();closePanels();selection=null;updateHomeUI();document.querySelectorAll('[data-address]').forEach(b=>{b.classList.toggle('active',b.dataset.address===name);});try{history.replaceState(null,'','#'+encodeURIComponent(name));}catch{}notify('已抵达「'+name+'」 · 相同地址，回到同一处');}
// updateHomeUI 同步本地房屋状态，避免用户重复建立不可追踪的多个房子。
function updateHomeUI(){$('build').textContent=ownHouse?'编辑我的房子':'＋ 搭一间房子';$('myHome').hidden=!ownHouse;$('homeHint').textContent=ownHouse?'你已经在「'+district+'」留下一间房子。':'挑一处空地，放下一间房子。里面装下最近想写的话。';}
// resize 根据实际容器尺寸设置像素密度，世界坐标仍以 CSS 像素为单位。
function resize(){const r=stage.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
// toWorld 将容器内屏幕位置反投影为当前街区坐标，用于点击和放置。
function toWorld(x,y){return {x:(x-width/2)/camera.zoom+camera.x,y:(y-height/2)/camera.zoom+camera.y};}
// eventPoint 读取事件相对于画布的位置，不把视口坐标直接当作世界坐标。
function eventPoint(e){const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
// zoomAt 保持光标下的世界位置不变，让缩放围绕用户正在看的位置发生。
function zoomAt(factor,x=width/2,y=height/2){const before=toWorld(x,y);camera.zoom=clamp(camera.zoom*factor,.35,1.8);const after=toWorld(x,y);camera.x=clamp(camera.x+before.x-after.x,-1e7,1e7);camera.y=clamp(camera.y+before.y-after.y,-1e7,1e7);}
// hitHouse 使用与绘制匹配的房屋占地检测点击，标题区也可点开文章。
function hitHouse(p){for(let i=houses.length-1;i>=0;i--){const h=houses[i];if(Math.abs(p.x-h.x)<107&&p.y>h.y-78&&p.y<h.y+116)return h;}return null;}
// roundBox 绘制带小圆角的空间块，只改变当前 Canvas 路径。
function roundBox(x,y,w,h,r=6){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
// drawHouse 把房子外形、文章名和主人画成地图对象；自建房用绿色边界标记。
function drawHouse(h,ghost=false){const color=h.mine?'#d9ff68':palette[h.theme];ctx.save();ctx.translate(h.x,h.y);ctx.globalAlpha=ghost?.6:1;ctx.fillStyle=h.mine?'#152019':'#101a22';ctx.strokeStyle=hover===h||selection===h?color:color+'66';ctx.lineWidth=hover===h?2:1;roundBox(-100,-70,200,130,10);ctx.fill();ctx.stroke();ctx.fillStyle=color+'0c';roundBox(-91,-61,182,110);ctx.fill();
 if(h.shape==='studio'){ctx.beginPath();ctx.moveTo(-78,-15);ctx.lineTo(0,-58);ctx.lineTo(78,-15);ctx.strokeStyle=color+'77';ctx.stroke();ctx.strokeRect(-61,-15,122,55);ctx.fillStyle=color+'9c';ctx.fillRect(-44,0,23,23);ctx.fillRect(20,0,23,23);ctx.strokeRect(-9,14,18,26);}
 if(h.shape==='loft'){ctx.strokeStyle=color+'80';ctx.strokeRect(-72,-44,144,80);for(let i=0;i<4;i++){ctx.fillStyle=color+(i===1?'70':'18');ctx.fillRect(-64+i*34,-36,27,44);}ctx.fillStyle=color+'60';ctx.fillRect(-55,22,65,3);ctx.fillRect(45,4,8,32);}
 if(h.shape==='garden'){ctx.strokeStyle=color+'70';ctx.strokeRect(-59,-37,78,68);ctx.fillStyle=color+'88';ctx.fillRect(-45,-22,19,19);ctx.strokeRect(-8,7,15,24);ctx.fillStyle='#93bda024';for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(49,-29+i*32,14,0,7);ctx.fill();ctx.strokeStyle='#91ba9566';ctx.stroke();}ctx.setLineDash([3,5]);ctx.strokeRect(-80,-53,157,101);ctx.setLineDash([]);}
 ctx.fillStyle=color;ctx.beginPath();ctx.arc(80,-51,3,0,7);ctx.fill();ctx.font='13px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillStyle='#d4dfe8';ctx.fillText(h.name,0,84,210);ctx.font='10px Consolas,"Microsoft YaHei",sans-serif';ctx.fillStyle='#768b9c';ctx.fillText(h.mine?'你的房子 · '+h.author:h.author+' · 示例文章',0,104,200);ctx.restore();}
// cursorShape 绘制带署名的指针，演示邻居与自己的光标在标签中明确区分。
function cursorShape(x,y,label,color){ctx.save();ctx.translate(x,y);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(2,19);ctx.lineTo(7,13);ctx.lineTo(15,12);ctx.closePath();ctx.fill();ctx.font='10px "Microsoft YaHei",sans-serif';const tw=ctx.measureText(label).width;ctx.fillStyle='#101c25e8';roundBox(13,17,tw+16,23,4);ctx.fill();ctx.fillStyle=color;ctx.fillText(label,21,32);ctx.restore();}
// draw 每帧只绘制当前视窗和有限对象；演示运动使用时间而不是依赖帧数。
function draw(now){ctx.clearRect(0,0,width,height);ctx.fillStyle='#080e15';ctx.fillRect(0,0,width,height);ctx.save();ctx.translate(width/2-camera.x*camera.zoom,height/2-camera.y*camera.zoom);ctx.scale(camera.zoom,camera.zoom);const x0=camera.x-width/(2*camera.zoom),y0=camera.y-height/(2*camera.zoom);ctx.strokeStyle='#1b2a363e';ctx.lineWidth=1/camera.zoom;ctx.beginPath();for(let x=Math.floor(x0/48)*48;x<x0+width/camera.zoom;x+=48){ctx.moveTo(x,y0);ctx.lineTo(x,y0+height/camera.zoom);}for(let y=Math.floor(y0/48)*48;y<y0+height/camera.zoom;y+=48){ctx.moveTo(x0,y);ctx.lineTo(x0+width/camera.zoom,y);}ctx.stroke();
 ctx.setLineDash([3,9]);ctx.strokeStyle='#50766b38';ctx.beginPath();ctx.moveTo(-600,85);ctx.lineTo(550,85);ctx.moveTo(130,-430);ctx.lineTo(130,480);ctx.stroke();ctx.setLineDash([]);ctx.font='9px Consolas,monospace';ctx.fillStyle='#577966';ctx.fillText('SLOW LANE / '+district,-450,74);ctx.fillText('READ · WANDER · STAY',151,440);
 for(const h of houses){if(Math.abs(h.x-camera.x)<width/(2*camera.zoom)+150&&Math.abs(h.y-camera.y)<height/(2*camera.zoom)+160)drawHouse(h);}
 if(placing&&pointer.inside&&draft){const p=toWorld(pointer.x,pointer.y);drawHouse({...draft,x:Math.round(p.x/24)*24,y:Math.round(p.y/24)*24,mine:true},true);}
 if(showGhosts){const t=reducedMotion?1:now/2500;cursorShape(-155+Math.sin(t)*75,-35+Math.cos(t*.72)*55,'Lin · 演示','#79e6ff');cursorShape(145+Math.cos(t*.62)*95,165+Math.sin(t*.9)*45,'小满 · 演示','#d4b5fb');}ctx.restore();
 if(pointer.inside&&!drag&&!placing)cursorShape(pointer.x+2,pointer.y+2,'你','#d9ff68');$('zoomValue').textContent=Math.round(camera.zoom*100)+'%';$('coord').textContent='X '+Math.round(base.x+camera.x)+' · Y '+Math.round(base.y+camera.y)+' / '+district;requestAnimationFrame(draw);}
// closePanels 关闭侧面板并恢复画布焦点，避免键盘用户丢失操作位置。
function closePanels(){$('reader').hidden=true;$('editor').hidden=true;canvas.focus({preventScroll:true});}
// openHouse 以安全文本节点展示文章，主题从固定白名单映射，不执行作者代码。
function openHouse(h){selection=h;$('editor').hidden=true;$('reader').hidden=false;$('reader').dataset.theme=h.theme;$('articleHouse').textContent=h.name+' / '+district;$('articleTitle').textContent=h.title;$('articleMeta').textContent=h.author+' · '+(h.mine?'你的本地文章':'示例文章')+' · 房子坐标 '+Math.round(base.x+h.x)+', '+Math.round(base.y+h.y);$('articleBody').textContent=h.body;$('editHouse').hidden=!h.mine;$('reader').scrollTop=0;$('reader').querySelector('button').focus({preventScroll:true});}
// focusHouse 将相机移向目标房子，再打开文章；不改变世界中的房子坐标。
function focusHouse(h){camera.x=h.x+Math.min(170,width*.15)/camera.zoom;camera.y=h.y;openHouse(h);}
// startEditor 在独立表单中修改草稿，保存之前不改变已建成的房子。
function startEditor(){cancelPlacement();$('reader').hidden=true;$('editor').hidden=false;$('formError').textContent='';if(ownHouse){$('houseName').value=ownHouse.name;$('authorName').value=ownHouse.author;$('houseShape').value=ownHouse.shape;$('houseTheme').value=ownHouse.theme;$('postTitle').value=ownHouse.title;$('postBody').value=ownHouse.body;}$('saveHouse').textContent=ownHouse?'保存房子和文章':'下一步：挑一处空地 ↗';$('houseName').focus();}
// cancelPlacement 取消尚未落地的草稿，恢复浏览提示，不删除已保存的房子。
function cancelPlacement(){placing=false;draft=null;canvas.classList.remove('placing');$('help').textContent='拖动漫游 · 滚轮缩放 · 点击房子阅读';}
// submitHouse 校验有界表单；已有房子直接保存，新房子进入选址阶段。
function submitHouse(e){e.preventDefault();draft={id:'mine',mine:true,name:$('houseName').value.trim(),author:$('authorName').value.trim(),shape:$('houseShape').value,theme:$('houseTheme').value,title:$('postTitle').value.trim(),body:$('postBody').value.trim()};if(!draft.name||!draft.author||!draft.title||!draft.body){$('formError').textContent='名字、署名、标题和正文都需要写一点内容。';return;}if(ownHouse){Object.assign(ownHouse,draft);saveLocal();updateHomeUI();closePanels();openHouse(ownHouse);if(storageOK)notify('已保存。你的小房子有了新的故事。');draft=null;}else{placing=true;$('editor').hidden=true;canvas.classList.add('placing');$('help').textContent='点一处空地放下房子 · 拖动仍可漫游 · Esc 取消';notify('挑一处空地，点击放下你的房子。');canvas.focus();}}
// placeHouse 将草稿对齐网格，拒绝明显重叠并只保存一间个人房子。
function placeHouse(p){const x=clamp(Math.round(p.x/24)*24,-1e7,1e7),y=clamp(Math.round(p.y/24)*24,-1e7,1e7);if(houses.some(h=>Math.abs(h.x-x)<228&&Math.abs(h.y-y)<212)){notify('这里离另一间房子太近了，向旁边挪一点。');return;}ownHouse={...draft,x,y};houses.push(ownHouse);saveLocal();cancelPlacement();updateHomeUI();openHouse(ownHouse);if(storageOK)notify('房子落成。以后输入「'+district+'」就能回来。');}
// pointerDown 记录拖动起点，使用捕获保证拖出画布后仍能正常结束手势。
function pointerDown(e){if(e.button!==0)return;const p=eventPoint(e);drag={id:e.pointerId,start:p,camX:camera.x,camY:camera.y,moved:false};canvas.setPointerCapture(e.pointerId);canvas.focus();}
// pointerMove 区分点击与拖动，移动相机而非移动世界中的房子。
function pointerMove(e){pointer={...eventPoint(e),inside:true};if(drag&&drag.id===e.pointerId){const dx=pointer.x-drag.start.x,dy=pointer.y-drag.start.y;if(Math.hypot(dx,dy)>5)drag.moved=true;if(drag.moved){camera.x=clamp(drag.camX-dx/camera.zoom,-1e7,1e7);camera.y=clamp(drag.camY-dy/camera.zoom,-1e7,1e7);}}hover=hitHouse(toWorld(pointer.x,pointer.y));canvas.style.cursor=placing?'crosshair':drag?.moved?'grabbing':hover?'pointer':'grab';}
// pointerUp 只有未拖动的释放才打开或放置房子，避免漫游被误认为点击。
function pointerUp(e){if(!drag||drag.id!==e.pointerId)return;const moved=drag.moved;drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(!moved){const p=eventPoint(e),world=toWorld(p.x,p.y);if(placing)placeHouse(world);else{const h=hitHouse(world);if(h)openHouse(h);else closePanels();}}}
// keyMove 只在画布拥有焦点时响应方向键；Escape 始终允许取消草稿或关闭面板。
function keyMove(e){if(e.key==='Escape'){cancelPlacement();closePanels();return;}if(e.target!==canvas)return;const step=80/camera.zoom;if(e.key==='ArrowLeft')camera.x-=step;else if(e.key==='ArrowRight')camera.x+=step;else if(e.key==='ArrowUp')camera.y-=step;else if(e.key==='ArrowDown')camera.y+=step;else if(e.key==='Home'){camera.x=0;camera.y=0;}else return;e.preventDefault();camera.x=clamp(camera.x,-1e7,1e7);camera.y=clamp(camera.y,-1e7,1e7);}
// 注册地址与房屋表单：回调负责阻止导航并调用相应有界操作。
$('addressForm').addEventListener('submit',e=>{e.preventDefault();enterDistrict($('address').value);});$('houseForm').addEventListener('submit',submitHouse);
// 书签使用同一地址入口，确保输入和快捷跳转共享规范化规则。
document.querySelectorAll('[data-address]').forEach(button=>{button.addEventListener('click',()=>{enterDistrict(button.dataset.address);});});
// 编辑、阅读和回家按钮只操作当前示意街区的数据。
$('build').addEventListener('click',startEditor);$('mobileBuild').addEventListener('click',startEditor);$('editHouse').addEventListener('click',startEditor);$('myHome').addEventListener('click',()=>{if(ownHouse)focusHouse(ownHouse);});$('visitNext').addEventListener('click',()=>{const i=houses.indexOf(selection);focusHouse(houses[(i+1)%houses.length]);});$('nearby').addEventListener('click',()=>{focusHouse(houses[(houses.indexOf(selection)+1)%houses.length]);});
// 面板关闭只改变显示状态，尚未保存的表单不会自动写入存储。
document.querySelectorAll('[data-close]').forEach(button=>{button.addEventListener('click',closePanels);});
// 缩放按钮围绕视窗中心操作，回家同时关闭面板并恢复初始比例。
$('zoomIn').addEventListener('click',()=>{zoomAt(1.2);});$('zoomOut').addEventListener('click',()=>{zoomAt(1/1.2);});$('home').addEventListener('click',()=>{camera.x=0;camera.y=0;camera.zoom=width<600?.62:.9;closePanels();});
// 演示邻居可隐藏，不把开关变化伪装成真实用户上线或离线。
$('ghostToggle').addEventListener('click',()=>{showGhosts=!showGhosts;$('ghostToggle').setAttribute('aria-pressed',String(showGhosts));$('ghostToggle').textContent=showGhosts?'隐藏演示指针':'显示演示指针';$('presenceNote').textContent=showGhosts?'2 位演示邻居 · 没有联网':'演示邻居已隐藏 · 没有联网';});
// 画布手势集中注册，cancel 清理捕获状态，离开时隐藏自己的演示光标。
canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',()=>{drag=null;});canvas.addEventListener('pointerleave',()=>{pointer.inside=false;});canvas.addEventListener('wheel',e=>{e.preventDefault();const p=eventPoint(e);zoomAt(Math.exp(-e.deltaY*.001),p.x,p.y);},{passive:false});document.addEventListener('keydown',keyMove);
// 尺寸观察器跟随容器变化；页面销毁时释放观察器与提示定时器。
const observer=new ResizeObserver(resize);observer.observe(stage);window.addEventListener('pagehide',()=>{observer.disconnect();clearTimeout(toastTimer);});
resize();let initial='夜航';try{initial=decodeURIComponent(location.hash.slice(1))||initial;}catch{}enterDistrict(initial);requestAnimationFrame(draw);

