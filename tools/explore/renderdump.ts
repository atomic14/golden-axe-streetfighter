import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { readDump } from '../dumpfile';
import { loadRoms } from '../rom';
import { renderFrame } from '../render16b';
const [rom, dump, out, ...fr] = process.argv.slice(2);
const roms = loadRoms(rom);
const want = new Set(fr.map(Number));
for (const f of readDump(dump)) {
  if (!want.has(f.frame)) continue;
  const png = new PNG({ width: 320, height: 224 });
  png.data.set(renderFrame(f, roms.tiles, roms.sprites, f.work[0xec95 - 0xc000]));
  writeFileSync(`${out}-${f.frame}.png`, PNG.sync.write(png));
}
