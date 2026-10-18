// The character select screen's background (the skull), without its sprites or text.
// usage: tsx tools/select-bg.ts <rom> <dump> <frame>
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { readDump } from './dumpfile';
import { loadRoms } from './rom';
import { renderFrame } from './render16b';
const [rom, dump, frameS] = process.argv.slice(2);
const roms = loadRoms(rom);
for (const f of readDump(dump)) {
  if (f.frame < Number(frameS)) continue;
  const png = new PNG({ width: 320, height: 224 });
  png.data.set(renderFrame(f, roms.tiles, roms.sprites, f.work[0xec95 - 0xc000], { sprites: false, text: false }));
  writeFileSync('public/assets/select.png', PNG.sync.write(png));
  break;
}
