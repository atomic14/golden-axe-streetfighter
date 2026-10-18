// Contact sheet of rendered frames from a RAM dump: dumpsheet <rom> <dump> <out.png> <from> <to> <step> [cols]
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { readDump } from '../dumpfile';
import { loadRoms } from '../rom';
import { renderFrame } from '../render16b';
const [rom, dump, out, fromS, toS, stepS, colsS] = process.argv.slice(2);
const roms = loadRoms(rom);
const from = Number(fromS), to = Number(toS), step = Number(stepS), cols = Number(colsS ?? 6);
const frames: Uint8Array[] = [];
for (const f of readDump(dump)) if (f.frame >= from && f.frame <= to && (f.frame - from) % step === 0) frames.push(renderFrame(f, roms.tiles, roms.sprites, f.work[0xec95 - 0xc000]));
const S = 2; // downscale
const w = 320 / S, h = 224 / S, rows = Math.ceil(frames.length / cols);
const png = new PNG({ width: w * cols, height: h * rows });
frames.forEach((px, i) => {
  const ox = (i % cols) * w, oy = Math.floor(i / cols) * h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y * S) * 320 + x * S) * 4, d = ((oy + y) * png.width + ox + x) * 4;
    png.data[d] = px[s]; png.data[d + 1] = px[s + 1]; png.data[d + 2] = px[s + 2]; png.data[d + 3] = 255;
  }
});
writeFileSync(out, PNG.sync.write(png));
