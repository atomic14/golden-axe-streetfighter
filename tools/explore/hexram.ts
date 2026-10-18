// Hex dump work RAM (0xffc000 base) range for given frames.
import { readDump } from '../dumpfile';
const [path, fromS, lenS, ...fr] = process.argv.slice(2);
const from = parseInt(fromS, 16) - 0xffc000, len = parseInt(lenS, 16);
const want = new Set(fr.map(Number));
for (const f of readDump(path)) {
  if (!want.has(f.frame)) continue;
  console.log('frame', f.frame);
  for (let o = from; o < from + len; o += 32) {
    const words: string[] = [];
    for (let i = 0; i < 32; i += 2) words.push(((f.work[o + i] << 8) | f.work[o + i + 1]).toString(16).padStart(4, '0'));
    console.log((o + 0xffc000).toString(16), words.join(' '));
  }
}
