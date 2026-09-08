const {chromium}=require(require('node:path').resolve('.tools/node_modules/playwright-core'));
const assert=require('node:assert/strict');
const fs=require('node:fs');
// 对真实前端页面验证空间进入、缓存失效、点击文章与窄屏；本机静态预览没有 WS 服务。
async function main(){
 const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 const errors=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:960},colorScheme:'dark'});
  // 收集每个页面的脚本异常，不把 WebSocket 未连接冒充真实多人验证。
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  const page=await context.newPage();await page.goto(process.argv[2]);
  await page.waitForFunction(()=>window.PULSE?.stats().scenePaints>0);
  await page.evaluate(async()=>{window.__world=await import('/world.js');});
  await page.screenshot({path:'docs/design/publication-island-overview.png'});
  const idle=await page.evaluate(()=>PULSE.stats().scenePaints);await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>PULSE.stats().scenePaints),idle);
  // 缩放后实际世界坐标仍固定在指针下；同时确认缓存已重新绘制。
  const anchor=await page.evaluate(()=>__world.screenToWorld(700,600));
  await page.mouse.move(700,600);await page.mouse.wheel(0,-120);
  await page.waitForFunction(n=>PULSE.stats().scenePaints>n,idle);
  const after=await page.evaluate(()=>__world.screenToWorld(700,600));
  assert.ok(Math.hypot(anchor.x-after.x,anchor.y-after.y)<.001);
  await page.locator('[data-near="origin"]').click();
  await page.waitForFunction(()=>Math.abs(PULSE.camera().zoom-.85)<.000001);
  await page.locator('#enter').click();await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>__world.getInside()),null);
  assert.ok(await page.evaluate(()=>PULSE.camera().zoom>1));
  await page.waitForFunction(()=>__world.getInside()?.id==='origin');
  assert.equal(await page.locator('#nearby').isVisible(),false);
  await page.screenshot({path:'docs/design/publication-island-interior.png'});
  // 命中置顶的第一篇文章书页，不仅验证旁边的 DOM 快捷入口。
  const book=await page.evaluate(async()=>{const {projectCalc}=await import('/pure.js');const c=PULSE.camera();return projectCalc({cx:c.x,cy:c.y,zoom:c.zoom,W:innerWidth,H:innerHeight},-3,-8,22);});
  await page.mouse.click(book.x,book.y);await page.waitForFunction(()=>document.querySelector('#reader').open);
  assert.ok((await page.locator('#article-body').innerText()).length>40);
  await page.keyboard.press('Escape');
  // 两张后层书页的可见区域各自命中正确文章，不被前层的宽泛圆形区域截获。
  for (const [wx,wy,z,index] of [[-43,-8,7,1],[35,15,10,2]]) {
    const point=await page.evaluate(async({wx,wy,z})=>{const {projectCalc}=await import('/pure.js');const c=PULSE.camera();return projectCalc({cx:c.x,cy:c.y,zoom:c.zoom,W:innerWidth,H:innerHeight},wx,wy,z);},{wx,wy,z});
    await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>document.querySelector('#reader').open);
    assert.equal(await page.locator('#reader').getAttribute('data-article'),String(index));
    await page.keyboard.press('Escape');
  }
  await page.locator('#back').click();
  await page.waitForFunction(()=>!__world.getSelected());
  await page.locator('#theme').click();await page.locator('#locale').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.screenshot({path:'docs/design/publication-island-light.png'});
  await page.reload();await page.waitForFunction(()=>window.PULSE);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});await mobile.goto(process.argv[2]);
  await mobile.evaluate(async()=>{window.__world=await import('/world.js');});
  await mobile.locator('[data-near="origin"]').click();await mobile.waitForFunction(()=>Math.abs(PULSE.camera().zoom-.85)<.000001);
  await mobile.locator('#enter').click();await mobile.waitForFunction(()=>__world.getInside()?.id==='origin');
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.screenshot({path:'docs/design/publication-island-mobile.png'});
  await mobile.locator('#books button').first().click();assert.equal(await mobile.locator('#reader').evaluate(el=>el.open),true);
  assert.deepEqual(errors,[]);
  const report={passed:true,errors,checks:['idle scene reuse','wheel anchor and scene invalidation','continuous entry','three overlapping article page hits','DOM reading and return','theme/locale persistence','390px layout'],network:'Static frontend only; real WebSocket integration not tested.'};
  fs.writeFileSync('work/publication-ui-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
}
// 任意验收失败保留非零状态，不以截图存在代替通过。
main().catch(error=>{console.error(error);process.exitCode=1;});
