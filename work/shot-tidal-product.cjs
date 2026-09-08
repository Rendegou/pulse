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
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'docs/design/tidal-near.png' });

    // 打开文章
    const book = await page.evaluate(() => window.PULSE_WORLD.bookScreen(0));
    await page.mouse.click(book.x, book.y);
    await page.waitForFunction(() => document.getElementById('reader').open);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'docs/design/tidal-reader.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 明亮主题
    await page.locator('#theme').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'docs/design/tidal-light.png' });

    // 窄屏
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(url);
    await mobile.waitForFunction(() => window.PULSE_WORLD?.snapshot().scenePaints > 0);
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false);
    await mobile.waitForTimeout(800);
    await mobile.screenshot({ path: 'docs/design/tidal-mobile.png' });
    await mobile.locator('#nearby button').first().click();
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().near === true);
    await mobile.waitForFunction(() => window.PULSE_WORLD.snapshot().moving === false);
    await mobile.waitForTimeout(600);
    await mobile.screenshot({ path: 'docs/design/tidal-mobile-near.png' });

    console.log(JSON.stringify({ errors, shots: 5 }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
