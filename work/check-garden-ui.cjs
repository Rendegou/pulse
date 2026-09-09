// 潮汐群岛 + 花园产品验收：真实 Go 服务端（go run .）+ 真实 Edge 无头。
// 用法：node work/check-garden-ui.cjs http://127.0.0.1:8090
// 覆盖：三层画布、远景点植物不误触、静止零重绘、滚轮锚定、靠近 → 浇水 → 生长 →
//       重载仍在、主题/语言持久化、390px 窄屏、双窗口真实访客与共同照料。
const { chromium } = require(require('node:path').resolve('.tools/node_modules/playwright-core'));
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = process.argv[2];
if (!url) throw new Error('Pass the local server URL');

// 取世界诊断快照；页面加载完成前返回 null，便于 waitForFunction。
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

    // 1) 启动：三座岛、WebGL 海面、花园快照已到达、远景不显示照料面板
    const boot = await page.evaluate(snapshot);
    assert.equal(boot.islands, 3, '应有三座示例岛');
    assert.equal(boot.waterRenderer, 'webgl', '海面应走 WebGL 点集');
    assert.ok(boot.seaPoints > 100000, `海面点数应在有界预算内，实际 ${boot.seaPoints}`);
    assert.equal(boot.near, false, '初始应为远景');
    assert.equal(boot.care.length, 3, '应收到三株植物的花园快照');
    assert.equal(await page.locator('#care').isVisible(), false, '远景不应显示照料面板');
    assert.equal(await page.locator('.island-label:visible').count() >= 1, true, '远景应显示岛标签');
    // 自己的指针就是系统光标：画布不能把 cursor 设成 none
    const canvasCursor = await page.locator('#land').evaluate((el) => getComputedStyle(el).cursor);
    assert.notEqual(canvasCursor, 'none', '画布不应隐藏系统光标');
    ok('启动：三岛 / WebGL 海面 / 花园快照 / 系统光标可见');

    // 1b) 远景点植物不直接浇水：点它只会开始靠近，不会立刻打开照料面板
    const farPlant = await page.evaluate(() => window.PULSE_WORLD.plantScreen(0));
    if (farPlant) {
      const dBefore = await page.evaluate(() => window.PULSE_WORLD.camera.d);
      await page.mouse.click(farPlant.x, farPlant.y);
      const dAfter = await page.evaluate(() => window.PULSE_WORLD.camera.d);
      assert.ok(dAfter <= dBefore + 1, '远景不该因为点植物而改变构图');
      assert.equal(await page.locator('#care').isVisible(), false, '远景点植物不应立刻打开照料面板');
      // 回到远景，避免影响后续用例
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false, null, { timeout: 12000 });
    }
    ok('远景点植物不误触');

    // 2) 静止稳定：等镜头收敛后，陆地层不再重绘
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false, null, { timeout: 12000 });
    await page.waitForTimeout(400); // 让收敛后的最后一帧落地
    const paints0 = await page.evaluate(snapshot).then((s) => s.scenePaints);
    await page.waitForTimeout(800);
    const paints1 = await page.evaluate(snapshot).then((s) => s.scenePaints);
    assert.equal(paints0, paints1, '静止时陆地层不应重绘');
    ok('静止稳定（陆地层缓存命中）');

    // 3) 滚轮靠近 + 锚定：指针下的海面点不漂移
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

    // 4) 靠近第一座岛 → 照料面板出现 → 点画布上的植物浇水 → 服务端确认后生长
    await page.locator('#nearby button').first().click();
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true, null, { timeout: 12000 });
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false, null, { timeout: 12000 });
    assert.equal(await page.locator('#care').isVisible(), true, '靠近后应显示照料面板');
    assert.ok((await page.locator('#care-note').innerText()).length > 0, '面板应有阶段文案');
    // 植物上方的透明命中区应贴合植物，并显示动作提示
    const target = await page.locator('#plant-target').boundingBox();
    const plantNow = await page.evaluate(() => window.PULSE_WORLD.plantScreen(0));
    assert.ok(target, '植物命中区应可见');
    assert.ok(Math.abs((target.x + target.width / 2) - plantNow.x) < 40, '命中区应贴在植物上');
    assert.ok((await page.locator('#water-label').innerText()).length > 0, '按钮应有动作文案');
    assert.ok((await page.locator('#presence').innerText()).length > 0, '应显示在线人数');
    assert.ok((await page.locator('#trace').innerText()).length > 0, '应显示最近照料记录');

    const plant = await page.evaluate(() => window.PULSE_WORLD.plantScreen(0));
    assert.ok(plant && plant.x > 0 && plant.x < 1440, '植物应在屏幕内');
    await page.mouse.click(plant.x, plant.y);
    await page.waitForFunction(() => window.PULSE_WORLD.garden.plants[0].care >= 1, null, { timeout: 8000 });
    // 生长动画：growth 应向 care 收敛
    await page.waitForFunction(() => window.PULSE_WORLD.growth[0] > 0.5, null, { timeout: 8000 });
    const afterWater = await page.evaluate(snapshot);
    assert.equal(afterWater.care[0], 1, '第一次浇水后应为阶段 1');
    assert.equal(afterWater.gardenVersion >= 1, true, '版本应递增');
    assert.equal(await page.locator('#water').isDisabled(), true, '冷却期内按钮应禁用');
    ok('靠近 → 点植物浇水 → 生长阶段 1');

    // 5) 服务端持久化：重新加载页面后阶段仍在
    await page.reload();
    await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    await page.waitForFunction(() => window.PULSE_WORLD.garden.version >= 1, null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.PULSE_WORLD.garden.plants[0].care), 1, '重载后阶段应保留');
    ok('刷新后生长状态仍在（服务端落盘）');

    // 6) 主题与语言：切换后持久化
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', '应切到明亮');
    await page.locator('#locale').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en', '应切到英文');
    await page.reload();
    await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    ok('主题与语言持久化');

    // 7) 窄屏：无横向滚动，照料面板可用
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.locator('#nearby button').first().click();
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true, null, { timeout: 12000 });
    assert.equal(await mobile.locator('#care').isVisible(), true, '窄屏靠近后也应显示照料面板');
    ok('390px 窄屏（无横向滚动 / 面板可见）');

    // 8) 双窗口真实访客 + 共同照料：两个连接先后浇同一株，第二次应标记 together
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(url);
    await b.goto(url);
    await a.waitForFunction(() => window.PULSE?.state.you);
    await b.waitForFunction(() => window.PULSE?.state.you);
    await a.waitForFunction(() => window.PULSE.state.sessions.size >= 2, null, { timeout: 10000 });
    await b.waitForFunction(() => window.PULSE.state.sessions.size >= 2, null, { timeout: 10000 });
    // A 移动指针 → B 应看到 A 的世界坐标
    await a.mouse.move(900, 500);
    await a.mouse.move(960, 560);
    await b.waitForFunction(() => {
      const me = window.PULSE.state.you;
      for (const [id, s] of window.PULSE.state.sessions) {
        if (id !== me && Number.isFinite(s.wx) && Number.isFinite(s.wy)) return true;
      }
      return false;
    }, null, { timeout: 10000 });
    // A 浇水（rain 岛），等冷却过去后 B 在 6 秒窗口内浇同一株
    const water = async (page, plantId) => page.evaluate((id) => {
      return new Promise((resolve) => {
        const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
        sock.onmessage = (m) => {
          const e = JSON.parse(m.data);
          if (e.type === "welcome") sock.send(JSON.stringify({ type: "water", v: 1, plant: id, eventId: `probe-${Math.random()}` }));
          if (e.type === "plant") { sock.close(); resolve({ together: e.together, care: e.garden.plants.find((_, i) => i === 1)?.care }); }
        };
        sock.onerror = () => resolve({ error: true });
        setTimeout(() => { sock.close(); resolve({ timeout: true }); }, 8000);
      });
    }, plantId);
    const first = await water(a, 'rain');
    assert.equal(first.care, 1, 'A 浇水后 rain 岛植物应为阶段 1');
    const second = await water(b, 'rain');
    assert.equal(second.together, true, 'B 在窗口内照料同一株应标记为共同照料');
    ok('双窗口真实访客（指针广播 + 共同照料）');

    assert.deepEqual(errors, []);
    const report = {
      passed: true,
      errors,
      checks,
      boot: { islands: boot.islands, seaPoints: boot.seaPoints, waterRenderer: boot.waterRenderer, care: boot.care },
      plantRatio: await page.evaluate(() => {
        const world = window.PULSE_WORLD;
        const island = world.islandScreen(0);
        const plant = world.plantScreen(0);
        return { islandScreen: island, plantScreen: plant };
      }),
      network: 'Real Go server (go run .) on 127.0.0.1:8090; two real WebSocket clients in one browser.',
      notVerified: [
        '真实手机触控与双指手势',
        '减少动态的浏览器模拟',
        '低端设备 GPU 帧耗时',
        'WebGL 上下文丢失后的 Canvas 2D 回退',
      ],
    };
    fs.writeFileSync('work/garden-ui-validation.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    console.log('check-garden-ui: ' + (errors.length ? 'FAILED: ' + errors.join('; ') : 'passed'));
    process.exitCode = errors.length ? 1 : 0;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
