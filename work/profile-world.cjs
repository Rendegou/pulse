const {chromium}=require('playwright');
const fs=require('node:fs');
// 固定相机轨迹对比两个渲染器；仅在测试响应中附加计时入口，正式源码不暴露改相机的调试 API。
async function main(){
 const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 try{
  const output={};
  for(const version of ['before','after']){
   const page=await browser.newPage({viewport:{width:1440,height:960}});
   await page.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
   let source=fs.readFileSync(version==='before'?'work/world-before.js':'static/world.js','utf8');
   if(version==='before') source=source.replace('if (!terrainCache || terrainCacheKey !== key || (!moving && shimmerDue))','if (moving || !terrainCache || terrainCacheKey !== key || (!moving && shimmerDue))');
   // 分段探针累计真实调用时间，避免用低 EWMA 掩盖地形冻结或某次分配尖峰。
   source+='\nwindow.__stages={};';
   for(const name of ['drawTerrain','drawHouse','visibleHouses']) source+=`\n{ const original=${name}; ${name}=function(...args){const start=performance.now();const result=original(...args);window.__stages.${name}=(window.__stages.${name}||0)+performance.now()-start;return result;}; }`;
   source+=`\nwindow.__frame=(x,y,z)=>{cancelAnimationFrame(state.raf);camera.x=x;camera.y=y;camera.zoom=z;state.gesture={};const start=performance.now();render(performance.now());cancelAnimationFrame(state.raf);return performance.now()-start;};`;
   await page.route('**/world.js',r=>r.fulfill({contentType:'text/javascript',body:source}));
   await page.goto(process.argv[2]);
   output[version]=await page.evaluate(async()=>{
    const w=await import('/world.js');
    w.setPalette({bg:'#101b20',land:'#95b9ad',water:'#496972',contour:'#698d80',line:'#a8c5b6',fill:'#14262a',roof:'#88afa0',accent:'#d7b38c',paper:'#c4d8c7',muted:'#87a7a0'});
    w.initWorld(document.querySelector('#world'),{});
    const costs=[],gaps=[];let last=0;
    for(let i=0;i<100;i++){
     const time=await new Promise(requestAnimationFrame);if(last)gaps.push(time-last);last=time;
     costs.push(window.__frame(i*13,i*7,.5));
    }
    const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.floor(a.length*p)];
    return {rawP50:percentile(costs,.5),rawP95:percentile(costs,.95),rafP50:percentile(gaps,.5),rafP95:percentile(gaps,.95),stages:window.__stages,stats:w.getStats()};
   });
   await page.close();
  }
  fs.writeFileSync('work/world-profile-comparison.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
 }finally{await browser.close();}
}
// 性能脚本发生运行错误必须失败，不能静默丢失某一侧结果。
main().catch(error=>{console.error(error);process.exitCode=1;});
