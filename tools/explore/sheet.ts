// Contact sheet of all sprite frames in grey, 16 per row, cell 128x136.
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadRoms } from '../rom';
import { frameDefs, framePixels } from '../sprites';
const [path, out, fromS, toS] = process.argv.slice(2);
const roms = loadRoms(path);
const defs = frameDefs(roms.prog).slice(Number(fromS ?? 0), Number(toS ?? 9999));
const CW = 130, CH = 140, COLS = 16;
const png = new PNG({ width: CW * COLS, height: CH * Math.ceil(defs.length / COLS) });
png.data.fill(40);
defs.forEach((f, n) => {
  const px = framePixels(roms.sprites, f);
  const ox = (n % COLS) * CW, oy = Math.floor(n / COLS) * CH;
  for (let y = 0; y < Math.min(f.h, CH); y++) for (let x = 0; x < Math.min(f.w, CW); x++) {
    const p = px[y * f.w + x];
    if (p === 0 || p === 15) continue;
    const o = ((oy + y) * png.width + ox + x) * 4;
    png.data[o] = png.data[o + 1] = png.data[o + 2] = 30 + p * 15;
  }
  // index tick marks: border colour by n%2
  for (let x = 0; x < CW; x++) { const o = ((oy + CH - 1) * png.width + ox + x) * 4; png.data[o] = 200; }
});
writeFileSync(out, PNG.sync.write(png));
