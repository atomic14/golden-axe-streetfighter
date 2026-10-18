// Record the README's demo GIF: the computer plays both heroes (?cpu&auto) in headless Chrome
// and every few ticks the 320x224 game canvas is saved; ffmpeg then makes docs/demo.gif.
//   npm run dev, then: npx tsx tools/demo-gif.ts [skip ticks=0] [ticks=900] [hero=0] [area=0]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [skip = '0', ticks = '900', hero = '0', area = '0'] = process.argv.slice(2);
const STEP = 3, DIR = 'work/gif';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync('docs', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 672 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5180/?cpu&auto&area=${area}`);
await page.waitForFunction(() => 'advance' in window, null, { timeout: 30000 });
// (a string, so tsx doesn't wrap the named functions in helpers the page lacks)
await page.evaluate(`(async () => {
  filter.setMode('ORIGINAL');
  const tap = (c) => {
    dispatchEvent(new KeyboardEvent('keydown', { code: c }));
    advance(2);
    dispatchEvent(new KeyboardEvent('keyup', { code: c }));
    advance(20);
  };
  tap('Enter');
  game.choice = ${Number(hero)};
  tap('Enter');
  while (game.state !== 'play') await new Promise((r) => setTimeout(r, 50));
})()`);
await page.evaluate((n) => (window as any).advance(n), Number(skip));
for (let i = 0; i < Number(ticks) / STEP; i++) {
  const url = await page.evaluate((n) => {
    (window as any).advance(n);
    return (document.getElementById('screen') as HTMLCanvasElement).toDataURL('image/png');
  }, STEP);
  writeFileSync(`${DIR}/${String(i).padStart(4, '0')}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await browser.close();
// 2x nearest-neighbour, one palette for the whole clip
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(60 / STEP), '-i', `${DIR}/%04d.png`,
  '-vf', 'scale=640:448:flags=neighbor,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none',
  'docs/demo.gif']);
console.log('docs/demo.gif');
