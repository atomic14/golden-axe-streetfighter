// Render captured stage layers to PNGs for inspection.
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadRoms } from '../rom';
import { captureStages, layerGrid } from '../levels';
import { rgb, tileCode, tilePixel } from '../render16b';
const [rom, dump] = process.argv.slice(2);
const roms = loadRoms(rom);
const stages = captureStages(dump.split(','));
for (const s of stages.values()) {
  const pal = [...s.palettes.values()][0];
  for (const [name, cap, opaque] of [['bg', s.bg, true], ['fg', s.fg, false]] as const) {
    const g = layerGrid(cap);
    const png = new PNG({ width: g.w * 8, height: g.h * 8 });
    for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
      const word = g.grid[ty * g.w + tx];
      if (word < 0) continue;
      const code = tileCode(word, s.bank1), cp = (word >> 6) & 0x7f;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = tilePixel(roms.tiles, code, x, y);
        if (!p && !opaque) continue;
        const v = (pal[(cp * 8 + p) * 2] << 8) | pal[(cp * 8 + p) * 2 + 1];
        const [r, gg, b] = rgb(v);
        const o = ((ty * 8 + y) * png.width + tx * 8 + x) * 4;
        png.data[o] = r; png.data[o + 1] = gg; png.data[o + 2] = b; png.data[o + 3] = 255;
      }
    }
    writeFileSync(`work/stage${s.stage}-${name}.png`, PNG.sync.write(png));
    console.log(`area ${s.stage} stages ${[...s.palettes.keys()]} ${name}: ${g.w * 8}x${g.h * 8} at ${g.x0 * 8},${g.y0 * 8}  frames ${s.frames} cam ${s.camMin} .. ${s.camMax}`);
  }
}
