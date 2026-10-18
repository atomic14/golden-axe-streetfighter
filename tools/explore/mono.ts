// Find work RAM bytes that step up monotonically through a run (stage counters etc.).
import { readDump } from '../dumpfile';
const [path, stepS] = process.argv.slice(2);
const step = Number(stepS ?? 2000);
const seq: number[][] = [];
for (const f of readDump(path)) if (f.frame % step < 4) seq.push([...f.work]);
for (let i = 0; i < 0x4000; i++) {
  const s = seq.map((r) => r[i]);
  const ch = s.filter((v, k) => k && v !== s[k - 1]).length;
  const mono = s.every((v, k) => !k || v >= s[k - 1]);
  if (mono && ch >= 3 && ch <= 10 && s[s.length - 1] < 16) console.log((i + 0xffc000).toString(16), s.join(' '));
}
