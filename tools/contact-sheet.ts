// Labelled contact sheet of sprite frames: npx tsx tools/contact-sheet.ts <rom> <out.png> <from> <to> [palette]
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadRoms } from './rom';
import { frameDefs, framePixels, spritePalette } from './sprites';
import { rgb } from './render16b';

const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111',
  a: '111101111101101', b: '110101110101110', c: '111100100100111', d: '110101101101110', e: '111100111100111', f: '111100111100100',
};
const [rom, out, fromS, toS, palS] = process.argv.slice(2);
const roms = loadRoms(rom);
const defs = frameDefs(roms.prog).slice(parseInt(fromS, 16), parseInt(toS, 16) + 1);
const pal = palS ? spritePalette(roms.prog, parseInt(palS, 16)).map(rgb) : null;
const CW = 112, CH = 120, COLS = 12;
const png = new PNG({ width: CW * COLS, height: CH * Math.ceil(defs.length / COLS) });
for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 40; png.data[i + 1] = 60; png.data[i + 2] = 40; png.data[i + 3] = 255; }
const put = (x: number, y: number, r: number, g: number, b: number) => {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const o = (y * png.width + x) * 4; png.data[o] = r; png.data[o + 1] = g; png.data[o + 2] = b;
};
defs.forEach((f, n) => {
  const px = framePixels(roms.sprites, f);
  const ox = (n % COLS) * CW, oy = Math.floor(n / COLS) * CH;
  const sx = Math.max(0, Math.floor((f.w - CW) / 2)), sy = Math.max(0, f.h - (CH - 8));
  for (let y = 0; y < Math.min(f.h, CH - 8); y++) for (let x = 0; x < Math.min(f.w, CW); x++) {
    const p = px[(y + sy) * f.w + x + sx];
    if (!p) continue;
    const [r, g, b] = pal ? pal[p] : [p * 16, p * 16, p * 16];
    put(ox + x, oy + 8 + y, r, g, b);
  }
  const label = f.index.toString(16);
  [...label].forEach((ch, k) => {
    const bits = FONT[ch];
    for (let i = 0; i < 15; i++) if (bits[i] === '1') put(ox + 2 + k * 4 + (i % 3), oy + 1 + Math.floor(i / 3), 255, 255, 0);
  });
});
writeFileSync(out, PNG.sync.write(png));
