
'use strict';
/* 2026-09-09 独立原创视觉稿。参考 yamiblog.me 的轻界面；
   空间留白参考 Townscaper / Dorfromantik，点阵水面参考 Three.js points waves。
   全部几何与文章为本文件自制示例，没有网络请求、真实访客或持久化文章服务。 */
// 按本文件固定 ID 取元素，避免重复书写 DOM 查询。
const $ = document.getElementById.bind(document);
const TAU=Math.PI*2, reduced=matchMedia('(prefers-reduced-motion: reduce)'), systemTheme=matchMedia('(prefers-color-scheme: dark)');
const sea=$('sea'), land=$('land'), air=$('air'), gl=sea.getContext('webgl',{alpha:false,antialias:false,powerPreference:'low-power'}),sc=gl?null:sea.getContext('2d'),lc=land.getContext('2d'),ac=air.getContext('2d');
let waterProgram=null,waterUniforms=null,waterCount=0,waterBuffer=null;
const palette={dark:{bg:'#091c20',sea:[85,139,145],foam:[158,204,195],shore:[208,194,153],land:[125,166,151],contour:[112,171,154],solid:'#102b2c',paper:'#cbd9bd',ink:'#385c52',gold:'#e7c68f',shadow:'#031317'},light:{bg:'#e5eee8',sea:[71,125,125],foam:[99,145,131],shore:[120,105,67],land:[78,129,106],contour:[54,110,93],solid:'#d1e0cc',paper:'#faf5df',ink:'#527359',gold:'#816039',shadow:'#adccc1'}};
const copy={zh:{edition:'潮汐之间',eyebrow:'海上手记',headline:'潮汐之间',description:'让岛屿相隔远一点，\n让一个念头，有停留的地方。',approach:'走近我的岛',back:'回到海上',nearby:'海的另一边',help:'玩法',offline:'离线预览',fixture:'独立概念稿 · 示例文章',hint:'拖动漫游 · 滚轮靠近 · 点击岛屿',nearHint:'点开一页文字 · 向后滚动回到海上',home:'归处',auto:'跟随系统',dark:'深色',light:'浅色',nearDesc:'潮声很轻。这里有三篇短文，\n选一篇，停留一会儿。',articles:'三篇短文',read:'打开阅读 ↗',sample:'示例短文',minutes:'分钟',next:'下一篇',end:'写在这里，也留在这里。',aboutTitle:'在潮汐之间漫游',about:'<p>拖动海面探索，滚轮或双指缩放。点一座岛，镜头会连续下降；靠近后，点书页或标题阅读。</p><p>方向键可移动，＋ / − 可缩放，Esc 返回远景。右上角可切换明暗与语言；语言切换仅演示界面和本地双语示例。</p><p>这是离线视觉稿。岛屿与文章均为示例，没有连接多人服务。减少动态的系统设置会暂停海浪并关闭镜头缓动。</p><p>设计参考：<a href="https://yamiblog.me/" target="_blank" rel="noreferrer">PULSE 原站</a> · <a href="https://www.townscapergame.com/" target="_blank" rel="noreferrer">Townscaper</a> · <a href="https://www.toukana.com/dorfromantik" target="_blank" rel="noreferrer">Dorfromantik</a> · <a href="https://threejs.org/examples/webgl_points_waves.html" target="_blank" rel="noreferrer">粒子波浪</a></p>',names:['你的原点','雨后手记','远山来信'],title:['把一段时间放在这里','潮水退去之后','有些相遇，不需要说话'],tags:['随笔','观察','生活'],body:[['今天没有发生什么值得郑重记录的大事。窗外下了一会儿雨，杯子里的茶凉了，读到一段喜欢的话，又翻回去看了一遍。','但我还是想把这段时间放在这里。像在海边捡到一块形状普通的石头，因为当时握在手里的温度，决定带它回家。','也许很多年以后，留下来的并不是某个答案，而是一个很轻的下午。'],['潮水退去以后，岸边的纹路才慢慢显出来。细沙上有蜿蜒的线，浅水里留下小小的涡流。原来平静的表面，也记得经过它的东西。','我想做一个这样的地方。远看安静，走近了，能发现有人在这里停留过。','文章可以短一点，更新可以慢一点。重要的是，那些真正想留下的东西，能有自己的位置。'],['有时候，只是知道有人也在，就很好。','不一定要立刻打招呼。你沿着岸线走，我在这边读一页书。光标从旁边经过，像一阵有方向的风。','等想说话的时候，再说也来得及。这个地方很大，我们可以慢慢认识。']]},en:{edition:'BETWEEN TIDES',eyebrow:'NOTES AT SEA',headline:'Between tides',description:'A little more space between islands.\nA place for a thought to stay.',approach:'Approach my island',back:'Back to the sea',nearby:'ACROSS THE WATER',help:'Guide',offline:'Offline preview',fixture:'Concept study · Sample stories',hint:'Drag to wander · Scroll to approach · Select an island',nearHint:'Open a story · Scroll back to the sea',home:'Home',auto:'System',dark:'Dark',light:'Light',nearDesc:'The tide is quiet here.\nChoose a story. Stay a little.',articles:'Three stories',read:'Read story ↗',sample:'Sample story',minutes:'min',next:'Next story',end:'A little of this day, kept here.',aboutTitle:'Wander between tides',about:'<p>Drag to explore. Scroll or pinch to move closer. Select an island for a continuous descent, then open a page to read.</p><p>Arrow keys move, + / − zoom, and Escape returns to the sea. Theme and language controls are above. The system reduced-motion setting pauses waves and camera easing.</p><p>This is an offline visual study. Islands and bilingual stories are samples. No multiplayer connection is simulated.</p><p>References: <a href="https://yamiblog.me/" target="_blank" rel="noreferrer">PULSE</a> · <a href="https://www.townscapergame.com/" target="_blank" rel="noreferrer">Townscaper</a> · <a href="https://www.toukana.com/dorfromantik" target="_blank" rel="noreferrer">Dorfromantik</a> · <a href="https://threejs.org/examples/webgl_points_waves.html" target="_blank" rel="noreferrer">Particle waves</a></p>',names:['Your origin','After the rain','Letters from afar'],title:['Keeping a little of today','After the tide','Some encounters need no words'],tags:['NOTES','OBSERVATIONS','LIFE'],body:[['Nothing remarkable happened today. Rain brushed the window, my tea cooled, and I turned back to read a sentence I liked.','Still, I wanted to keep this small piece of time. Like an ordinary stone found on the shore, worth taking home for the warmth it held in your hand.','Perhaps, years from now, what remains will not be an answer. Just a quiet afternoon.'],['When the tide withdrew, the patterns of the shore appeared. Wandering lines in the sand. Small eddies in the shallows. Even a quiet surface remembers what has passed over it.','I wanted to make a place like that. Calm from a distance, full of traces when you come closer.','The stories can be short. The updates can be slow. What matters is a place for the things we choose to keep.'],['Sometimes, simply knowing someone else is here is enough.','We do not need to say hello at once. You follow the shoreline while I read a page. A cursor drifts past, like a breeze with a direction.','We can talk when we feel like it. There is plenty of room here. We have time.']]}};
let W=innerWidth,H=innerHeight,F=H,theme='auto',lang='zh',P=palette.dark,raf=0,last=0,lastSea=0,time=0,dirty=true,paintCount=0,currentArticle=0,nearState=false,toastTimer;
const camera={x:0,y:-60,d:1150},target={...camera},gesture=new Map();
let zoomAnchor=null,flight=false,dragMoved=false,down=null,hover=-1,selected=0;
const islands=[{x:0,y:0,r:242,sy:.74,rot:-.35,seed:4},{x:-1060,y:-640,r:181,sy:.70,rot:.4,seed:12},{x:1030,y:-490,r:212,sy:.76,rot:-.7,seed:21}];
const books=[{x:-95,y:-25,z:22,angle:-.28,w:27,h:36},{x:-15,y:88,z:30,angle:.15,w:27,h:36},{x:95,y:-55,z:38,angle:-.12,w:27,h:36}];
const islandLabels=[],articleLabels=[],mobileButtons=[],nearbyButtons=[],hits=[];
const stats={landPaints:0,seaMs:0,landMs:0,seaPoints:0};
// clamp 限制视觉参数；不修改输入。
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
// smooth 在区间内生成无突变的细节渐显权重。
function smooth(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
// hash 由整数坐标确定粒子分布，缩放或返回时不会重新随机。
function hash(x,y,s=0){let n=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(s|0,1442695041);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
// rgba 根据当前主题生成带透明度的绘制颜色。
function rgba(rgb,a){return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(a,0,1)})`;}
// remember 对 file:// 下可能不可用的本地存储进行降级，不阻断体验。
function remember(key,value){try{if(value===undefined)return localStorage.getItem('pulse-tidal-'+key);localStorage.setItem('pulse-tidal-'+key,value);}catch{}return null;}
// boundary 定义柔和的不规则岸线；角度以弧度计，返回半径倍率。
function boundary(a,s){return 1+.11*Math.sin(3*a+s)+.065*Math.cos(5*a-s*.3)+.04*Math.sin(2*a+s);}
// localWorld 将岛的局部坐标变为稳定世界坐标，高度独立于相机。
function localWorld(s,x,y,z){const c=Math.cos(s.rot),sn=Math.sin(s.rot);return{x:s.x+x*c-y*sn,y:s.y+x*sn+y*c,z};}
// terrainHeight 返回岛面高度；岸边接近海面，内侧起伏连续。
function terrainHeight(s,x,y){const a=Math.atan2(y/s.sy,x),r=Math.hypot(x,y/s.sy)/(s.r*boundary(a,s.seed));return 5+57*Math.pow(Math.max(0,1-r*r),1.6)+20*Math.exp(-((x+55)**2/8500+(y+40)**2/3300));}
// project 使用同一透视映射绘制海水、陆地、书页；高度会改变大小与位置。
function project(x,y,z=0){const dx=x-camera.x,dy=y-camera.y,curve=(dx*dx+dy*dy)/13500,h=z-curve,tilt=.36+.38*(1-smooth(460,1150,camera.d)),si=Math.sin(tilt),co=Math.cos(tilt),d=camera.d-dy*si-h*co;if(d<45)return null;const scale=F/d;return{x:W*.57+dx*scale,y:H*.55+(dy*co-h*si)*scale,s:scale,d};}
// unprojectSea 通过局部数值迭代反解海平面；用于鼠标锚定和拖动，失败时保留有限值。
function unprojectSea(sx,sy){let x=camera.x+(sx-W*.57)*camera.d/F,y=camera.y+(sy-H*.55)*camera.d/F;for(let i=0;i<7;i++){const p=project(x,y),px=project(x+1,y),py=project(x,y+1);if(!p||!px||!py)break;const ex=sx-p.x,ey=sy-p.y,a=px.x-p.x,b=py.x-p.x,c=px.y-p.y,d=py.y-p.y,det=a*d-b*c;if(Math.abs(det)<.00001)break;x+=clamp((ex*d-ey*b)/det,-2000,2000);y+=clamp((ey*a-ex*c)/det,-2000,2000);}return{x,y};}
// pointAt 投影岛内位置，让命中和绘制共享同一套坐标。
function pointAt(s,x,y,z){const p=localWorld(s,x,y,z);return project(p.x,p.y,p.z);}
// landPoint 把岸线参数转成岛面三维坐标。
function landPoint(s,a,r){const radius=s.r*boundary(a,s.seed)*r,x=Math.cos(a)*radius,y=Math.sin(a)*radius*s.sy;return localWorld(s,x,y,terrainHeight(s,x,y));}
// buildIsland 只在初始化时生成细粒与轮廓；返回的缓存不会随缩放重建。
function buildIsland(s){const points=[],rings=[];for(let y=-s.r;y<s.r;y+=3.7){for(let x=-s.r*1.25;x<s.r*1.25;x+=3.7){const a=Math.atan2(y/s.sy,x),r=Math.hypot(x,y/s.sy)/(s.r*boundary(a,s.seed));if(r>1.13)continue;const n=hash(Math.round(x*10),Math.round(y*10),s.seed);if(r>1&&n>(1.13-r)*5)continue;const px=x+(n-.5)*3,py=y+(hash(x*10,y*10,33)-.5)*3,z=terrainHeight(s,px,py);points.push({...localWorld(s,px,py,z),r,n});}}for(let j=1;j<=23;j++){const r=j/23,ring=[];for(let k=0;k<=144;k++)ring.push(landPoint(s,k/144*TAU,r));rings.push(ring);}s.points=points;s.rings=rings;}
// 初始化粒子缓存与可键盘访问的岛屿入口；点击沿当前镜头出发。
for(let i=0;i<islands.length;i++){const s=islands[i];buildIsland(s);const b=document.createElement('button');b.className='island-label';b.innerHTML='<span class="name"></span><span class="sub"></span>';
 // 选岛只改变本地镜头目标，不访问外部服务。
 b.addEventListener('click',()=>approachIsland(i));$('labels').append(b);islandLabels.push(b);const n=document.createElement('button');n.innerHTML='<span></span><span class="small-arrow">↗</span>';
 // 附近列表是画布入口的等价键盘路径。
 n.addEventListener('click',()=>approachIsland(i));$('nearby').append(n);nearbyButtons.push(n);}
// 为三篇本地示例创建清晰的 DOM 标题与手机备用入口。
for(let i=0;i<books.length;i++){const b=document.createElement('button');b.className='article-label';b.innerHTML='<span class="meta"></span><span class="name"></span><span class="more"></span>';
 // 标题打开对应索引的文章，避免用亮点模糊猜测命中。
 b.addEventListener('click',()=>openArticle(i));$('labels').append(b);articleLabels.push(b);const m=document.createElement('button');
 // 窄屏可通过底部短标题打开完整阅读。
 m.addEventListener('click',()=>openArticle(i));$('mobile-articles').append(m);mobileButtons.push(m);}
// setTheme 应用主题并记忆用户选择；海浪与岛屿颜色同步更新。
function setTheme(mode){theme=mode;const actual=mode==='auto'?(systemTheme.matches?'dark':'light'):mode;document.documentElement.dataset.theme=actual;P=palette[actual];remember('theme',mode);$('theme').textContent=copy[lang][mode];dirty=true;lastSea=0;wake();}
// updateText 只更新界面及本地双语样例，不声称翻译用户文章。
function updateText(){const c=copy[lang];document.documentElement.lang=lang==='zh'?'zh-CN':'en';document.title='PULSE · '+c.edition;for(const [id,key] of [['edition','edition'],['eyebrow','eyebrow'],['nearby-title','nearby'],['help','help'],['offline','offline'],['fixture','fixture'],['home','home'],['about-title','aboutTitle']])$(id).textContent=c[key];$('about-copy').innerHTML=c.about;$('language').textContent=lang==='zh'?'EN':'中文';$('theme').textContent=c[theme];$('minus').ariaLabel=lang==='zh'?'拉远':'Zoom out';$('plus').ariaLabel=lang==='zh'?'靠近':'Zoom in';$('close-reader').ariaLabel=lang==='zh'?'关闭阅读':'Close reading';$('close-about').ariaLabel=lang==='zh'?'关闭':'Close';land.ariaLabel=lang==='zh'?'粒子群岛；拖动探索、滚轮靠近，亦可用附近岛屿按钮。':'Particle islands. Drag to explore, scroll to approach, or use the island buttons.';for(let i=0;i<3;i++){islandLabels[i].querySelector('.name').textContent=c.names[i];islandLabels[i].querySelector('.sub').textContent=c.articles;nearbyButtons[i].firstElementChild.textContent=c.names[i];articleLabels[i].querySelector('.meta').textContent=c.tags[i]+' · 2 '+c.minutes;articleLabels[i].querySelector('.name').textContent=c.title[i];articleLabels[i].querySelector('.more').textContent=c.read;mobileButtons[i].textContent=c.title[i];}updateMode(true);if($('reader').open)fillArticle();dirty=true;wake();}
// updateMode 在连续距离上切换辅助文字；不替换场景或改变拖动语义。
function updateMode(force=false){const next=camera.d<680;if(next===nearState&&!force)return;nearState=next;document.body.classList.toggle('near',next);const c=copy[lang];$('headline').textContent=next?c.names[selected]:c.headline;$('description').innerText=next?c.nearDesc:c.description;$('approach-text').textContent=next?c.back:c.approach;$('hint').textContent=next?c.nearHint:c.hint;for(let i=0;i<3;i++)nearbyButtons[i].classList.toggle('current',i===selected);}
// resize 让视口和像素密度匹配；缩放相机保持世界位置不变。
function resize(){W=innerWidth;H=innerHeight;F=Math.min(H*1.10,W*1.3);const dpr=Math.min(devicePixelRatio||1,1.7);for(const [can,ctx] of [[sea,sc],[land,lc],[air,ac]]){can.width=Math.round(W*dpr);can.height=Math.round(H*dpr);if(ctx)ctx.setTransform(dpr,0,0,dpr,0,0);}if(gl){gl.viewport(0,0,sea.width,sea.height);initWater();}dirty=true;lastSea=0;wake();}
// shader 编译本文件内的着色器；编译失败立即报告，而不是继续使用无效程序。
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
// initWater 将海面粒子交给 GPU，避免密集海浪在 CPU 上逐点重绘；不加载任何外部库。
function initWater(){if(waterProgram){gl.deleteProgram(waterProgram);gl.deleteBuffer(waterBuffer);}const vs=shader(gl.VERTEX_SHADER,`
 attribute vec2 grid;uniform vec2 origin;uniform vec3 cam;uniform vec2 viewport;uniform vec3 waterColor;uniform vec3 foamColor;uniform float stepSize,detail,time,focal,dpr,tilt;varying vec4 color;
 void main(){vec2 ij=grid+origin;vec2 p=ij*stepSize;float n=fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);p+=(n-.5)*1.6;
 float wave=sin(p.x*.009+p.y*.019+sin(p.x*.002)*2.2-time*.55);float crest=pow(max(0.,wave),5.);
 float h=sin(p.x*.011+p.y*.008-time*.55)*7.+sin(p.y*.019-p.x*.004-time*.4)*4.;vec2 rel=p-cam.xy;h-=dot(rel,rel)/13500.;float dep=cam.z-rel.y*sin(tilt)-h*cos(tilt);float scale=focal/max(dep,45.);
 vec2 screen=vec2(viewport.x*.57,viewport.y*.55)+vec2(rel.x,rel.y*cos(tilt)-h*sin(tilt))*scale;
 gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0.,1.);gl_PointSize=clamp(scale*(1.2+crest*.8),.8,2.6)*dpr;
 float fine=step(.5,mod(abs(ij.x),2.)+mod(abs(ij.y),2.));float opacity=mix(1.,detail,fine)*(.10+crest*.55+n*.065)*clamp(cam.z/dep,.12,1.25);if(dep<45.)opacity=0.;
 color=vec4(mix(waterColor,foamColor,crest*.8),opacity);}
 `);const fs=shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec4 color;void main(){float r=length(gl_PointCoord-.5);gl_FragColor=vec4(color.rgb,color.a*(1.-smoothstep(.20,.5,r)));}`);waterProgram=gl.createProgram();gl.attachShader(waterProgram,vs);gl.attachShader(waterProgram,fs);gl.linkProgram(waterProgram);if(!gl.getProgramParameter(waterProgram,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(waterProgram));gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(waterProgram);const coords=[],nx=Math.min(460,Math.ceil(Math.max(W/H,1)*205)),ny=300;for(let y=-ny;y<=ny;y++)for(let x=-nx;x<=nx;x++)coords.push(x,y);waterCount=coords.length/2;waterBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,waterBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(coords),gl.STATIC_DRAW);const attr=gl.getAttribLocation(waterProgram,'grid');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);waterUniforms={};for(const name of ['origin','cam','viewport','waterColor','foamColor','stepSize','detail','time','focal','dpr','tilt'])waterUniforms[name]=gl.getUniformLocation(waterProgram,name);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);}
