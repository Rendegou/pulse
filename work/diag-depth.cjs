// 临时诊断：点击标记后的选择状态。
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: true,
  });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto('http://127.0.0.1:13918');
  await page.waitForFunction(() => window.PULSE_WORLD?.snapshot().tick > 5);
  const m = await page.evaluate(() => PULSE_WORLD.markerScreen(0));
  console.log('marker0:', JSON.stringify(m));
  const el = await page.evaluate((mm) => {
    const e = document.elementFromPoint(mm.x, mm.y);
    return e ? e.id || e.tagName : null;
  }, m);
  console.log('element at marker:', el);
  await page.mouse.click(m.x, m.y);
  await page.waitForTimeout(300);
  console.log(JSON.stringify(await page.evaluate(() => ({
    snap: PULSE_WORLD.snapshot(),
    selHidden: document.getElementById('selection').hidden,
    errors: window.__worldErrors || [],
  })), null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
