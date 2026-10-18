// Print work RAM bytes whose value sequence over sampled frames changes rarely and matches a filter.
import { readDump } from '../dumpfile';
const [path, lo, hi, step] = process.argv.slice(2);
const L = parseInt(lo, 16) - 0xffc000, H = parseInt(hi, 16) - 0xffc000;
const seq: number[][] = [];
const frames: number[] = [];
for (const f of readDump(path)) {
  if (f.frame % Number(step ?? 60)) continue;
  frames.push(f.frame);
  seq.push([...f.work.slice(L, H)]);
}
for (let i = 0; i < H - L; i++) {
  const s = seq.map((r) => r[i]);
  const changes = s.filter((v, k) => k && v !== s[k - 1]).length;
  if (changes >= 1 && changes <= 6) console.log((i + L + 0xffc000).toString(16), s.join(' '));
}
