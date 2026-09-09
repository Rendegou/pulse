// 产品截图脚本：对真实服务端拍几张状态图，供用户目视验收与文档引用。
// 用法：node work/shot-tidal-product.cjs http://127.0.0.1:8090
// 输出：docs/design/tidal-*.png（覆盖写入，不代表审美通过，只是当前画面存档）。
const { chromium } = require(require('node:path').resolve('.tools/node_modules/playwright-core'));
const url = process.argv[2];
if (!url) throw new Error('Pass the local server URL');

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: 'docs/design/tidal-overview.png' });

    // 靠近第一座岛并等镜头收敛
    await page.locator('#nearby button').first().click();
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true);
    await page.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false);
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'docs/design/tidal-near.png' });

    // 连续浇水到开花：每次等到服务端确认后再进行下一次（冷却由按钮状态反映）
    for (let i = 0; i < 4; i++) {
      const stage = await page.evaluate(() => window.PULSE_WORLD.garden.plants[0].care);
      if (stage >= 3) break;
      const ready = await page.waitForFunction(() => !document.getElementById('water').disabled, null, { timeout: 12000 }).then(() => true, () => false);
      if (!ready) {
        const dbg = await page.evaluate(() => ({
          disabled: document.getElementById('water').disabled,
          text: document.getElementById('water').textContent,
          care: window.PULSE_WORLD.garden.plants.map((p) => p.care),
          ws: document.getElementById('ws-label').textContent,
        }));
        console.log('water button never became ready:', JSON.stringify(dbg));
        break;
      }
      await page.locator('#water').click();
      await page.waitForFunction((n) => window.PULSE_WORLD.garden.plants[0].care > n, stage, { timeout: 12000 });
      await page.waitForTimeout(1200); // 等水滴落下与生长动画
    }
    await page.waitForFunction(() => window.PULSE_WORLD.growth[0] > 2.8, null, { timeout: 15000 });
    await page.screenshot({ path: 'docs/design/tidal-bloom.png' });

    // 明亮主题
    await page.locator('#theme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'docs/design/tidal-light.png' });

    // 窄屏
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false);
    await mobile.waitForTimeout(900);
    await mobile.screenshot({ path: 'docs/design/tidal-mobile.png' });
    await mobile.locator('#nearby button').first().click();
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true);
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false);
    await mobile.waitForTimeout(900);
    await mobile.screenshot({ path: 'docs/design/tidal-mobile-near.png' });

    const state = await page.evaluate(() => ({
      care: window.PULSE_WORLD.garden.plants.map((p) => p.care),
      version: window.PULSE_WORLD.garden.version,
    }));
    console.log(JSON.stringify({ errors, shots: 5, state }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
