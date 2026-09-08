const {chromium} = require(require('node:path').resolve('.tools/node_modules/playwright-core'));
const fs = require('node:fs');
const assert = require('node:assert/strict');
// 在正式 world.js 上测量地形缓存与镜头一致性；只加载渲染模块，不接生产 WebSocket。
async function main() {
  const browser = await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:960}, deviceScaleFactor:1});
    await page.route('**/app.js', route => route.fulfill({contentType:'text/javascript', body:''}));
    // 可选对照只修正旧缓存冻结条件，测到“确实跟随镜头”时的旧绘制成本。
    if (process.argv.includes('--correct-cache')) await page.route('**/world.js', route => {
      const source=fs.readFileSync('static/world.js','utf8').replace('if (!terrainCache || terrainCacheKey !== key || (!moving && shimmerDue))', 'if (moving || !terrainCache || terrainCacheKey !== key || (!moving && shimmerDue))');
      return route.fulfill({contentType:'text/javascript',body:source});
    });
    await page.goto(process.argv[2]);
    const result = await page.evaluate(async () => {
      const w = await import('/world.js');
      let offscreenPaints = 0;
      const costs = [], gaps = [];
      const original = CanvasRenderingContext2D.prototype.fillRect;
      // 计数实际离屏背景绘制，检测“相机在动但缓存冻结”的画面停顿。
      CanvasRenderingContext2D.prototype.fillRect = function(...args) {
        if (this.canvas !== document.querySelector('#world') && args[2]>100 && args[3]>100) offscreenPaints++;
        return original.apply(this, args);
      };
      w.setPalette({bg:'#101b20',land:'#95b9ad',water:'#496972',contour:'#698d80',line:'#a8c5b6',fill:'#14262a',roof:'#88afa0',accent:'#d7b38c',paper:'#c4d8c7',muted:'#87a7a0'});
      w.initWorld(document.querySelector('#world'), {});
      // 用 rAF 观察真实相机飞行，采样窗固定帧数；耗时取引擎实际记录，非理论 FPS。
      const frames = n => new Promise(resolve => { let left=n,last=0; function sample(t){if(last)gaps.push(t-last);last=t;costs.push(w.getStats().frameMs);if(--left>0)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample); });
      await frames(12);
      const idleStart = offscreenPaints;
      await frames(48);
      const idlePaints = offscreenPaints-idleStart;
      costs.length=0; gaps.length=0;
      w.flyTo({x:1800,y:1100,zoom:.4},null,4000);
      await frames(5);
      const paintStart=offscreenPaints, from=w.getCamera();
      await frames(90);
      const to=w.getCamera(), movingPaints=offscreenPaints-paintStart;
      // 分位数使用完整样本；frameMs 在旧实现中为 EWMA，不能冒充每帧原始时间。
      const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
      return {idlePaints,movingPaints,from,to,frames:90,ewmaCostP50:percentile(costs,.5),ewmaCostP95:percentile(costs,.95),rafGapP50:percentile(gaps,.5),rafGapP95:percentile(gaps,.95),stats:w.getStats()};
    });
    fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
    assert.ok(result.to.x>result.from.x+20,'camera must actually travel');
    assert.ok(result.movingPaints>20,'terrain must track the moving camera, not reuse a frozen bitmap');
    if (!process.argv.includes('--correct-cache')) assert.equal(result.idlePaints,0,'静止时不应定时重建地表');
  } finally { await browser.close(); }
}
// 失败保留测量报告和非零退出码，供同场景修复前后比较。
main().catch(error=>{console.error(error.message);process.exitCode=1;});
