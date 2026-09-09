import fs from 'node:fs';

// 在已获用户认可的独立视觉稿上生成互动分支，保留原稿和正式前端；替换失配立即失败。
let html = fs.readFileSync('outputs/pulse-tidal-islands.html', 'utf8');
function replaceOnce(before, after) {
  if (!html.includes(before)) throw new Error('Missing anchor: ' + before.slice(0, 90));
  html = html.replace(before, after);
}
replaceOnce('x:-1060,y:-640', 'x:-3100,y:-1500');
replaceOnce('x:1030,y:-490', 'x:3050,y:-1300');
replaceOnce("'pulse-tidal-'+key", "'pulse-garden-'+key");
replaceOnce("'pulse-tidal-'+key", "'pulse-garden-'+key");
replaceOnce('全部几何与文章为本文件自制示例，没有网络请求、真实访客或持久化文章服务。', '全部几何为原创示例；互动层可连接配套的本地服务，同步真实窗口指针并保存植物状态。');
replaceOnce('const camera={x:0,y:-60,d:1150}', 'const camera={x:0,y:15,d:850}');
replaceOnce('function drawBook(s,b,index,alpha){', 'function drawBook(s,b,index,alpha){return;');
replaceOnce('function pickBook(x,y){', 'function pickBook(x,y){return -1;');
replaceOnce('const close=1-smooth(610,1050,camera.d);if(index===selected)', 'const close=0;if(false)');
replaceOnce('function drawIsland(s,index){const center=', 'function drawIsland(s,index){if(index!==selected && Math.hypot(s.x-camera.x,s.y-camera.y)>camera.d*1.8)return;const center=');
replaceOnce('function pickIsland(x,y){let found=', 'function pickIsland(x,y){let found=');
replaceOnce('const s=islands[i],p=project(s.x,s.y,25);', 'const s=islands[i];if(i!==selected && Math.hypot(s.x-camera.x,s.y-camera.y)>camera.d*1.8)continue;const p=project(s.x,s.y,25);');
replaceOnce('drawAir(time);lastSea=now;', 'drawAir(time);drawGarden(now);lastSea=now;');
replaceOnce('dirty=false;}if(moving||', 'dirty=false;}positionGarden();if(moving||');
replaceOnce('updateMode(true);if($(\'reader\').open)', 'updateMode(true);if(gardenReady)gardenText();if($(\'reader\').open)');
replaceOnce("nearbyButtons[i].classList.toggle('current',i===selected);}", "nearbyButtons[i].classList.toggle('current',i===selected);if(gardenReady)gardenActionText();}");
replaceOnce("lang=lang==='zh'?'en':'zh';remember('lang',lang);updateText();", "lang=lang==='zh'?'en':'zh';remember('lang',lang);$('toast').textContent='';$('toast').classList.remove('visible');updateText();");
replaceOnce('if(!dragMoved&&!cancelled){const b=', 'if(!dragMoved&&!cancelled){if(pickPlant(e.clientX,e.clientY)){waterPlant();down=null;return;}const b=');
replaceOnce("const next=pickBook(e.clientX,e.clientY);", "const next=pickBook(e.clientX,e.clientY);gardenHover=pickPlant(e.clientX,e.clientY);lastSea=0;");
replaceOnce("land.style.cursor=next>=0||", "land.style.cursor=gardenHover||next>=0||");
replaceOnce('function approachIsland(index){selected=index;', 'function approachIsland(index){selected=index;if(gardenReady)gardenText();');
replaceOnce('target.d=W<580?390:455;', 'target.d=W<580?540:570;');
replaceOnce('camera.d=target.d=850', 'camera.d=target.d=780');
replaceOnce('float wave=sin(p.x*.009+p.y*.019+sin(p.x*.002)*2.2-time*.55);float crest=pow(max(0.,wave),5.);\n float h=sin(p.x*.011+p.y*.008-time*.55)*7.+sin(p.y*.019-p.x*.004-time*.4)*4.;', `float a=p.x*.012+p.y*.008-time*.62;
 float b=p.y*.022-p.x*.006-time*.43;
 float nearDetail=1.-smoothstep(420.,1100.,cam.z);
 float h=sin(a)*19.+sin(b)*8.+sin(p.x*.056+p.y*.034-time*1.05)*2.8*nearDetail;
 float crest=pow(max(0.,(sin(a)*.7+sin(b)*.3)),3.);`);
replaceOnce('(.10+crest*.55+n*.065)', '(.065+crest*.38+n*.045)');
replaceOnce('function seaHeight(x,y,t){return Math.sin(x*.011+y*.008-t*.55)*7+Math.sin(y*.019-x*.004-t*.4)*4;}', 'function seaHeight(x,y,t){return Math.sin(x*.012+y*.008-t*.62)*19+Math.sin(y*.022-x*.006-t*.43)*8+Math.sin(x*.056+y*.034-t*1.05)*2.8*(1-smooth(420,1100,camera.d));}');
replaceOnce('const wave=Math.sin(x*.010+y*.018-t*.65+Math.sin(x*.003)*1.8),crest=Math.pow(Math.max(0,wave),6)', 'const wave=Math.sin(x*.012+y*.008-t*.62)*.7+Math.sin(y*.022-x*.006-t*.43)*.3,crest=Math.pow(Math.max(0,wave),3)');
replaceOnce('(.12+crest*.60+n*.055)', '(.065+crest*.38+n*.045)');
replaceOnce('</style>', fs.readFileSync('work/garden-demo.css', 'utf8') + '\n</style>');
replaceOnce('<div id="toast" role="status"></div>', `<div id="toast" role="status" aria-live="polite"></div>
<div id="plant-target"><button id="plant-hit" aria-label="为植物浇水"></button><span id="plant-caption"></span></div>
<section id="care-panel" aria-label="照料植物"><p id="care-note" aria-live="polite"></p><div class="care-actions"><button id="water"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C10 7 5 11 5 15a7 7 0 0 0 14 0c0-4-5-8-7-12Z"/></svg><span id="water-label"></span></button><a id="visit" href="/?visitor=1" target="_blank" rel="noopener"></a></div><p id="care-detail"></p></section>
<p id="presence" role="status"></p><p id="trace"></p>`);
replaceOnce('// 启动时读取本原型自己的偏好键', fs.readFileSync('work/garden-interaction.js', 'utf8') + '\n// 启动时读取本原型自己的偏好键');
replaceOnce('updateText();wake();\n</script>', 'updateText();startGarden();wake();\n</script>');
fs.writeFileSync('outputs/pulse-tidal-garden.html', html);
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
fs.writeFileSync('work/garden-inline-check.js', script);
console.log('Built outputs/pulse-tidal-garden.html (' + Buffer.byteLength(html) + ' bytes)');
