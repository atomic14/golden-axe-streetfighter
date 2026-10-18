// Screenshot the page as a phone (touch emulation) in portrait and landscape.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5180/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, w, h] of [['portrait', 390, 844], ['landscape', 844, 390], ['tablet', 1024, 768]] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(url);
  await page.waitForFunction(() => 'advance' in window);
  await page.evaluate(async () => {
    const w = window as unknown as { advance: (n: number) => void; game: { startGame(): void; state: string } };
    w.game.startGame();
    while (w.game.state !== 'play') await new Promise((r) => setTimeout(r, 50));
    w.advance(60);
  });
  // hold the stick and the attack button
  await page.touchscreen.tap(w * 0.2, h * 0.9);
  await page.screenshot({ path: `work/shots/mobile-${name}.png` });
  await ctx.close();
}
await browser.close();
