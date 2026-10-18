// Which sprite frames/palettes does each spawn init routine produce? Uses a playthrough dump.
import { readDump, u16, u32 } from '../dumpfile';
import { loadRoms } from '../rom';
import { spawns, AREAS } from '../spawns';
import { rl } from '../rom';
const [rom, dump] = process.argv.slice(2);
const { prog } = loadRoms(rom);
const lists = spawns(prog);
const starts = Array.from({ length: AREAS }, (_, a) => rl(prog, 0x38ee2 + a * 4));
const info = new Map<number, { frames: Map<number, number>; pals: Set<number>; params: Set<number>; n: number }>();
let prevPtr = 0, prevActive = new Set<number>();
const live = new Map<number, number>(); // slot -> init
for (const f of readDump(dump)) {
  const area = f.work[0xed4a - 0xc000];
  const ptr = u32(f.work, 0xed56 - 0xc000);
  const active = new Set<number>();
  for (let o = 0x400; o < 0x2000; o += 0x80) if (u16(f.work, o) & 0x8000) active.add(o);
  if (ptr !== prevPtr && area < AREAS && ptr > starts[area] && ptr - starts[area] < 12 * 200) {
    const from = prevPtr > starts[area] && prevPtr < ptr ? (prevPtr - starts[area]) / 12 : (ptr - starts[area]) / 12 - 1;
    const entries = lists[area].slice(from, (ptr - starts[area]) / 12);
    const fresh = [...active].filter((o) => !prevActive.has(o) && u32(f.work, o + 2) !== 0xaee2).sort((a, b) => a - b);
    entries.forEach((e, i) => {
      if (fresh[i] === undefined) return;
      live.set(fresh[i], e.init);
      if (!info.has(e.init)) info.set(e.init, { frames: new Map(), pals: new Set(), params: new Set(), n: 0 });
      info.get(e.init)!.n++;
      info.get(e.init)!.params.add(e.param);
    });
  }
  for (const [o, init] of live) {
    if (!active.has(o)) { live.delete(o); continue; }
    const r = info.get(init)!;
    const fr = u16(f.work, o + 6);
    r.frames.set(fr, (r.frames.get(fr) ?? 0) + 1);
    r.pals.add(f.work[o + 0xb]);
  }
  prevPtr = ptr; prevActive = active;
}
for (const [init, r] of [...info].sort((a, b) => a[0] - b[0])) {
  const top = [...r.frames].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k.toString(16));
  console.log(init.toString(16).padStart(6), `n${r.n}`, 'pals', [...r.pals].map((p) => p.toString(16)).join(','), 'params', [...r.params].map((p) => p.toString(16)).join(','), 'frames', top.join(' '));
}
