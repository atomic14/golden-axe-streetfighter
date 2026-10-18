// Animation scripts in the program ROM: u16 count, then count records of
//   dur u8, flags u8 (bit 0 h-flip, bit 1 v-flip), dx s16, dy s16 (display offset),
//   box x1 x2 y1 y2 (s8, hit box relative to the object), frame u16
// (interpreter at 0xbd54). Found by scanning for well-formed scripts that something points at.
import { rw, rs, rl } from './rom';
import { FRAME_COUNT } from './sprites';

export interface AnimStep { dur: number; flags: number; dx: number; dy: number; box: [number, number, number, number]; frame: number }

export function parseAnim(prog: Uint8Array, at: number): AnimStep[] | null {
  const n = rw(prog, at);
  if (n < 1 || n > 64 || at + 2 + n * 12 > prog.length) return null;
  const steps: AnimStep[] = [];
  for (let i = 0; i < n; i++) {
    const r = at + 2 + i * 12;
    const s: AnimStep = {
      dur: prog[r], flags: prog[r + 1], dx: rs(prog, r + 2), dy: rs(prog, r + 4),
      box: [0, 1, 2, 3].map((k) => (prog[r + 6 + k] << 24) >> 24) as [number, number, number, number],
      frame: rw(prog, r + 10),
    };
    if (s.dur === 0 || s.flags > 3 || s.frame >= FRAME_COUNT || Math.abs(s.dx) > 160 || Math.abs(s.dy) > 160) return null;
    steps.push(s);
  }
  return steps;
}

/** All animation scripts referenced by a 32-bit pointer somewhere in the program ROM. */
export function findAnims(prog: Uint8Array, extra: number[] = []): Map<number, AnimStep[]> {
  const out = new Map<number, AnimStep[]>();
  const cands = new Set<number>(extra);
  for (let o = 0; o + 4 <= prog.length; o += 2) {
    const v = rl(prog, o);
    if (v >= 0x400 && v < 0x80000 && !(v & 1)) cands.add(v);
  }
  for (const a of cands) {
    const s = parseAnim(prog, a);
    if (s) out.set(a, s);
  }
  return out;
}

/** Scripts are mostly stored back to back: follow each known script to the next one. */
export function chainAnims(prog: Uint8Array, known: Map<number, AnimStep[]>): Map<number, AnimStep[]> {
  const out = new Map(known);
  const queue = [...known.keys()];
  while (queue.length) {
    const a = queue.pop()!;
    const s = out.get(a)!;
    let next = a + 2 + s.length * 12;
    // enemy blocks end each script with a 10-byte "ffff 0000 00ff 0000 0000" trailer
    if (rw(prog, next) === 0xffff) next += 10;
    if (out.has(next)) continue;
    const t = parseAnim(prog, next);
    if (t) {
      out.set(next, t);
      queue.push(next);
    }
  }
  return out;
}

/** Brute force: any address holding a well-formed script that ends exactly at a trailer or another script. */
export function scanAnims(prog: Uint8Array): Map<number, AnimStep[]> {
  const valid = new Map<number, AnimStep[]>();
  for (let a = 0x400; a < prog.length - 14; a += 2) {
    const s = parseAnim(prog, a);
    if (s) valid.set(a, s);
  }
  const out = new Map<number, AnimStep[]>();
  for (const [a, s] of valid) {
    const end = a + 2 + s.length * 12;
    const trailer = rw(prog, end) === 0xffff && rw(prog, end + 2) === 0 && rw(prog, end + 4) === 0x00ff;
    if (trailer || valid.has(end)) out.set(a, s);
  }
  return out;
}

/**
 * The 8 bytes before every script: [reaction, damage, ?, active step, attack box x1 x2 y1 y2]
 * (s8). While the step with that index plays, the box (relative to the displayed position,
 * facing right) hits any target whose body box it overlaps within 6px of depth (0xad26).
 * Returns [reaction, damage, step, x1, x2, y1, y2], or null for scripts that don't attack.
 */
export function attackHeader(prog: Uint8Array, at: number, steps: number): number[] | null {
  const s8 = (o: number) => (prog[o] << 24) >> 24;
  const step = s8(at - 5);
  const h = [prog[at - 8], prog[at - 7], step, s8(at - 4), s8(at - 3), s8(at - 2), s8(at - 1)];
  // reactions seen: 1, 2 hurt; 3, 4 kneed; 5 knocked down; 6 thrown; 0xc knocked flying
  if (step < 0 || step >= steps || !h[1] || ![1, 2, 3, 4, 5, 6, 0xc].includes(h[0]) || h[3] >= h[4] || h[5] >= h[6]) return null;
  return h;
}
