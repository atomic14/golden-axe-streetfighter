// Extracts the game data from the Golden Axe ROM set into public/assets.
//   npm run extract -- /path/to/goldnaxe.zip
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadRoms } from './rom';
import { frameDefs, framePixels, spritePalette } from './sprites';
import { pack, type Rect } from './pack';
import { scanAnims, findAnims, chainAnims, attackHeader, type AnimStep } from './anims';
import { rgb, tileCode, tilePixel } from './render16b';
import { captureStages, layerGrid } from './levels';
import { readDump } from './dumpfile';
import { findMountAnims } from './mounts';
import { recordSpell } from './magic';
import { existsSync } from 'node:fs';
import { spawns, spawnList, stops, AREAS } from './spawns';
import { rl } from './rom';

const romPath = process.argv[2];
// optional: playthrough recordings (comma-separated; tools/record-levels.sh) to rebuild the stage maps from
const dumpPath = process.argv[3];
if (!romPath) throw new Error('usage: npm run extract -- /path/to/goldnaxe.zip [playthrough.bin]');
const roms = loadRoms(romPath);
const OUT = 'public/assets';
mkdirSync(OUT, { recursive: true });

export const hex = (v: number) => {
  const [r, g, b] = rgb(v);
  return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
};

// ---- sprites: an indexed atlas (pen * 17 in the red channel) recoloured at run time -------
function sprites() {
  const defs = frameDefs(roms.prog);
  const rects: (Rect & { px: Uint8Array; sx: number; sy: number; fw: number })[] = [];
  const meta: number[][] = [];
  for (const f of defs) {
    const px = framePixels(roms.sprites, f);
    let x0 = f.w, y0 = f.h, x1 = -1, y1 = -1;
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (px[y * f.w + x]) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    rects.push({ w: x1 - x0 + 1, h: y1 - y0 + 1, px, sx: x0, sy: y0, fw: f.w });
    // offsets of the trimmed image from the anchor (horizontal centre, feet)
    meta.push([x0 - f.w / 2, y0 - f.h]);
  }
  const pages = pack(rects);
  const pngs = Array.from({ length: pages }, () => new PNG({ width: 2048, height: 2048 }));
  rects.forEach((r, i) => {
    const png = pngs[r.page!];
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const p = r.px[(r.sy + y) * r.fw + r.sx + x];
      if (!p) continue;
      const o = ((r.y! + y) * 2048 + r.x! + x) * 4;
      png.data[o] = png.data[o + 1] = png.data[o + 2] = p * 17;
      png.data[o + 3] = 255;
    }
    meta[i] = [r.page!, r.x!, r.y!, r.w, r.h, ...meta[i]];
  });
  pngs.forEach((png, i) => writeFileSync(`${OUT}/sprites-${i}.png`, PNG.sync.write(png, { colorType: 6 })));
  const palettes = Array.from({ length: 256 }, (_, id) => spritePalette(roms.prog, id).map(hex).join(''));
  console.log(`sprites: ${defs.length} frames on ${pages} pages`);
  return { pages, frames: meta, palettes };
}

// ---- animation scripts --------------------------------------------------------------------
/** Animation pointers objects actually used (+0x28) in the playthrough recordings. */
function recordedAnims(): number[] {
  const seen = new Set<number>();
  if (!dumpPath) return [];
  for (const p of dumpPath.split(',')) {
    for (const f of readDump(p.split('@')[0])) {
      for (let o = 0; o < 0x2000; o += 0x80) {
        if (!(f.work[o] & 0x80)) continue;
        const a = ((f.work[o + 0x28] << 24) | (f.work[o + 0x29] << 16) | (f.work[o + 0x2a] << 8) | f.work[o + 0x2b]) >>> 0;
        if (a >= 0x400 && a < 0x80000 && !(a & 1)) seen.add(a);
      }
    }
  }
  return [...seen];
}

function anims(): Record<string, (number | number[])[][]> {
  const found = findAnims(roms.prog, recordedAnims());
  const m = chainAnims(roms.prog, new Map([...found, ...scanAnims(roms.prog)]));
  const out: Record<string, (number | number[])[][]> = {};
  const enc = (s: AnimStep) => [s.frame, s.dur, s.flags, s.dx, s.dy, s.box];
  for (const [a, steps] of [...m].sort((x, y) => x[0] - y[0])) out[a.toString(16)] = steps.map(enc);
  console.log(`anims: ${m.size} scripts`);
  return out;
}

const spr = sprites();
// mounted scripts: the beast's steps plus, per step, the rider's [frame, flip, dx, dy]
const mountAnims = findMountAnims(roms.prog);
const riders: Record<string, [number, number, number, number][]> = {};
for (const m of mountAnims) riders[m.addr.toString(16)] = m.rider.map(([f, fl, dx, dy]) => [f, fl ? 1 : 0, dx, dy]);
const allAnims = anims();
for (const m of mountAnims) allAnims[m.addr.toString(16)] ??= m.steps.map((s) => [s.frame, s.dur, s.flags, s.dx, s.dy, s.box]);
console.log(`mounted scripts: ${mountAnims.length}`);
// attack headers: what each attacking script hits with, and when
const attacks: Record<string, number[]> = {};
for (const [a, steps] of Object.entries(allAnims)) {
  const h = attackHeader(roms.prog, parseInt(a, 16), steps.length);
  if (h) attacks[a] = h;
}
console.log(`attacking scripts: ${Object.keys(attacks).length}`);
writeFileSync(`${OUT}/sprites.json`, JSON.stringify({ ...spr, anims: allAnims, riders, attacks }));

