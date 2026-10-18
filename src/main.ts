import './style.css';
import { loadAssets, loadHd, loadHdArea } from './assets';
import { initGfx, setScale, scale, W, H, ctx, drawText } from './gfx';
import { input } from './input';
import { audio } from './audio';
import { Versus } from './game/versus';
import { Enemy, KINDS } from './game/enemy';
import { spawnActor } from './game/spawn';
import { Thief } from './game/props';
import { Brain } from './game/partner';
import { Filter } from './filter';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
initGfx(canvas);
const filter = new Filter(canvas);

/** Scale the 320x224 screen to fit; on touch screens in portrait leave the lower part for the controls. */
function layout() {
  const vw = innerWidth, vh = innerHeight;
  const touch = document.body.classList.contains('touch');
  const portrait = vh > vw;
  const availH = portrait && touch ? vh * 0.55 : vh;
  const scale = Math.min(vw / W, availH / H);
  const s = scale >= 2 ? Math.floor(scale * 2) / 2 : scale;
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
  const app = document.getElementById('app')!;
  app.style.justifyContent = portrait && touch ? 'flex-start' : 'center';
  app.style.paddingTop = portrait && touch ? `max(env(safe-area-inset-top), ${Math.round(vh * 0.05)}px)` : '0';
  input.layoutTouch();
  filter.fit();
}
addEventListener('resize', layout);
new MutationObserver(layout).observe(document.body, { attributes: true, attributeFilter: ['class'] });

const TICK = 1 / 60;

async function boot() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  input.init();
  layout();
  void audio.init();
  await loadAssets();
  const game = new Versus();
  // debug: advance the game by n ticks regardless of display refresh (used by automated tests)
  Object.assign(window, {
    game,
    audio,
    // for tests that set up fights (the same module instances the game uses)
    mods: { Enemy, KINDS, spawnActor, Thief, Brain },
    filter,
    advance(n: number) {
      for (let i = 0; i < n; i++) {
        input.poll();
        game.update();
      }
      game.draw();
      filter.render();
    },
  });
  let last = performance.now(), acc = 0;
  const frame = (now: number) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= TICK) {
      input.poll();
      if (input.pressed.select) toggleFilter();
      game.update();
      acc -= TICK;
    }
    game.draw();
    filter.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') audio.toggleMute();
    if (e.code === 'KeyF' && !e.repeat) toggleFilter();
    // cheat: preview the ending
    if (e.code === 'KeyE' && !e.repeat && game.state !== 'ending') game.startEnding();
  });
  // display filters: F, a gamepad's Select / Back or the HD button cycles them; remembered
  const btn = document.getElementById('btn-filter')!;
  const applied = async (say: boolean) => {
    // HD art: load the upscaled sprites the first time, and draw at their scale
    if (filter.hd) {
      const hd = await loadHd();
      if (!hd) {
        filter.cycle();
        return applied(say);
      }
      if (scale !== hd.scale) setScale(hd.scale);
      // and the area's upscaled backgrounds
      if (game.stage) await loadHdArea(game.stage.area);
    } else if (scale !== 1) setScale(1);
    game.stage?.buildLayers();
    btn.classList.toggle('on', filter.mode > 0);
    try {
      localStorage.setItem('ga.filter', filter.name);
    } catch {
      // not remembered, then
    }
    if (say) game.toast(filter.modes.length > 1 ? `DISPLAY: ${filter.name}` : 'FILTERS NOT AVAILABLE');
  };
  const toggleFilter = () => {
    filter.cycle();
    void applied(true);
  };
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('ga.filter');
  } catch {
    // private window or storage blocked
  }
  filter.setMode(saved ?? 'CRT'); // CRT by default; F cycles, and the choice is remembered
  void applied(false);
  btn.addEventListener('touchstart', (e) => {
    toggleFilter();
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
  btn.addEventListener('click', toggleFilter);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'fight') game.paused = true;
  });
}

boot().catch((err) => {
  console.error(err);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f44';
  ctx.font = '10px monospace';
  ctx.fillText(String(err.message ?? err), 8, 20);
  ctx.fillText('Run: npm run extract -- /path/to/goldnaxe.zip', 8, 36);
  void drawText;
});
