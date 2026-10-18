// Reader for MAME RAM dumps written by tools/mame/dump.lua.
import { readFileSync } from 'node:fs';

export interface Frame {
  frame: number;
  work: Uint8Array; // 16K work RAM at 0xffc000
  sprites: Uint8Array; // 2K
  text: Uint8Array; // 4K
  pal: Uint8Array; // 4K
  tile: Uint8Array; // 64K
  // note: the arrays are reused between frames; copy anything you keep
}

export function* readDump(path: string): Generator<Frame> {
  const buf = readFileSync(path);
  const regions = [new Uint8Array(0x4000), new Uint8Array(0x800), new Uint8Array(0x1000), new Uint8Array(0x1000), new Uint8Array(0x10000)];
  let p = 0;
  while (p + 8 <= buf.length) {
    if (buf.toString('latin1', p, p + 4) !== 'FRAM') throw new Error(`bad dump at ${p}`);
    const frame = buf.readUInt32BE(p + 4);
    p += 8;
    for (const r of regions) {
      if (p + 4 > buf.length) return;
      const n = buf.readUInt32BE(p);
      p += 4;
      if (p + n * 4 > buf.length) return;
      for (let i = 0; i < n; i++, p += 4) {
        const w = buf.readUInt16BE(p);
        r[w * 2] = buf[p + 2];
        r[w * 2 + 1] = buf[p + 3];
      }
    }
    const [work, sprites, text, pal, tile] = regions;
    yield { frame, work, sprites, text, pal, tile };
  }
}

export const u16 = (a: Uint8Array, o: number) => (a[o] << 8) | a[o + 1];
export const s16 = (a: Uint8Array, o: number) => ((u16(a, o) << 16) >> 16);
export const u32 = (a: Uint8Array, o: number) => ((u16(a, o) << 16) | u16(a, o + 2)) >>> 0;

export interface HwSprite {
  i: number; top: number; bottom: number; x: number; hide: boolean; flip: boolean; pitch: number;
  addr: number; bank: number; pri: number; pal: number; zoom: number;
}

/** Decode the System 16B sprite list. Screen x = x - 184 (MAME's origin), first row at y = top. */
export function sprites(f: Frame): HwSprite[] {
  const out: HwSprite[] = [];
  for (let i = 0; i < 128; i++) {
    const o = i * 16;
    const w2 = u16(f.sprites, o + 4);
    if (w2 & 0x8000) break;
    const w0 = u16(f.sprites, o), w4 = u16(f.sprites, o + 8);
    out.push({
      i, top: w0 & 0xff, bottom: w0 >> 8, x: u16(f.sprites, o + 2) & 0x1ff, hide: !!(w2 & 0x4000), flip: !!(w2 & 0x100),
      pitch: (w2 & 0xff) << 24 >> 24, addr: u16(f.sprites, o + 6), bank: (w4 >> 8) & 0xf, pri: (w4 >> 6) & 3, pal: w4 & 0x3f,
      zoom: u16(f.sprites, o + 10),
    });
  }
  return out;
}
