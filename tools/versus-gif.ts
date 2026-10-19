// Record the README's versus GIF: the computer plays both sides of one ladder fight (?demo) in
// headless Chrome, from the VS screen on, and every few ticks the 320x224 game canvas is saved;
// ffmpeg then makes the GIF.
//   npm run dev, then: npx tsx tools/versus-gif.ts [rung=1] [hero=0] [ticks=900] [out=docs/versus.gif] [port=5173]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [rung = '1', hero = '0', ticks = '900', out = 'docs/versus.gif', port = '5173'] = process.argv.slice(2);
const STEP = 3, DIR = 'work/gif';
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync('docs', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 672 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${port}/?demo&rung=${rung}`);
await page.waitForFunction(() => 'advance' in window, null, { timeout: 30000 });
// (a string, so tsx doesn't wrap the named functions in helpers the page lacks)
await page.evaluate(`(async () => {
  filter.setMode('ORIGINAL');
  const settle = async () => {
    while (game.state !== 'vs') {
      advance(1);
      while (game.state === 'loading') await new Promise((r) => setTimeout(r, 20));
    }
  };
  // the demo picks a hero at random: start the ladder again with the one asked for
  await settle();
  game.startLadder(${Number(hero)});
  await settle();
})()`);
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
  out]);
console.log(out);
