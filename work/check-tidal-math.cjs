const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const html=fs.readFileSync('outputs/pulse-tidal-islands.html','utf8');
const camera={x:0,y:0,d:1150};
// 直接提取交付 HTML 中的纯函数，避免测试一套复制后与页面分离的公式。
function source(name){const found=html.match(new RegExp('^function '+name+'\\([^\\n]+','m'));assert.ok(found,name+' exists');return found[0];}
const code=['clamp','smooth','project','unprojectSea','pointInQuad'].map(source).join('\n');
const api=vm.runInNewContext(code+'\n({project,unprojectSea,pointInQuad})',{camera,W:1280,H:720,F:792,Math});
const farGround=api.project(80,0,0).s,farHigh=api.project(80,0,100).s;
camera.d=455;
const groundRatio=api.project(80,0,0).s/farGround,highRatio=api.project(80,0,100).s/farHigh;
assert.ok(highRatio>groundRatio+.1,'nearer elevated particles grow faster');
let maxError=0;
// 在不同高度与平移位置检验海面反投影，覆盖实际屏幕中心及四个象限。
for(const distance of [270,455,850,1150,2500]){
 camera.x=137;camera.y=-86;camera.d=distance;
 for(const [sx,sy]of [[640,360],[400,250],[900,250],[400,550],[900,550]]){
  const world=api.unprojectSea(sx,sy),back=api.project(world.x,world.y,0);
  assert.ok(back&&Number.isFinite(world.x)&&Number.isFinite(world.y));
  const error=Math.hypot(back.x-sx,back.y-sy);maxError=Math.max(maxError,error);
  assert.ok(error<.2,`sea anchor error ${error} at distance ${distance}`);
 }
}
assert.equal(api.pointInQuad(10,10,[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]),true);
assert.equal(api.pointInQuad(30,10,[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]),false);
const report={source:'outputs/pulse-tidal-islands.html',elevatedGrowth:highRatio,groundGrowth:groundRatio,anchorCases:25,maxAnchorErrorPx:maxError,quadCases:2,note:'数学契约检查；不代表视觉满意度、GPU 耗时或多人验证。'};
fs.writeFileSync('work/tidal-math-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(report);
