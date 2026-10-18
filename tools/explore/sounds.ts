// Summarise a sound log from tools/mame/bot.lua (SNDLOG): which commands play, in which area,
// and from which code (the caller's return address).
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => l.split(' '));
const by = new Map<string, { n: number; areas: Set<string>; callers: Map<string, number> }>();
for (const [, area, , cmd, ret] of rows) {
  const e = by.get(cmd) ?? { n: 0, areas: new Set(), callers: new Map() };
  e.n++;
  e.areas.add(area);
  e.callers.set(ret, (e.callers.get(ret) ?? 0) + 1);
  by.set(cmd, e);
}
for (const [cmd, e] of [...by].sort()) {
  const callers = [...e.callers].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => `${c}x${n}`).join(' ');
  console.log(cmd, `n${e.n}`, `areas ${[...e.areas].join(',')}`, callers);
}
