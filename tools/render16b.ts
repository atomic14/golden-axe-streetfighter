// Software renderer for System 16B frames from RAM dumps, used to validate formats and
// to capture level tilemaps. Follows MAME's segaic16 / sega16sp behaviour.
import type { Frame } from './dumpfile';
import { u16, sprites as spriteList } from './dumpfile';

export function rgb(v: number): [number, number, number] {
  const r = ((v >> 12) & 1) | ((v << 1) & 0x1e);
  const g = ((v >> 13) & 1) | ((v >> 3) & 0x1e);
  const b = ((v >> 14) & 1) | ((v >> 7) & 0x1e);
  const c = (x: number) => Math.round((x * 255) / 31);
  return [c(r), c(g), c(b)];
}

/** 3bpp tile pixel; tiles ROM = three 128K planes, plane at 0x40000 is the MSB. */
export function tilePixel(tiles: Uint8Array, code: number, x: number, y: number): number {
  const o = code * 8 + y, bit = 7 - x;
  return (((tiles[0x40000 + o] >> bit) & 1) << 2) | (((tiles[0x20000 + o] >> bit) & 1) << 1) | ((tiles[o] >> bit) & 1);
}

export interface LayerState { pages: number; xs: number; ys: number }

export function layerState(f: Frame, which: 0 | 1): LayerState {
  // 0 = foreground, 1 = background
  return { pages: u16(f.text, 0xe80 + which * 2), ys: u16(f.text, 0xe90 + which * 2), xs: u16(f.text, 0xe98 + which * 2) };
}

/** Tile word at virtual tilemap coordinate (vx, vy) in pixels (0..1023, 0..511). */
export function virtualTile(f: Frame, pages: number, vx: number, vy: number): number {
  const q = (vy >= 256 ? 2 : 0) + (vx >= 512 ? 1 : 0);
  const page = (pages >> (q * 4)) & 0xf;
  const tx = (vx & 511) >> 3, ty = (vy & 255) >> 3;
  return u16(f.tile, page * 0x1000 + (ty * 64 + tx) * 2);
}

export function tileCode(word: number, bank1: number): number {
  const code = word & 0x1fff;
  return code < 0x1000 ? code : bank1 * 0x1000 + (code & 0xfff);
}

export function renderFrame(f: Frame, tiles: Uint8Array, spr: Uint8Array, bank1: number, opts: { sprites?: boolean; text?: boolean } = {}): Uint8Array {
  const W = 320, H = 224;
  const out = new Uint8Array(W * H * 4);
  const idx = new Uint16Array(W * H); // palette index
  const pri = new Uint8Array(W * H);
  const layer = (which: 0 | 1, opaque: boolean, priVals: [number, number]) => {
    const st = layerState(f, which);
    for (let y = 0; y < H; y++) {
      const row = u16(f.text, 0xf80 + 0x40 * which + (y >> 3) * 2);
      const xs = st.xs & 0x8000 ? row : st.xs;
      const ex = (0xc0 - xs) & 0x3ff;
      for (let x = 0; x < W; x++) {
        let ys = st.ys;
        if (st.ys & 0x8000) ys = u16(f.text, 0xf16 + 0x40 * which + ((x + 8) >> 4) * 2);
        const vx = (x + ex) & 0x3ff, vy = (y + (ys & 0x1ff)) & 0x1ff;
        const w = virtualTile(f, st.pages, vx, vy);
        const p = tilePixel(tiles, tileCode(w, bank1), vx & 7, vy & 7);
        if (p === 0 && !opaque) continue;
        idx[y * W + x] = ((w >> 6) & 0x7f) * 8 + p;
        if (p || !opaque) pri[y * W + x] = priVals[w >> 15];
        else pri[y * W + x] = 0;
      }
    }
  };
  layer(1, true, [1, 2]);
  layer(0, false, [2, 4]);
  // text layer: 64x28 at textram 0, palette (data>>9)&7, code bank[0]
  if (opts.text !== false) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const w = u16(f.text, ((y >> 3) * 64 + (x >> 3) + 24) * 2);
    const p = tilePixel(tiles, w & 0x1ff, x & 7, y & 7);
    if (!p) continue;
    idx[y * W + x] = ((w >> 9) & 7) * 8 + p;
    pri[y * W + x] = w & 0x8000 ? 8 : 4;
  }
  // sprites: drawn in list order, later entries overwrite earlier ones
  const sbuf = new Int32Array(W * H).fill(-1);
  for (const s of opts.sprites === false ? [] : spriteList(f)) {
    if (s.hide || s.top >= s.bottom) continue;
    const base = (s.bank % 14) * 0x20000;
    // zoom shrinks a sprite by skipping source rows and pixels as accumulators carry (0 = full
    // size, 0x10 about half): vertical in bits 5-9, horizontal in bits 0-4
    const vzoom = (s.zoom >> 5) & 0x1f, hzoom = s.zoom & 0x1f;
    let addr = s.addr, yacc = 0;
    for (let y = s.top; y < s.bottom; y++) {
      addr = (addr + s.pitch) & 0xffff;
      yacc += vzoom;
      if (yacc & 0x20) {
        addr = (addr + s.pitch) & 0xffff;
        yacc &= 0x1f;
      }
      if (y >= H) continue;
      let a = s.flip ? addr + 1 : addr - 1, x = s.x - 184, xacc = 4 * hzoom;
      for (;;) {
        a = (a + (s.flip ? -1 : 1)) & 0xffff;
        const word = (spr[base + a * 2] << 8) | spr[base + a * 2 + 1];
        const px = s.flip ? [word & 15, (word >> 4) & 15, (word >> 8) & 15, word >> 12] : [word >> 12, (word >> 8) & 15, (word >> 4) & 15, word & 15];
        for (const p of px) {
          xacc = (xacc & 0x3f) + hzoom;
          if (xacc >= 0x40) continue;
          if (p !== 0 && p !== 15 && x >= 0 && x < W) sbuf[y * W + x] = (s.pri << 10) | (s.pal << 4) | p;
          x++;
        }
        // a row ends with the first group whose last pixel is 15
        if (px[3] === 15 || x > W + 512) break;
      }
    }
  }
  for (let i = 0; i < W * H; i++) {
    let c = idx[i], shadow = false;
    const s = sbuf[i];
    if (s >= 0 && 1 << ((s >> 10) & 3) > pri[i]) {
      if ((s & 0x3f0) === 0x3f0) shadow = true;
      else c = 0x400 + (s & 0x3ff);
    }
    const [r, g, b] = rgb(u16(f.pal, c * 2));
    const k = shadow ? 0.5 : 1;
    out[i * 4] = r * k; out[i * 4 + 1] = g * k; out[i * 4 + 2] = b * k; out[i * 4 + 3] = 255;
  }
  return out;
}