// ---- tiles: an indexed atlas (pen * 32) of the text font and every tile the stages use ------
const tileIndex = new Map<number, number>();
const tileList: number[] = [];
function tileId(code: number) {
  let i = tileIndex.get(code);
  if (i === undefined) { i = tileList.length; tileIndex.set(code, i); tileList.push(code); }
  return i;
}
for (let c = 0; c < 0x200; c++) tileId(c); // text layer font (bank 0)

const b64 = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const fitLine = (xs: number[], ys: number[]) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const a = sxx ? Math.round((sxy / sxx) * 1000) / 1000 : 1;
  return [a, Math.round(my - a * mx)];
};

function levels() {
  if (!dumpPath) { console.log('levels: skipped (no playthrough recording given)'); return; }
  mkdirSync(`${OUT}/areas`, { recursive: true });
  const caps = captureStages(dumpPath.split(','));
  const allSpawns = spawns(roms.prog);
  for (let a = 0; a < AREAS; a++) {
    const cap = caps.get(a);
    if (!cap) { console.log(`area ${a}: not in the recording`); continue; }
    // tile cells as u32: atlas index (16 bits) | palette (7 bits) << 16 | priority << 23
    const layer = (lc: typeof cap.fg) => {
      const g = layerGrid(lc);
      const cells = new Uint32Array(g.w * g.h);
      for (let i = 0; i < cells.length; i++) {
        const w = g.grid[i];
        cells[i] = w < 0 ? 0xffffffff : tileId(tileCode(w, cap.bank1)) | (((w >> 6) & 0x7f) << 16) | ((w >> 15) << 23);
      }
      return { x: g.x0 * 8, y: g.y0 * 8, w: g.w, h: g.h, cells: b64(cells) };
    };
    const S = cap.scroll;
    const palettes: Record<number, string> = {};
    // key 0 is the night palette of the bonus camp at the end of the area
    for (const [stage, pal] of cap.palettes) {
      const out = new Uint32Array(1024);
      for (let i = 0; i < 1024; i++) {
        const [r, g, b] = rgb((pal[i * 2] << 8) | pal[i * 2 + 1]);
        out[i] = (r << 16) | (g << 8) | b;
      }
      palettes[stage] = b64(out);
    }
    // the camera's vertical range at each horizontal position (8px buckets), as seen in play
    const camPath: Record<number, [number, number]> = {};
    for (const [fgU, fgV] of S) {
      const cx = -7 - fgU, cy = -512 - fgV, k = cx >> 3;
      const e = camPath[k];
      camPath[k] = e ? [Math.min(e[0], cy), Math.max(e[1], cy)] : [cy, cy];
    }
    const area = {
      fg: layer(cap.fg), bg: layer(cap.bg),
      // background scroll = a * foreground scroll + b (per axis)
      parallax: [fitLine(S.map((r) => r[0]), S.map((r) => r[2])), fitLine(S.map((r) => r[1]), S.map((r) => r[3]))],
      height: b64(cap.height), palettes, camPath,
      cam: [cap.camMin, cap.camMax],
      stops: stops(roms.prog, a), spawns: allSpawns[a].map((s) => [s.trigger, s.x, s.z, s.param, s.init]),
      // the bonus camp at the end of the area (table 0x38ef6): thieves come for the potions
      camp: spawnList(roms.prog, rl(roms.prog, 0x38ef6 + a * 4)).map((s) => [s.trigger, s.x, s.z, s.param, s.init]),
    };
    writeFileSync(`${OUT}/areas/${a}.json`, JSON.stringify(area));
    console.log(`area ${a}: fg ${area.fg.w * 8}x${area.fg.h * 8}, bg ${area.bg.w * 8}x${area.bg.h * 8}, stages ${Object.keys(palettes)}`);
  }
}
levels();

function tiles() {
  const cols = 128, rows = Math.ceil(tileList.length / cols);
  const png = new PNG({ width: cols * 8, height: rows * 8 });
  tileList.forEach((code, i) => {
    const ox = (i % cols) * 8, oy = Math.floor(i / cols) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = tilePixel(roms.tiles, code, x, y);
      const o = ((oy + y) * png.width + ox + x) * 4;
      png.data[o] = png.data[o + 1] = png.data[o + 2] = p * 32;
      png.data[o + 3] = 255;
    }
  });
  writeFileSync(`${OUT}/tiles.png`, PNG.sync.write(png, { colorType: 2 }));
  console.log(`tiles: ${tileList.length}`);
}
tiles();

// ---- magic: replay recordings made with tools/record-magic.sh (work/magic/<hero>-<level>.bin) ----
function magic() {
  const out: Record<string, number[][][][]> = {};
  for (const [hero, levels] of [['ax', 4], ['tyris', 6], ['gilius', 3]] as const) {
    out[hero] = [];
    for (let l = 1; l <= levels; l++) {
      const p = `work/magic/${hero}-${l}.bin`;
      if (!existsSync(p)) return console.log('magic: skipped (no recordings in work/magic)');
      out[hero].push(recordSpell(p).ticks.map((t) => t.sprites));
    }
  }
  writeFileSync(`${OUT}/magic.json`, JSON.stringify(out));
  console.log('magic: recorded spells for 3 heroes');
}
magic();
