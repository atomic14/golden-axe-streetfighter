// The story maps between areas, as videos: in a recording made with MAPS=1 (tools/mame/bot.lua
// records only the scenes without the HUD, every frame), find each stretch where the parchment
// is on screen -- it zooms in, a quill draws the route in red while the story types out beside
// it -- and encode it -> public/assets/map<n>.mp4 (n = the area about to start). The game plays
// the map music over it.  usage: tsx tools/map-videos.ts <rom> <dump>...
import { spawn } from 'node:child_process';
import { readDump } from './dumpfile';
import { loadRoms } from './rom';
import { renderFrame } from './render16b';

const [rom, ...dumps] = process.argv.slice(2);
const roms = loadRoms(rom);
const done = new Set<number>();

/** the parchment (warm, light pixels) on black */
function isMap(px: Uint8Array) {
  let n = 0, black = 0;
  for (let i = 0; i < px.length; i += 16) {
    if (px[i] > 150 && px[i] > px[i + 2] + 40 && px[i + 1] > 110) n++;
    if (px[i] + px[i + 1] + px[i + 2] < 24) black++;
  }
  return n > 100 && black > px.length / 16 * 0.4;
}

async function encode(frames: Uint8Array[], out: string) {
  const ff = spawn('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '320x224', '-r', '60.054', '-i', '-',
    '-vf', 'scale=640:448:flags=neighbor,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-preset', 'slow',
    '-an', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (const px of frames) if (!ff.stdin.write(Buffer.from(px.buffer))) await new Promise((r) => ff.stdin.once('drain', r));
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`${out}: ${frames.length} frames`);
}

for (const dump of dumps) {
  let run: Uint8Array[] = [], area = -1, last = -1;
  const flush = async () => {
    // a map scene: the area it leads to is the one after the area being left
    // (the first one found for each area wins: after the ending, attract mode replays scenes)
    if (run.length > 120 && area + 1 >= 1 && area + 1 <= 4 && !done.has(area + 1)) {
      done.add(area + 1);
      await encode(run, `public/assets/map${area + 1}.mp4`);
    }
    run = [];
  };
  for (const f of readDump(dump)) {
    if (f.frame !== last + 1) await flush();
    last = f.frame;
    const px = renderFrame(f, roms.tiles, roms.sprites, f.work[0xec95 - 0xc000]);
    if (isMap(px)) {
      if (!run.length) area = f.work[0xed4a - 0xc000];
      run.push(px.slice());
    } else if (run.length) await flush();
  }
  await flush();
}
