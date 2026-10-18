// Magic spells, recorded from the original (tools/mame/magic.lua): for every tick after the
// cast, the effect objects on screen (frame, palette, flip, position relative to the caster)
// and how bright the background palette is, so the port can replay them around its hero.
import { readDump, u16, u32, s16, type Frame } from './dumpfile';
import { rgb } from './render16b';

export interface Spell {
  /** per tick: brightness (0..255 per channel, 128 = unchanged) then sprites [frame, pal, flip, dx, dz, dy] */
  ticks: { tint: [number, number, number]; sprites: number[][] }[];
}

function brightness(f: Frame): [number, number, number] {
  const s = [0, 0, 0];
  for (let i = 0; i < 1024; i++) {
    const c = rgb(u16(f.pal, i * 2));
    s[0] += c[0]; s[1] += c[1]; s[2] += c[2];
  }
  return s.map((v) => v / 1024) as [number, number, number];
}

export function recordSpell(path: string): Spell {
  const ticks: Spell['ticks'] = [];
  let caster: [number, number, number] | null = null;
  let base: [number, number, number] | null = null;
  let idle = -1;
  const before = new Set<number>();
  for (const f of readDump(path)) {
    const b = brightness(f);
    if (!base) {
      base = b;
      idle = u32(f.work, 0x28);
      // whatever is already on screen (scenery, the old man) is not part of the spell
      for (let o = 0x80; o < 0x2000; o += 0x80) if (u16(f.work, o) & 0x8000) before.add(o);
      continue;
    }
    // from when the caster's magic script starts
    if (!caster && u32(f.work, 0x28) === idle) continue;
    if (!caster) caster = [s16(f.work, 0x10), s16(f.work, 0x14), s16(f.work, 0x18)];
    const sprites: number[][] = [];
    for (let o = 0x80; o < 0x2000; o += 0x80) {
      if (!(u16(f.work, o) & 0x8000) || before.has(o)) continue;
      const fr = u16(f.work, o + 6);
      // (0x264 is the old man lying at the start of stage 1, not part of the spell)
      if (!fr || fr >= 0x499 || fr === 0x264 || u32(f.work, o + 2) === 0xaee2) continue;
      if (o >= 0x400 && f.work[o + 0x70] > 0) continue; // enemies and other characters
      if (!(f.work[o] & 0x08)) continue; // not drawn this frame
      sprites.push([fr, f.work[o + 0xb], f.work[o] & 1, s16(f.work, o + 0x10) - caster[0], s16(f.work, o + 0x14) - caster[1], s16(f.work, o + 0x18) - caster[2]]);
    }
    ticks.push({ tint: b.map((v, i) => Math.round((128 * v) / Math.max(1, base![i]))) as [number, number, number], sprites });
  }
  // drop the quiet tail
  while (ticks.length && !ticks[ticks.length - 1].sprites.length && ticks[ticks.length - 1].tint.every((v) => Math.abs(v - 128) < 3)) ticks.pop();
  return { ticks };
}
