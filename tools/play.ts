// Drive the game in headless Chrome for testing (npm run dev first):
//   npx tsx tools/play.ts tests/flow.js [url]
// Screenshots go to work/shots.
// The script runs in the page with helpers: K(code, down), tap(code), advance(n), sleep(ms), shot(name).
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [scriptPath, url = 'http://localhost:5180/'] = process.argv.slice(2);
mkdirSync('work/shots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 672 } });
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[t]')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await page.waitForFunction(() => 'advance' in window, null, { timeout: 30000 });
await page.exposeFunction('shotNode', async (name: string) => {
  await page.locator('#screen').screenshot({ path: `work/shots/${name}.png` });
});
await page.evaluate(() => {
  const w = window as unknown as Record<string, unknown>;
  w.K = (c: string, d: boolean) => dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c }));
  w.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
});
const body = readFileSync(scriptPath, 'utf8');
const result = await page.evaluate(`(async () => {
  const tap = (c, n = 2) => { K(c, true); advance(n); K(c, false); advance(2); };
  const shot = (name) => shotNode(name);
  ${body}
})()`);
if (result !== undefined) console.log(JSON.stringify(result));
await browser.close();
