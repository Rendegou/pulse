const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const url=process.argv[2];
if(!url)throw new Error('Pass the local demo URL');
// 使用本机 Edge 的独立无头实例验证真实页面；finally 只关闭本测试创建的实例。
async function main(){
 const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 const failures=[];
 try{
  const context=await browser.newContext({viewport:{width:1440,height:960},colorScheme:'dark'});
  const page=await context.newPage();
  // 捕获真实 JS 运行错误，不用语法通过替代页面运行。
  page.on('pageerror',error=>failures.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>window.PULSE_DEMO?.snapshot().tick>5);
  const initial=await page.evaluate(()=>PULSE_DEMO.snapshot());
  assert.ok(initial.particles>1000&&initial.particles<=44000);assert.ok(initial.houses>1);
  // 固定地表点的投影往返校验，是拖动与光标锚定所依赖的行为契约。
  const roundtrip=await page.evaluate(()=>{const p=PULSE_DEMO.project(123,-87);return PULSE_DEMO.unproject(p.x,p.y);});
  assert.ok(Math.abs(roundtrip.x-123)<1e-7&&Math.abs(roundtrip.y+87)<1e-7);
  await page.screenshot({path:'docs/design/particle-world-overview.png'});
  // 滚轮缩放后指针下仍是同一世界点，禁止只有视觉在缩放而坐标飘走。
  const before=await page.evaluate(()=>PULSE_DEMO.unproject(700,600));
  await page.mouse.move(700,600);await page.mouse.wheel(0,-120);
  const after=await page.evaluate(()=>PULSE_DEMO.unproject(700,600));
  assert.ok(Math.hypot(before.x-after.x,before.y-after.y)<.001);
  await page.mouse.move(650,620);await page.mouse.down();await page.mouse.move(980,700,{steps:8});await page.mouse.up();
  const dragged=await page.evaluate(()=>PULSE_DEMO.snapshot());assert.ok(Math.abs(dragged.camera.x)>100);assert.equal(dragged.gesture,false);
  await page.locator('[data-near="0"]').click();await page.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);
  await page.locator('#enter').click();await page.waitForTimeout(450);
  const mid=await page.evaluate(()=>PULSE_DEMO.snapshot());assert.equal(mid.flight,true);assert.ok(mid.camera.zoom>.85);
  await page.screenshot({path:'docs/design/particle-world-descent.png'});
  await page.waitForFunction(()=>PULSE_DEMO.snapshot().inside==='origin');
  await page.screenshot({path:'docs/design/particle-world-interior.png'});
  assert.equal(await page.locator('#books button').count(),3);
  await page.locator('#books button').first().click();assert.equal(await page.locator('#reader').evaluate(el=>el.open),true);
  assert.ok((await page.locator('#article-body').innerText()).length>40);
  await page.keyboard.press('Escape');await page.locator('#back').click();await page.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);
  // 极远字符串旅行使用有限可见对象，不回绕到原点；这里只验证同一输入的确定性。
  await page.locator('#address').fill('雨巷');await page.locator('#address-form').evaluate(el=>el.requestSubmit());await page.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);
  const far=await page.evaluate(()=>PULSE_DEMO.snapshot());assert.ok(Math.abs(far.camera.x)>10000||Math.abs(far.camera.y)>10000);assert.ok(far.particles>1000&&far.particles<=44000);
  await page.locator('#address-form').evaluate(el=>el.requestSubmit());await page.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);
  const same=await page.evaluate(()=>PULSE_DEMO.snapshot());assert.deepEqual(far.camera,same.camera);
  await page.locator('#origin').click();await page.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);
  await page.locator('#theme').click();await page.locator('#locale').click();
  const preferences=await page.evaluate(()=>PULSE_DEMO.snapshot());assert.equal(preferences.theme,'light');assert.equal(preferences.lang,'en');
  await page.screenshot({path:'docs/design/particle-world-light.png'});
  await page.reload();await page.waitForFunction(()=>window.PULSE_DEMO?.snapshot().tick>3);
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});await mobile.goto(url);await mobile.waitForFunction(()=>window.PULSE_DEMO?.snapshot().tick>3);
  await mobile.screenshot({path:'docs/design/particle-world-mobile.png'});
  assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.locator('[data-near="0"]').click();await mobile.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);await mobile.locator('#enter').click();await mobile.waitForFunction(()=>PULSE_DEMO.snapshot().inside==='origin');
  await mobile.screenshot({path:'docs/design/particle-world-mobile-interior.png'});
  assert.ok(await mobile.locator('#books button').first().isVisible());
  // 独立上下文验证 reduced-motion 不留下长飞行，同时仍能进入和阅读。
  const reduced=await browser.newContext({viewport:{width:1000,height:800},reducedMotion:'reduce'});
  const rp=await reduced.newPage();await rp.goto(url);await rp.locator('[data-near="0"]').click();await rp.waitForFunction(()=>!PULSE_DEMO.snapshot().flight);await rp.locator('#enter').click();await rp.waitForFunction(()=>PULSE_DEMO.snapshot().inside==='origin');
  assert.deepEqual(failures,[]);
  const report={passed:true,initial,mid,far,preferences,errors:failures,checks:['projection roundtrip','wheel anchor','drag','continuous descent','article DOM','return','deterministic travel','bounded working set','theme/locale persistence','mobile layout and entry','reduced motion'],screenshots:6};
  fs.writeFileSync('work/particle-demo-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();}
}
// 报告任意失败并设置非零退出码，不能用截图文件存在代替通过。
main().catch(error=>{console.error(error);process.exitCode=1;});
