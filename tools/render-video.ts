// Render a stretch of a MAME RAM recording to a video with its sound (for the ending sequence).
// usage: tsx tools/render-video.ts <rom> <dump> <wav> <from> <to> <out.mp4>
import { spawn } from 'node:child_process';
import { readDump } from './dumpfile';
import { loadRoms } from './rom';
import { renderFrame } from './render16b';

const [rom, dump, wav, fromS, toS, out] = process.argv.slice(2);
const roms = loadRoms(rom);
const from = Number(fromS), to = Number(toS);
const FPS = 60.054;
const ff = spawn('ffmpeg', [
  '-loglevel', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '320x224', '-r', String(FPS), '-i', '-',
  '-ss', String(from / FPS), '-t', String((to - from) / FPS), '-i', wav,
  '-vf', 'scale=640:448:flags=neighbor,fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow',
  '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-movflags', '+faststart', out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
let n = 0;
for (const f of readDump(dump)) {
  if (f.frame < from || f.frame >= to) continue;
  const px = renderFrame(f, roms.tiles, roms.sprites, f.work[0xec95 - 0xc000]);
  if (!ff.stdin.write(Buffer.from(px.buffer))) await new Promise((r) => ff.stdin.once('drain', r));
  n++;
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log(`${n} frames -> ${out}`);
