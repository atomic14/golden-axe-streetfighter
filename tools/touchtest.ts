// Exercise the touch controls with synthetic touch events on a phone-sized page.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.addInitScript('window.__name = (f) => f');
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:5180/');
await page.waitForFunction(() => 'advance' in window);
const out = await page.evaluate(async () => {
  const w = window as any;
  w.game.startGame();
  while (w.game.state !== 'play') await new Promise((r) => setTimeout(r, 50));
  w.advance(30);
  const app = document.getElementById('app')!;
  const fire = (type: string, id: number, x: number, y: number) => {
    const t = new Touch({ identifier: id, target: app, clientX: x, clientY: y });
    app.dispatchEvent(new TouchEvent(type, { changedTouches: [t], touches: type === 'touchend' ? [] : [t], bubbles: true, cancelable: true }));
  };
  const centre = (id: string) => { const r = document.getElementById(id)!.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const res: Record<string, unknown> = {};
  const pad = () => { w.advance(1); const p = w.game.heroes[0].pad; return `${p.x},${p.y} ${p.attack ? 'A' : ''}${p.jump ? 'J' : ''}${p.magic ? 'M' : ''}`; };
  // stick: touch left side, drag right
  fire('touchstart', 1, 100, 300); fire('touchmove', 1, 160, 300); res.stickRight = pad();
  fire('touchmove', 1, 140, 250); res.stickUpRight = pad();
  fire('touchend', 1, 140, 250); res.released = pad();
  // seam between attack and jump
  const [ax, ay] = centre('btn-attack'), [jx, jy] = centre('btn-jump'), [mx, my] = centre('btn-magic');
  fire('touchstart', 2, (ax + jx) / 2, (ay + jy) / 2); res.seam = pad(); fire('touchend', 2, (ax + jx) / 2, (ay + jy) / 2); pad();
  // slide from attack onto magic: must not cast
  fire('touchstart', 3, ax, ay); res.attack = pad(); fire('touchmove', 3, mx, my); res.slideToMagic = pad(); fire('touchend', 3, mx, my); pad();
  // fresh touch on magic
  fire('touchstart', 4, mx, my); res.magic = pad(); fire('touchend', 4, mx, my); pad();
  // slide jump -> attack
  fire('touchstart', 5, jx, jy); res.jump = pad(); fire('touchmove', 5, ax, ay); res.slideToAttack = pad(); fire('touchend', 5, ax, ay); w.advance(40);
  // double flick right = run
  const h = w.game.heroes[0];
  fire('touchstart', 6, 100, 300); fire('touchmove', 6, 160, 300); w.advance(5); fire('touchmove', 6, 102, 300); w.advance(4); fire('touchmove', 6, 160, 300); w.advance(20);
  res.afterDoubleFlick = h.state;
  fire('touchend', 6, 160, 300); w.advance(20);
  // single long push: walking only
  fire('touchstart', 7, 100, 300); fire('touchmove', 7, 160, 300); w.advance(30); res.singlePush = h.state; fire('touchend', 7, 160, 300);
  return res;
});
console.log(out);
await browser.close();
