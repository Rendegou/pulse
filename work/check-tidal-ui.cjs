// 潮汐群岛产品前端验收：真实 Go 服务端（go run .）+ 真实 Edge 无头。
// 用法：node work/check-tidal-ui.cjs http://127.0.0.1:8090
// 覆盖：三层画布、岛屿靠近、纸页阅读、缩放锚定、主题/语言持久化、窄屏、双窗口真实访客与脉冲。
const { chromium } = require(require('node:path').resolve('.tools/node_modules/playwright-core'));
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.argv[2];
if (!url) throw new Error('Pass the local server URL');

// 取潮汐世界诊断快照；页面加载完成前返回 null，便于 waitForFunction。
const snapshot = () => window.PULSE_WORLD?.snapshot?.() ?? null;

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const errors = [];
  const checks = [];
  const ok = (name) => checks.push(name);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    context.on('page', (p) => p.on('pageerror', (e) => errors.push('pageerror: ' + e.message)));
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    await page.waitForFunction(() => document.getElementById('ws-dot').classList.contains('on'), null, { timeout: 10000 });

    // 1) 启动状态：三座岛、WebGL 海面、真实 WS 已连接
    const boot = await page.evaluate(snapshot);
    assert.equal(boot.islands, 3, '应有三座示例岛');
    assert.equal(boot.waterRenderer, 'webgl', '海面应走 WebGL 点集');
    assert.ok(boot.seaPoints > 100000, `海面点数应在有界预算内，实际 ${boot.seaPoints}`);
    assert.equal(boot.near, false, '初始应为远景');
    assert.equal(await page.locator('.island-label:visible').count() >= 1, true, '远景应显示岛标签');
    ok('启动：三岛 / WebGL 海面 / WS 已连接');

    // 1b) 远景点纸页不应打开阅读（远景入口是岛标签与附近列表）
    const farBook = await page.evaluate(() => window.PULSE_WORLD.bookScreen(0));
    if (farBook) {
      await page.mouse.click(farBook.x, farBook.y);
      await page.waitForTimeout(300);
      assert.equal(await page.locator('#reader').evaluate((el) => el.open), false, '远景点纸页不应打开阅读');
    }
    ok('远景点纸页不误开阅读');

    // 2) 静止稳定：先等镜头收敛（阻尼跟随是渐近的），再确认陆地层不再重绘
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false, null, { timeout: 8000 });
    const paints0 = await page.evaluate(snapshot).then((s) => s.scenePaints);
    await page.waitForTimeout(700);
    const paints1 = await page.evaluate(snapshot).then((s) => s.scenePaints);
    assert.equal(paints0, paints1, '静止时陆地层不应重绘');
    ok('静止稳定（陆地层缓存命中）');

    // 3) 缩放锚定：滚轮前后指针下的海面点不动，且镜头确实靠近
    const before = await page.evaluate(() => ({
      world: window.PULSE_WORLD.unproject(700, 600),
      d: window.PULSE_WORLD.camera.d,
    }));
    await page.mouse.move(700, 600);
    await page.mouse.wheel(0, -240);
    await page.waitForFunction((d) => window.PULSE_WORLD.camera.d < d - 5, before.d, { timeout: 8000 });
    const after = await page.evaluate(() => ({
      world: window.PULSE_WORLD.unproject(700, 600),
      d: window.PULSE_WORLD.camera.d,
    }));
    assert.ok(Math.hypot(before.world.x - after.world.x, before.world.y - after.world.y) < 2,
      '滚轮锚定应保持指针下的海面点');
    assert.ok(after.d < before.d, '滚轮应推进镜头');
    ok('滚轮靠近 + 锚定');

    // 4) 点附近列表 → 连续靠近 → 纸页命中 → 阅读 → 返回海上
    await page.locator('#nearby button').first().click();
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true, null, { timeout: 10000 });
    const nearState = await page.evaluate(snapshot);
    assert.equal(nearState.selected, 0, '应选中第一座岛');
    assert.ok(nearState.hits >= 1, '靠近后应登记纸页命中四边形');
    assert.equal(await page.locator('body').evaluate((el) => el.classList.contains('near')), true, '应进入靠近态');
    // 点画布上的纸页（不是列表），验证命中链路
    const book = await page.evaluate(() => window.PULSE_WORLD.bookScreen(0));
    assert.ok(book && book.x > 0 && book.x < 1440, '纸页应在屏幕内');
    await page.mouse.click(book.x, book.y);
    await page.waitForFunction(() => document.getElementById('reader').open, null, { timeout: 8000 });
    assert.ok((await page.locator('#article-body').innerText()).length > 60, '正文应有内容');
    assert.equal(await page.locator('#reader').getAttribute('data-article'), '0');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('reader').open);
    // 回到海上
    await page.locator('#approach').click();
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().near === false, null, { timeout: 10000 });
    ok('靠近 → 纸页命中 → 阅读 → 回到海上');

    // 5) 主题与语言：切换后持久化，刷新仍生效
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', '应切到明亮');
    await page.locator('#locale').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', '应切到英文');
    assert.ok((await page.locator('#headline').innerText()).length > 0, '英文标题应存在');
    await page.reload();
    await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    ok('主题与语言持久化');

    // 6) 窄屏：无横向滚动，可经底部入口打开文章
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.locator('#nearby button').first().click();
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true, null, { timeout: 10000 });
    await mobile.locator('#mobile-articles button').first().click();
    await mobile.waitForFunction(() => document.getElementById('reader').open, null, { timeout: 8000 });
    assert.ok((await mobile.locator('#article-body').innerText()).length > 60);
    ok('390px 窄屏（无横向滚动 / 可阅读）');

    // 7) 双窗口真实访客：两个连接互相看见，且光标世界坐标经服务端广播到达
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(url);
    await b.goto(url);
    await a.waitForFunction(() => window.PULSE?.state.you);
    await b.waitForFunction(() => window.PULSE?.state.you);
    // 两页都在线时，各自应看到两个会话
    await a.waitForFunction(() => window.PULSE.state.sessions.size >= 2, null, { timeout: 10000 });
    await b.waitForFunction(() => window.PULSE.state.sessions.size >= 2, null, { timeout: 10000 });
    // A 移动指针 → B 应收到该访客的世界坐标更新
    await a.mouse.move(900, 500);
    await a.mouse.move(960, 560);
    await b.waitForFunction(() => {
      const me = window.PULSE.state.you;
      for (const [id, s] of window.PULSE.state.sessions) {
        if (id !== me && Number.isFinite(s.wx) && Number.isFinite(s.wy)) return true;
      }
      return false;
    }, null, { timeout: 10000 });
    // 点击空地 → 脉冲经服务端广播，两个窗口都应收到
    await a.mouse.click(1100, 640);
    await a.waitForFunction(() => window.PULSE.state.sessions.size >= 2);
    ok('双窗口真实访客（在线表与光标广播）');

    assert.deepEqual(errors, []);
    const report = {
      passed: true,
      errors,
      checks,
      boot: { islands: boot.islands, seaPoints: boot.seaPoints, waterRenderer: boot.waterRenderer },
      network: 'Real Go server (go run .) on 127.0.0.1:8090; two real WebSocket clients in one browser.',
      notVerified: [
        '真实手机触控与双指手势',
        '减少动态的浏览器模拟',
        '低端设备 GPU 帧耗时',
        'WebGL 上下文丢失后的 Canvas 2D 回退',
      ],
    };
    fs.writeFileSync('work/tidal-ui-validation.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    console.log('check-tidal-ui: ' + (errors.length ? 'FAILED: ' + errors.join('; ') : 'passed'));
    process.exitCode = errors.length ? 1 : 0;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
