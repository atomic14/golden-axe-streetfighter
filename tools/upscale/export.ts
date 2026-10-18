// Export every sprite frame for an AI upscaler: each frame in full colour (transparent where
// the hardware is), drawn with the palette the original most often used for it -- counted from
// the objects (+6 frame, +0b palette) in playthrough recordings -- and that palette, so the
// upscaled result can be mapped back to the game's pens (tools/upscale/upscale.py).
// usage: tsx tools/upscale/export.ts <rom> <out dir> <dump>...
import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { readDump, u16 } from '../dumpfile';
import { loadRoms } from '../rom';
import { frameDefs, framePixels, spritePalette } from '../sprites';
import { rgb } from '../render16b';

const [rom, out, ...dumps] = process.argv.slice(2);
const roms = loadRoms(rom);
mkdirSync(`${out}/in`, { recursive: true });

// frame -> palette -> how often seen
const seen = new Map<number, Map<number, number>>();
for (const dump of dumps) {
  for (const f of readDump(dump)) {
    for (let o = 0; o < 0x2000; o += 0x80) {
      if (!(u16(f.work, o) & 0x8000)) continue;
      const fr = u16(f.work, o + 6), pal = f.work[o + 0xb];
      if (!fr || fr >= 0x499) continue;
      const m = seen.get(fr) ?? new Map<number, number>();
      m.set(pal, (m.get(pal) ?? 0) + 1);
      seen.set(fr, m);
    }
  }
}
const best = (fr: number) => {
  const m = seen.get(fr);
  if (!m) return null;
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

const defs = frameDefs(roms.prog);
const meta: Record<number, { pal: number; seen: boolean; w: number; h: number; colors: number[][] }> = {};
let lastPal = 0x13;
for (const d of defs) {
  if (!d.w || !d.h) continue;
  // frames never seen in the recordings take the palette of the frame before (neighbours are
  // usually the same character)
  const p = best(d.index);
  const pal = p ?? lastPal;
  if (p !== null) lastPal = p;
  const colors = spritePalette(roms.prog, pal).map((v) => rgb(v));
  const px = framePixels(roms.sprites, d);
  const png = new PNG({ width: d.w, height: d.h });
  for (let i = 0; i < px.length; i++) {
    const k = px[i];
    if (!k) continue;
    png.data.set([...colors[k], 255], i * 4);
  }
  writeFileSync(`${out}/in/f${d.index.toString(16).padStart(3, '0')}.png`, PNG.sync.write(png));
  meta[d.index] = { pal, seen: p !== null, w: d.w, h: d.h, colors };
}
writeFileSync(`${out}/frames.json`, JSON.stringify(meta));
const n = Object.keys(meta).length, s = Object.values(meta).filter((m) => m.seen).length;
console.log(`${n} frames exported, ${s} with a palette seen in the recordings`);
