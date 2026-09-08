// 粒子纵深（docs/13）产品级验收：真实 Edge 无头 + 交互断言 + 截图。
// 用法：node work/check-depth.cjs <预览URL>（node work/serve-world-preview.mjs 的地址）
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.argv[2];
if (!url) throw new Error('Pass the local preview URL');

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const failures = [];
  const report = { passed: false, errors: [], checks: [] };
  const ok = (name) => report.checks.push(name);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', (error) => failures.push('pageerror: ' + error.message));
    await page.goto(url);
    await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().tick > 5);

    // 1) 初始：无错误、粒子有界、浮粒在场、三篇标记
    const initial = await page.evaluate(() => PULSE_WORLD.snapshot());
    assert.deepEqual(initial.errors, []);
    assert.ok(initial.particles > 800 && initial.particles < 40000, '粒子应落在有界预算内');
    assert.ok(initial.floats > 5, '应存在前景浮粒');
    assert.equal(initial.markers, 3);
    await page.screenshot({ path: 'docs/design/depth-far.png' });
    ok('初始快照（粒子/浮粒/标记）');

    // 2) 纵深核心：同一镜头内近处点比远处点大；镜头距离减小时，
    //    近处放大的相对幅度大于远处——"靠近时运动显现前后差"。
    const scales34 = await page.evaluate(() => ({
      near: PULSE_WORLD.project(0, 0).scale,
      far: PULSE_WORLD.project(0, -140).scale,
    }));
    assert.ok(scales34.near > scales34.far * 1.08, '近点应大于远点（同一帧内有前后差）');
    await page.evaluate(() => PULSE_WORLD.setCamD(16));
    await page.waitForTimeout(120);
    const scales16 = await page.evaluate(() => ({
      near: PULSE_WORLD.project(0, 0).scale,
      far: PULSE_WORLD.project(0, -140).scale,
    }));
    const nearGain = scales16.near / scales34.near;
    const farGain = scales16.far / scales34.far;
    console.log('纵深比例:', JSON.stringify({ scales34, scales16, nearGain, farGain }));
    assert.ok(nearGain > farGain * 1.2, `靠近时近处应比远处放得更快（近 ${nearGain.toFixed(2)}× vs 远 ${farGain.toFixed(2)}×）`);
    await page.evaluate(() => PULSE_WORLD.setCamD(34));
    await page.waitForTimeout(120);
    ok('纵深：近快远慢的尺度差');

    // 3) 互逆：屏幕 ↔ 地面坐标往返一致（命中/锚定/指针的基础）
    const rt = await page.evaluate(() => {
      const p = PULSE_WORLD.project(123, -87);
      return PULSE_WORLD.unproject(p.x, p.y);
    });
    assert.ok(Math.abs(rt.x - 123) < 1 && Math.abs(rt.y + 87) < 1, '投影互逆偏差 1 世界单位以内');
    ok('投影互逆（地面平面）');

    // 4) 滚轮锚定：指针下的地面点不漂移
    const ab = await page.evaluate(() => PULSE_WORLD.unproject(700, 600));
    await page.mouse.move(700, 600);
    await page.mouse.wheel(0, -240);
    const aa = await page.evaluate(() => PULSE_WORLD.unproject(700, 600));
    assert.ok(Math.hypot(ab.x - aa.x, ab.y - aa.y) < 2, '滚轮锚定应保持地面点（世界单位）');
    // 真实滚轮后再滚回
    await page.mouse.wheel(0, 240);
    ok('滚轮锚定');

    // 5) 真实滚轮进入近景并截图（运动路径保持连续：只有 camD 变化）
    await page.mouse.move(720, 500);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -220);
    await page.waitForTimeout(150);
    const close = await page.evaluate(() => PULSE_WORLD.snapshot());
    assert.ok(close.camera.camD < 26, '滚轮应推进镜头距离');
    await page.screenshot({ path: 'docs/design/depth-close.png' });
    // 反向缩小
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 220);
    await page.waitForTimeout(150);
    const back = await page.evaluate(() => PULSE_WORLD.snapshot());
    assert.ok(back.camera.camD > 28, '反向缩小应连续恢复');
    ok('连续靠近/返回（无硬切）');

    // 6) 静止稳定：镜头不动时静态场景不再重绘
    const paints0 = await page.evaluate(() => PULSE_WORLD.snapshot().scenePaints);
    await page.waitForTimeout(450);
    const paints1 = await page.evaluate(() => PULSE_WORLD.snapshot().scenePaints);
    assert.equal(paints0, paints1, '静止时不应重绘静态场景');
    ok('静止稳定（缓存命中）');

    // 7) 点击文章标签 → 预览面板 → 阅读全文（DOM）
    const m = await page.evaluate(() => PULSE_WORLD.markerScreen(0));
    await page.mouse.click(m.x, m.y);
    await page.waitForFunction(() => !document.getElementById('selection').hidden);
    assert.ok((await page.locator('#house-name').innerText()).length > 0, '面板应显示文章标题');
    await page.locator('#enter').click();
    await page.waitForFunction(() => document.getElementById('reader').open);
    assert.ok((await page.locator('#article-body').innerText()).length > 40);
    await page.screenshot({ path: 'docs/design/depth-reading.png' });
    await page.locator('#reader .close').click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('selection').hidden);
    ok('标签选中 → 预览 → 阅读 → 取消');

    // 8) 地址旅行确定性
    await page.locator('#address').fill('雨巷');
    await page.locator('#address-form').evaluate((el) => el.requestSubmit());
    await page.waitForFunction(() => !PULSE_WORLD.snapshot().flight);
    const far = await page.evaluate(() => PULSE_WORLD.snapshot());
    assert.ok(Math.abs(far.camera.x) > 10000 || Math.abs(far.camera.y) > 10000);
    await page.locator('#address-form').evaluate((el) => el.requestSubmit());
    await page.waitForFunction(() => !PULSE_WORLD.snapshot().flight);
    assert.deepEqual(far.camera, (await page.evaluate(() => PULSE_WORLD.snapshot())).camera);
    ok('地点旅行确定性');

    // 9) 主题与语言（持久化）
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.locator('#locale').click();
    await page.waitForTimeout(120);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    ok('主题与语言');

    // 10) 窄屏：无横向滚动，能选文阅读
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.PULSE_WORLD?.snapshot().tick > 3);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mm = await mobile.evaluate(() => PULSE_WORLD.markerScreen(0));
    await mobile.mouse.click(mm.x, mm.y);
    await mobile.waitForFunction(() => !document.getElementById('selection').hidden);
    await mobile.screenshot({ path: 'docs/design/depth-mobile.png' });
    ok('窄屏（无横向滚动 / 可选文）');

    // 11) 减少动态：加载无错误，滚轮仍可用
    const reduced = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
    const rp = await reduced.newPage();
    await rp.goto(url);
    await rp.waitForFunction(() => window.PULSE_WORLD?.snapshot().tick > 3);
    await rp.mouse.move(500, 400);
    await rp.mouse.wheel(0, -200);
    await rp.waitForTimeout(120);
    assert.deepEqual((await rp.evaluate(() => PULSE_WORLD.snapshot())).errors, []);
    ok('减少动态模式');

    report.passed = true;
    report.errors = failures;
    report.initial = initial;
    report.depth = { scales34, scales16, nearGain, farGain, closeCamD: close.camera.camD };
    report.screenshots = 4;
    fs.writeFileSync('work/depth-validation.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    console.log('check-depth: ' + (failures.length ? 'FAILED: ' + failures.join('; ') : 'passed'));
    process.exitCode = failures.length ? 1 : 0;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
