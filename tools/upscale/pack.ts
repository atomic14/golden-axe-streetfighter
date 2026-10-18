// Pack upscaled sprite frames (tools/upscale/upscale.py, pens as grey) into HD atlas pages in
// the same indexed format as the 1x atlas (pen * 17, recoloured at run time):
// public/assets/hd/sprites-<n>.png and hd/sprites.json { scale, pages, size, frames }, where
// frames[i] = [page, x, y, w, h, ox, oy]: the trimmed image in the atlas (in HD pixels) and its
// offset from the frame's anchor (horizontal centre, feet) in game pixels.
// usage: tsx tools/upscale/pack.ts <rom> <upscaled dir> [scale=4]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import { loadRoms } from '../rom';
import { frameDefs } from '../sprites';
import { pack, type Rect } from '../pack';

const [rom, dir, scaleS = '4'] = process.argv.slice(2);
const S = Number(scaleS), SIZE = 4096, OUT = 'public/assets/hd';
const roms = loadRoms(rom);
mkdirSync(OUT, { recursive: true });

type R = Rect & { index: number; png: PNG; sx: number; sy: number; ox: number; oy: number };
const rects: R[] = [];
for (const f of frameDefs(roms.prog)) {
  const p = `${dir}/f${f.index.toString(16).padStart(3, '0')}-pens.png`;
  if (!existsSync(p) || f.w * f.h < 4) continue;
  const png = PNG.sync.read(readFileSync(p));
  let x0 = png.width, y0 = png.height, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4]) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (x1 < 0) continue;
  rects.push({ index: f.index, png, w: x1 - x0 + 1, h: y1 - y0 + 1, sx: x0, sy: y0, ox: x0 / S - f.w / 2, oy: y0 / S - f.h });
}
const pages = pack(rects, SIZE);
const pngs = Array.from({ length: pages }, () => new PNG({ width: SIZE, height: SIZE }));
const frames: Record<number, number[]> = {};
for (const r of rects) {
  const out = pngs[r.page!];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const pen = r.png.data[((r.sy + y) * r.png.width + r.sx + x) * 4];
    if (!pen) continue;
    const o = ((r.y! + y) * SIZE + r.x! + x) * 4;
    out.data[o] = out.data[o + 1] = out.data[o + 2] = pen * 17;
    out.data[o + 3] = 255;
  }
  frames[r.index] = [r.page!, r.x!, r.y!, r.w, r.h, r.ox, r.oy];
}
pngs.forEach((png, i) => writeFileSync(`${OUT}/sprites-${i}.png`, PNG.sync.write(png, { colorType: 6 })));
writeFileSync(`${OUT}/sprites.json`, JSON.stringify({ scale: S, pages, size: SIZE, frames }));
console.log(`${rects.length} frames on ${pages} pages of ${SIZE}`);