// drawWaterGPU 使用稳定的嵌套网格渐显细节，镜头穿越倍率边界时不会整片换点。
function drawWaterGPU(t){const start=performance.now();if(!waterProgram||gl.isContextLost())return;const u=waterUniforms,coarse=8*2**Math.ceil(Math.log2(camera.d/700)),step=coarse/2,upper=700*coarse/8,detail=1-smooth(upper/2,upper,camera.d),bg=P.bg.match(/\w\w/g);gl.clearColor(parseInt(bg[0],16)/255,parseInt(bg[1],16)/255,parseInt(bg[2],16)/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(waterProgram);gl.uniform2f(u.origin,Math.floor(camera.x/step/16)*16,Math.floor(camera.y/step/16)*16);gl.uniform3f(u.cam,camera.x,camera.y,camera.d);gl.uniform2f(u.viewport,W,H);gl.uniform3f(u.waterColor,...P.sea.map(v=>v/255));gl.uniform3f(u.foamColor,...P.foam.map(v=>v/255));gl.uniform1f(u.stepSize,step);gl.uniform1f(u.detail,detail);gl.uniform1f(u.time,t);gl.uniform1f(u.focal,F);gl.uniform1f(u.dpr,sea.width/W);gl.uniform1f(u.tilt,.36+.38*(1-smooth(460,1150,camera.d)));gl.drawArrays(gl.POINTS,0,waterCount);stats.seaMs=performance.now()-start;stats.seaPoints=waterCount;land.dataset.waterMs=stats.seaMs.toFixed(2);land.dataset.waterPoints=waterCount;land.dataset.waterRenderer='webgl';}
// drawLine 绘制共享世界坐标的线条；近裁剪以断线处理，避免跨屏尖刺。
function drawLine(ctx,points,color,width=1,closed=false){ctx.beginPath();let open=false;for(const p of points){const q=project(p.x,p.y,p.z);if(!q){open=false;continue;}if(!open){ctx.moveTo(q.x,q.y);open=true;}else ctx.lineTo(q.x,q.y);}if(closed)ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
// polygon 以实际透视顶点绘制面，用于岛的轻底色和书页，不做屏幕贴图缩放。
function polygon(ctx,points,fill,stroke,width=.7){const q=[];for(const p of points){const v=project(p.x,p.y,p.z);if(!v)return;q.push(v);}ctx.beginPath();q.forEach((p,i)=>{if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();}return q;}
// seaHeight 返回数个不同方向、波长的叠加波；单位是世界高度。
function seaHeight(x,y,t){return Math.sin(x*.011+y*.008-t*.55)*7+Math.sin(y*.019-x*.004-t*.4)*4;}
// drawSea 海水使用稳定网格与轻微扰动；点的高度和亮度随波峰推进，不随机闪烁。
function drawSea(t){if(gl){drawWaterGPU(t);return;}const start=performance.now();sc.fillStyle=P.bg;sc.fillRect(0,0,W,H);const b=sc.createRadialGradient(W*.59,H*.45,0,W*.56,H*.52,Math.max(W,H)*.75);b.addColorStop(0,rgba(P.sea,.11));b.addColorStop(1,rgba(P.sea,0));sc.fillStyle=b;sc.fillRect(0,0,W,H);const extent=Math.min(3900,camera.d*2.5);let count=0;
 // 新增网格只填入旧网格的空隙并渐显；粒子在倍率边界保持位置连续。
 for(let level=0;level<3;level++){const step=38/2**level,detail=level===0?1:level===1?1-smooth(650,1150,camera.d):1-smooth(310,680,camera.d);if(detail<.005)continue;const unit=4/2**level,x0=Math.floor((camera.x-extent)/step),x1=Math.ceil((camera.x+extent)/step),y0=Math.floor((camera.y-extent)/step),y1=Math.ceil((camera.y+extent)/step);
 for(let iy=y0;iy<=y1;iy++){for(let ix=x0;ix<=x1;ix++){if(level>0&&ix%2===0&&iy%2===0)continue;const n=hash(ix*unit,iy*unit,19),x=ix*step+(n-.5)*3,y=iy*step+(hash(ix*unit,iy*unit,7)-.5)*3,z=seaHeight(x,y,t),p=project(x,y,z);if(!p||p.x<0||p.x>W||p.y<0||p.y>H)continue;const wave=Math.sin(x*.010+y*.018-t*.65+Math.sin(x*.003)*1.8),crest=Math.pow(Math.max(0,wave),6),fog=clamp(camera.d/p.d,.12,1.2),a=(.12+crest*.60+n*.055)*fog*detail;sc.fillStyle=rgba(crest>.45?P.foam:P.sea,a);const size=clamp(p.s*(1.05+crest*.9),.7,2.25);sc.fillRect(p.x,p.y,size,size);count++;}}}
 // 少量长波线把离散粒子组织为水面；远近共用同一波场坐标。
 for(let row=-12;row<=12;row++){const base=Math.floor(camera.y/150)*150+row*150;sc.beginPath();let open=false;for(let j=-65;j<=65;j++){const x=camera.x+j*extent/65,y=base+Math.sin(x*.004+t*.22+row)*34,z=seaHeight(x,y,t),p=project(x,y,z);if(!p){open=false;continue;}if(!open){sc.moveTo(p.x,p.y);open=true;}else sc.lineTo(p.x,p.y);}sc.strokeStyle=rgba(P.sea,.09);sc.lineWidth=.65;sc.stroke();}
 stats.seaPoints=count;stats.seaMs=performance.now()-start;land.dataset.waterMs=stats.seaMs.toFixed(2);land.dataset.waterPoints=count;}
// bookWorld 返回书页局部顶点；书页有轻微角度及离地高度。
function bookWorld(s,b,x,y,z=0){const c=Math.cos(b.angle),sn=Math.sin(b.angle);return localWorld(s,b.x+x*c-y*sn,b.y+x*sn+y*c,terrainHeight(s,b.x,b.y)+b.z+z);}
// drawBook 绘制纸张厚度、折角、排版线及其接地影子；同时登记四边形命中。
function drawBook(s,b,index,alpha){if(alpha<.01)return;lc.save();lc.globalAlpha=alpha;const w=b.w/2,h=b.h/2,corners=[[-w,-h],[w,-h],[w,h],[-w,h]],pts=[],back=[],shadow=[];for(const [x,y]of corners){pts.push(bookWorld(s,b,x,y));back.push(bookWorld(s,b,x+1.6,y+2.6,-2.4));const p=bookWorld(s,b,x+8,y+12);p.z=terrainHeight(s,b.x,b.y)+1;shadow.push(p);}lc.globalAlpha=alpha*.34;polygon(lc,shadow,P.shadow);lc.globalAlpha=alpha;polygon(lc,back,rgba(P.land,.55),rgba(P.foam,.26));const quad=polygon(lc,pts,P.paper,rgba(P.foam,.8));if(quad)hits.push({index,points:quad});const fold=[bookWorld(s,b,w-7,-h),bookWorld(s,b,w,-h+7),bookWorld(s,b,w-7,-h+7)];polygon(lc,fold,rgba(P.land,.42));drawLine(lc,[bookWorld(s,b,-w+5,-h+8,.1),bookWorld(s,b,-w+13,-h+8,.1)],P.gold,1.5);for(let j=0;j<5;j++){const len=j===4?9:16;drawLine(lc,[bookWorld(s,b,-w+5,-h+14+j*3,.1),bookWorld(s,b,-w+5+len,-h+14+j*3,.1)],P.ink,.65);}lc.restore();}
// drawIsland 先绘制海拔轮廓，再叠加固定的粒子地形；近景才增加文章细节。
function drawIsland(s,index){const center=project(s.x,s.y,28);if(!center||center.x<-s.r*center.s-100||center.x>W+s.r*center.s+100||center.y<-s.r*center.s-100||center.y>H+s.r*center.s+100)return;const alpha=clamp(center.s*.9,.15,1);lc.save();const outer=s.rings[s.rings.length-1];polygon(lc,outer,P.solid);
 for(let i=0;i<s.rings.length;i++){const a=i/s.rings.length;drawLine(lc,s.rings[i],rgba(a>.87?P.shore:P.contour,(a>.87?.43:.15)*alpha),a>.95?1:.6,true);}
 for(let i=0;i<s.points.length;i++){const pt=s.points[i];const lod=i%3===0?1:smooth(.22,.58,center.s);if(lod<.01)continue;const p=project(pt.x,pt.y,pt.z);if(!p||p.x<-3||p.x>W+3||p.y<-3||p.y>H+3)continue;const coast=pt.r>.87,light=.22+pt.n*.42+(pt.z/80)*.2,size=clamp((coast?.95:.75)*p.s,.6,2.2);lc.fillStyle=rgba(coast?P.shore:P.land,light*alpha*lod*(pt.r>1?.45:1));lc.fillRect(p.x,p.y,size,size);}
 // 近处的三条点状路径把文章与岸线连接，路径本身保持克制。
 const close=1-smooth(610,1050,camera.d);if(index===selected){for(let i=0;i<books.length;i++){const b=books[i];for(let k=0;k<34;k++){const q=k/33,x=b.x+(Math.sin(q*Math.PI)*26)*(i-1),y=b.y+q*78,z=terrainHeight(s,x,y)+2,p=pointAt(s,x,y,z);if(!p)continue;lc.fillStyle=rgba(P.shore,.18*close);lc.fillRect(p.x,p.y,clamp(p.s*.65,.6,1.4),clamp(p.s*.65,.6,1.4));}drawBook(s,b,i,.45+.55*close);}}
 lc.restore();}
// drawLand 静态地形只在镜头、语言或主题变化时重绘；波浪另层运行。
function drawLand(){const start=performance.now();lc.clearRect(0,0,W,H);hits.length=0;const order=[0,1,2];
 // 以相机深度从远到近绘制，使岛屿遮挡顺序稳定。
 order.sort((a,b)=>(project(islands[b].x,islands[b].y)?.d||0)-(project(islands[a].x,islands[a].y)?.d||0));for(const i of order)drawIsland(islands[i],i);stats.landPaints=++paintCount;stats.landMs=performance.now()-start;}
// drawAir 绘制贴岸的进退浪沫及少量高处漂尘；不在每个粒子上使用模糊滤镜。
function drawAir(t){ac.clearRect(0,0,W,H);for(let i=0;i<islands.length;i++){const s=islands[i],c=project(s.x,s.y);if(!c)continue;const visible=clamp(c.s,.1,1);for(let ring=0;ring<3;ring++){const phase=(t*.055+ring/3)%1,r=1.02+(1-phase)*.37,a=Math.sin(phase*Math.PI)*.30*visible;for(let j=0;j<210;j++){const ang=j/210*TAU,n=hash(j,ring,s.seed),radius=s.r*boundary(ang,s.seed)*r,p=localWorld(s,Math.cos(ang)*radius,Math.sin(ang)*radius*s.sy,seaHeight(s.x+radius*Math.cos(ang),s.y+radius*Math.sin(ang),t)),q=project(p.x,p.y,p.z);if(!q||q.x<-3||q.x>W+3||q.y<-3||q.y>H+3)continue;ac.fillStyle=rgba(P.foam,a*(.45+n*.55));const size=clamp(q.s*(.5+n*.5),.5,2);ac.fillRect(q.x,q.y,size,size);}}
 // 漂尘与岛共享世界位置；高度不同，自然产生快慢不同的靠近效果。
 for(let j=0;j<32;j++){const n=hash(j,7,s.seed),ang=n*TAU,r=s.r*(.6+hash(j,2,s.seed)*.65),x=Math.cos(ang)*r,y=Math.sin(ang)*r*s.sy,z=55+hash(j,6,s.seed)*95+Math.sin(t*.4+j)*4,p=pointAt(s,x,y,z);if(!p||p.x<0||p.x>W||p.y<0||p.y>H)continue;ac.fillStyle=rgba(P.shore,(.08+.12*n)*visible);ac.beginPath();ac.arc(p.x,p.y,clamp(p.s*(.5+n*.7),.5,2.3),0,TAU);ac.fill();}}
 if(hover>=0){const s=islands[selected],b=books[hover],p=pointAt(s,b.x,b.y,terrainHeight(s,b.x,b.y)+b.z);if(p){ac.strokeStyle=rgba(P.shore,.5);ac.lineWidth=.7;ac.beginPath();ac.ellipse(p.x,p.y+10*p.s,24*p.s,15*p.s,0,0,TAU);ac.stroke();}}}
// positionLabels 将 DOM 标签放到同一透视坐标，隐藏离屏入口，保留列表可访问性。
function positionLabels(){const reserved=$('intro').getBoundingClientRect();for(let i=0;i<3;i++){const s=islands[i],p=pointAt(s,0,s.r*s.sy+28,5),b=islandLabels[i],collision=p&&p.x-80<reserved.right+15&&p.y-35<reserved.bottom+20&&p.y+35>reserved.top-10,show=p&&p.x>70&&p.x<W-70&&p.y>110&&p.y<H-100&&!collision&&!(i===selected&&nearState);b.hidden=!show;if(show){b.style.left=p.x+'px';b.style.top=(p.y+23)+'px';b.style.opacity=clamp(p.s*1.3,.4,1);}}for(let i=0;i<3;i++){const b=books[i],s=islands[selected],left=i===0,p=pointAt(s,b.x+(left?-1:1)*b.w*.6,b.y,terrainHeight(s,b.x,b.y)+b.z),el=articleLabels[i];el.hidden=!nearState||!p||p.x<(left?230:130)||p.x>W-(left?50:215)||p.y<115||p.y>H-115;if(!el.hidden){el.style.transform=left?'translate(calc(-100% - 14px), -50%)':'translate(14px,-50%)';el.style.left=p.x+'px';el.style.top=(p.y+4)+'px';el.style.opacity=smooth(690,540,camera.d);}}$('coordinates').textContent=Math.round(camera.x).toString().padStart(3,'0')+' / '+Math.round(camera.y).toString().padStart(3,'0');$('zoom').textContent=(1150/camera.d).toFixed(1)+'×';$('minus').disabled=target.d>=2500;$('plus').disabled=target.d<=270;land.dataset.camera=JSON.stringify(camera);land.dataset.landPaints=stats.landPaints;land.dataset.landMs=stats.landMs.toFixed(2);}
// setZoom 改变相机距离目标；锚点落在海平面，所有中途输入可打断自动靠近。
function setZoom(factor,x=W*.57,y=H*.55){flight=false;target.x=camera.x;target.y=camera.y;target.d=clamp(target.d*factor,270,2500);zoomAnchor={x,y,world:unprojectSea(x,y)};wake();}
// approachIsland 连续对准被选岛，先保留当前镜头值；不切换到另一个场景。
function approachIsland(index){selected=index;const s=islands[index];target.x=s.x;target.y=s.y+10;target.d=W<580?390:455;flight=true;zoomAnchor=null;updateMode(true);wake();}
// returnSea 将视点从当前位置缓慢拉远；用户可在中途重新拖动或缩放。
function returnSea(){target.x=islands[selected].x;target.y=islands[selected].y-60;target.d=W<580?850:1150;flight=true;zoomAnchor=null;wake();}
// resetView 回到原点岛的初始构图，不重建任何地形数据。
function resetView(){selected=0;returnSea();updateMode(true);}
// stopCamera 在直接操控开始时接管当前画面，不跳到尚未完成的目标。
function stopCamera(){target.x=camera.x;target.y=camera.y;target.d=camera.d;flight=false;zoomAnchor=null;}
// pointInQuad 按纸页四边形命中，避免大圆形命中覆盖临近内容。
function pointInQuad(x,y,pts){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
// pickBook 从最后绘制的纸页开始命中，只在近景开启阅读。
function pickBook(x,y){if(!nearState)return-1;for(let i=hits.length-1;i>=0;i--)if(pointInQuad(x,y,hits[i].points))return hits[i].index;return-1;}
// pickIsland 使用岸线包围范围选择岛；文章命中优先于岛屿。
function pickIsland(x,y){let found=-1,best=Infinity;for(let i=0;i<3;i++){const s=islands[i],p=project(s.x,s.y,25);if(!p)continue;const d=Math.hypot((x-p.x)/(s.r*p.s),(y-p.y)/(s.r*s.sy*p.s));if(d<1.15&&d<best){best=d;found=i;}}return found;}
// fillArticle 在原生模态阅读层中写入本地文本；始终使用 textContent 防止注入。
function fillArticle(){const c=copy[lang];$('article-meta').textContent=c.sample+' / '+c.tags[currentArticle]+' / 2 '+c.minutes;$('article-title').textContent=c.title[currentArticle];$('article-body').replaceChildren();for(const text of c.body[currentArticle]){const p=document.createElement('p');p.textContent=text;$('article-body').append(p);}$('reader-end').textContent=c.end;$('next-article').textContent=c.next+'：'+c.title[(currentArticle+1)%3]+' ↗';$('reader').scrollTop=0;}
// openArticle 打开浏览器原生 dialog，交由浏览器管理焦点边界及 Esc 关闭。
function openArticle(index){currentArticle=index;fillArticle();if(!$('reader').open)$('reader').showModal();wake();}
// wake 只保持一个动画请求；隐藏页面时不启动后台帧。
function wake(){if(!raf&&!document.hidden)raf=requestAnimationFrame(frame);}
// frame 管理镜头、海浪和 DOM 定位；陆地缓存独立，减少动态时收敛后完全停止。
function frame(now){raf=0;if(document.hidden)return;const dt=Math.min(48,now-(last||now));last=now;const k=reduced.matches?1:1-Math.exp(-dt/(flight?240:100));const moving=Math.abs(target.d-camera.d)>.025||Math.abs(target.x-camera.x)>.025||Math.abs(target.y-camera.y)>.025;
 if(moving){camera.d+= (target.d-camera.d)*k;if(flight){camera.x+=(target.x-camera.x)*k;camera.y+=(target.y-camera.y)*k;}if(zoomAnchor){const after=unprojectSea(zoomAnchor.x,zoomAnchor.y);camera.x+=zoomAnchor.world.x-after.x;camera.y+=zoomAnchor.world.y-after.y;target.x=camera.x;target.y=camera.y;}dirty=true;}else{camera.x=target.x;camera.y=target.y;camera.d=target.d;flight=false;zoomAnchor=null;}
 if(!reduced.matches&&!$('reader').open&&!$('about').open)time+=dt*.001;const drawWater=dirty||!lastSea||(!reduced.matches&&!$('reader').open&&!$('about').open&&now-lastSea>31);
 if(drawWater){drawSea(time);drawAir(time);lastSea=now;}if(dirty){drawLand();updateMode();positionLabels();dirty=false;}if(moving||(!reduced.matches&&!$('reader').open&&!$('about').open))wake();}
// 两指距离和中点用于连续缩放；仅在存在两个触点时调用。
function pinchPair(){const p=[...gesture.values()];return{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.max(1,Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y))};}
// pointerdown 接管镜头和指针捕获，避免拖出画布后丢失释放事件。
land.addEventListener('pointerdown',e=>{stopCamera();gesture.set(e.pointerId,{x:e.clientX,y:e.clientY});down={x:e.clientX,y:e.clientY};dragMoved=gesture.size>1;land.setPointerCapture(e.pointerId);land.classList.add('dragging');});
// pointermove 让单指与地表同步；双指缩放使用当前画面位置，防止松手跳动。
land.addEventListener('pointermove',e=>{if(!gesture.has(e.pointerId)){const next=pickBook(e.clientX,e.clientY);if(next!==hover){hover=next;lastSea=0;wake();}land.style.cursor=next>=0||pickIsland(e.clientX,e.clientY)>=0?'pointer':'grab';return;}const old=gesture.get(e.pointerId),before=gesture.size===2?pinchPair():null;gesture.set(e.pointerId,{x:e.clientX,y:e.clientY});if(gesture.size===2){const after=pinchPair();target.d=clamp(camera.d*before.d/after.d,270,2500);zoomAnchor={x:after.x,y:after.y,world:unprojectSea(before.x,before.y)};dragMoved=true;wake();return;}const a=unprojectSea(old.x,old.y),b=unprojectSea(e.clientX,e.clientY);camera.x+=a.x-b.x;camera.y+=a.y-b.y;target.x=camera.x;target.y=camera.y;if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)dragMoved=true;dirty=true;wake();});
// finishPointer 只把未移动的释放视为点击；取消不触发打开或旅行。
function finishPointer(e,cancelled){if(!gesture.has(e.pointerId))return;gesture.delete(e.pointerId);if(!gesture.size){land.classList.remove('dragging');if(!dragMoved&&!cancelled){const b=pickBook(e.clientX,e.clientY);if(b>=0)openArticle(b);else{const i=pickIsland(e.clientX,e.clientY);if(i>=0)approachIsland(i);}}down=null;}else dragMoved=true;}
// 释放与取消都清理捕获手势；取消明确禁止点击副作用。
land.addEventListener('pointerup',e=>finishPointer(e,false));
land.addEventListener('pointercancel',e=>finishPointer(e,true));
// wheel 把不同设备的滚动单位归一化，不吞掉阅读层的正常滚动。
land.addEventListener('wheel',e=>{e.preventDefault();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?H:1);setZoom(Math.exp(clamp(delta,-180,180)*.0014),e.clientX,e.clientY);},{passive:false});
// UI 控件直接复用同一镜头和阅读动作，避免测试入口与实际入口分叉。
$('plus').addEventListener('click',()=>setZoom(.72));
$('minus').addEventListener('click',()=>setZoom(1.38));
$('home').addEventListener('click',resetView);
$('brand').addEventListener('click',resetView);
$('approach').addEventListener('click',()=>nearState?returnSea():approachIsland(selected));
$('theme').addEventListener('click',()=>setTheme(theme==='auto'?'dark':theme==='dark'?'light':'auto'));
$('language').addEventListener('click',()=>{lang=lang==='zh'?'en':'zh';remember('lang',lang);updateText();});
$('help').addEventListener('click',()=>{$('about').showModal();});
$('close-about').addEventListener('click',()=>{$('about').close();wake();});
$('close-reader').addEventListener('click',()=>{$('reader').close();wake();});
$('next-article').addEventListener('click',()=>{currentArticle=(currentArticle+1)%3;fillArticle();});
// 原生 Esc 关闭模态框后恢复海浪；保留浏览器的焦点恢复行为。
$('reader').addEventListener('close',wake);
$('about').addEventListener('close',wake);
// 键盘操控仅在无模态框时接管；平移方向与拖动地表一致。
addEventListener('keydown',e=>{if($('reader').open||$('about').open)return;if(e.key==='Escape'){returnSea();return;}if(e.key==='+'||e.key==='='){setZoom(.8);e.preventDefault();}else if(e.key==='-'){setZoom(1.25);e.preventDefault();}else if(e.key.startsWith('Arrow')){e.preventDefault();stopCamera();const step=camera.d*.07;if(e.key==='ArrowLeft')camera.x-=step;if(e.key==='ArrowRight')camera.x+=step;if(e.key==='ArrowUp')camera.y-=step;if(e.key==='ArrowDown')camera.y+=step;target.x=camera.x;target.y=camera.y;dirty=true;wake();}});
// 视口与系统偏好改变时重画；隐藏页面立即释放动画请求。
addEventListener('resize',resize);
systemTheme.addEventListener('change',()=>{if(theme==='auto')setTheme('auto');});
reduced.addEventListener('change',()=>{dirty=true;wake();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(raf);raf=0;}else{last=0;dirty=true;wake();}});
// 显卡上下文恢复后重建本地海面资源；丢失期间陆地与阅读仍可使用。
sea.addEventListener('webglcontextlost',e=>{e.preventDefault();});
sea.addEventListener('webglcontextrestored',()=>{waterProgram=null;initWater();dirty=true;wake();});
// 仅暴露只读诊断快照，方便核对真实相机与渲染耗时，不提供另一条业务操作路径。
Object.defineProperty(window,'pulseTides',{get(){return{camera:{...camera},target:{...target},stats:{...stats},near:nearState,selected,theme,lang,reduced:reduced.matches};}});
// 启动时读取本原型自己的偏好键；窄屏从更近的视点开始，避免岛屿缩成小点。
lang=remember('lang')==='en'?'en':'zh';const savedTheme=remember('theme');theme=['auto','dark','light'].includes(savedTheme)?savedTheme:'auto';if(innerWidth<580)camera.d=target.d=850;resize();setTheme(theme);updateText();wake();
