import { loadRoms, rw, rl } from '../rom';
const { prog } = loadRoms(process.argv[2]);
const T = 0x61320;
const from = Number(process.argv[3] ?? 0), n = Number(process.argv[4] ?? 40);
for (let i = from; i < from + n; i++) {
  const e = T + i * 6;
  const d = T + rw(prog, e), a = rl(prog, e + 2);
  const bytes = [...prog.slice(d, d + 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(i.toString(16).padStart(4, '0'), 'desc', d.toString(16), bytes, 'addr', a.toString(16));
}
