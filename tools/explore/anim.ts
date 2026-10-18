// Parse animations: u16 count, then count x { dur u8, flags u8, dx s16, dy s16, box x1 x2 y1 y2 (s8), frame u16 }
import { loadRoms, rw, rs } from '../rom';
const [p, ...addrs] = process.argv.slice(2);
const { prog } = loadRoms(p);
for (const a of addrs) {
  const o = parseInt(a, 16);
  const n = rw(prog, o);
  console.log(`anim ${a} count ${n}`);
  for (let i = 0; i < Math.min(n, 40); i++) {
    const r = o + 2 + i * 12;
    const box = [...prog.slice(r + 6, r + 10)].map((b) => (b << 24) >> 24);
    console.log(`  dur ${prog[r]} fl ${prog[r + 1]} dx ${rs(prog, r + 2)} dy ${rs(prog, r + 4)} box ${box.join(',')} frame ${rw(prog, r + 10).toString(16)}`);
  }
}
