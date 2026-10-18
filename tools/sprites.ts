// Sprite frames: the program ROM's frame table (0x61320) and the 4bpp sprite ROM.
import { rw, rl } from './rom';

export const FRAME_TABLE = 0x61320;
export const FRAME_COUNT = 0x499;

export interface FrameDef {
  index: number;
  /** byte address in sprite ROM */
  addr: number;
  w: number;
  h: number;
  rowBytes: number;
}

export function frameDefs(prog: Uint8Array): FrameDef[] {
  const out: FrameDef[] = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const e = FRAME_TABLE + i * 6;
    const d = FRAME_TABLE + rw(prog, e);
    const h = prog[d], rowBytes = prog[d + 1];
    out.push({ index: i, addr: rl(prog, e + 2), w: rowBytes * 2, h, rowBytes });
  }
  return out;
}

/**
 * Pixel indices (0..15; 0 and 15 are transparent) of a frame as the hardware shows it: w x h.
 * The sprite chip advances one row before drawing, so rows 1..h of the data are visible, and
 * a row ends at the first 4-pixel group whose last pixel is 15.
 */
export function framePixels(spr: Uint8Array, f: FrameDef): Uint8Array {
  const px = new Uint8Array(f.w * f.h);
  for (let y = 0; y < f.h; y++) {
    const row = f.addr + (y + 1) * f.rowBytes;
    for (let x = 0; x < f.w; x += 4) {
      const o = (row + x / 2) % spr.length;
      const g = [spr[o] >> 4, spr[o] & 15, spr[o + 1] >> 4, spr[o + 1] & 15];
      for (let k = 0; k < 4; k++) px[y * f.w + x + k] = g[k] === 15 ? 0 : g[k];
      if (g[3] === 15) break;
    }
  }
  return px;
}

/** Sprite palette `id` (an object's byte +0x0b): 14 colours for pens 1..14 at 0x37e04 + id*28. */
export const PALETTE_TABLE = 0x37e04;
export function spritePalette(prog: Uint8Array, id: number): number[] {
  const out: number[] = [0];
  for (let i = 0; i < 14; i++) out.push((prog[PALETTE_TABLE + id * 28 + i * 2] << 8) | prog[PALETTE_TABLE + id * 28 + i * 2 + 1]);
  out.push(0);
  return out;
}
