// Summarise a moves log: per label, the animation pointers used (in order) and the motion.
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => l.split(' '));
let cur = '', seq: string[] = [], start: string[] = [], last: string[] = [];
const ys: number[] = [];
const flush = () => {
  if (!cur) return;
  const dx = Number(last[5]) - Number(start[5]), dz = Number(last[6]) - Number(start[6]);
  const n = Number(last[0]) - Number(start[0]) + 1;
  const ymin = Math.min(...ys), y0 = ys[0];
  console.log(`${cur.padEnd(18)} n${n} dx ${dx} dz ${dz} rise ${y0 - ymin}  anims ${seq.join(' > ')}`);
};
for (const r of rows) {
  if (r[1] !== cur) { flush(); cur = r[1]; seq = []; start = r; ys.length = 0; }
  if (seq[seq.length - 1] !== r[2]) seq.push(r[2]);
  ys.push(Number(r[7]));
  last = r;
}
flush();
