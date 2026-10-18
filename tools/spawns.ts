// Enemy spawn scripts and scroll stops per area (set up at 0xc1c8, run at 0xc274).
//   0x38ea4: u16 offsets (from 0x38ea4) to each area's list of progress stops (u16, ends at 0x14c0)
//   0x38ee2: u32 per area -> spawn list of 12-byte entries:
//            trigger u16 (progress 0xffed32 must reach it), x u16, z u16, param u16 (-> +0x74),
//            init routine u32; 0xffff ends the list
import { rw, rl } from './rom';

export interface Spawn { trigger: number; x: number; z: number; param: number; init: number }

export const AREAS = 5;

export function stops(prog: Uint8Array, area: number): number[] {
  const base = 0x38ea4;
  let o = base + rw(prog, base + area * 2);
  const out: number[] = [];
  for (;;) {
    const v = rw(prog, o);
    out.push(v);
    o += 2;
    if (v >= 0x14c0 || out.length > 16) break;
  }
  return out;
}

export function spawnList(prog: Uint8Array, at: number): Spawn[] {
  const out: Spawn[] = [];
  for (let o = at; rw(prog, o) !== 0xffff && out.length < 200; o += 12) {
    out.push({ trigger: rw(prog, o), x: rw(prog, o + 2), z: rw(prog, o + 4), param: rw(prog, o + 6), init: rl(prog, o + 8) });
  }
  return out;
}

export function spawns(prog: Uint8Array, table = 0x38ee2): Spawn[][] {
  return Array.from({ length: AREAS }, (_, a) => spawnList(prog, rl(prog, table + a * 4)));
}
