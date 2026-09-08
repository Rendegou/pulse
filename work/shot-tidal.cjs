// 临时目视脚本：给潮汐群岛原型拍几张状态截图，供 agent 实际查看画面。
// 用法：node work/shot-tidal.cjs <原型URL> <输出目录>；只读页面，不修改原型。
const { chromium } = require(require('node:path').resolve('.tools/node_modules/playwright-core'));
const url = process.argv[2];
const out = process.argv[3] || 'work/tidal-shots';
const fs = require('node:fs');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    await page.goto(url);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${out}/01-overview-dark.png` });

    // 靠近第一座岛
    await page.locator('#approach').click();
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${out}/02-near-dark.png` });

    // 打开第一篇文章
    const labels = page.locator('.article-label');
    if (await labels.count()) { await labels.first().click(); await page.waitForTimeout(700); }
    await page.screenshot({ path: `${out}/03-reader.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // 明亮主题
    await page.locator('#theme').click();
    await page.waitForTimeout(500);
    await page.locator('#theme').click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/04-near-light.png` });

    // 拉远看整体
    await page.locator('#home').click();
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${out}/05-overview-light.png` });

    const stats = await page.evaluate(() => window.pulseTides);
    console.log(JSON.stringify({ errors, stats }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
