// Mounted animations: a beast script followed directly by a rider table with one entry per
// step: rider frame (bit 15 = flipped), dx, dy (signed bytes) relative to the beast.
import { rw } from './rom';
import { parseAnim, type AnimStep } from './anims';

export const isBeastFrame = (f: number) => (f >= 0xb5 && f <= 0xcb) || (f >= 0x265 && f <= 0x27d);

export interface MountAnim { addr: number; steps: AnimStep[]; rider: [number, boolean, number, number][] }

export function findMountAnims(prog: Uint8Array): MountAnim[] {
  const out: MountAnim[] = [];
  for (let a = 0x8000; a < 0x40000; a += 2) {
    const steps = parseAnim(prog, a);
    if (!steps || !steps.every((s) => isBeastFrame(s.frame))) continue;
    const t = a + 2 + steps.length * 12;
    const rider: MountAnim['rider'] = [];
    let ok = true;
    for (let i = 0; i < steps.length; i++) {
      const w = rw(prog, t + i * 4);
      const f = w & 0x7fff;
      if (f < 0x100 || f > 0x3ff || isBeastFrame(f)) { ok = false; break; }
      rider.push([f, !!(w & 0x8000), (prog[t + i * 4 + 2] << 24) >> 24, (prog[t + i * 4 + 3] << 24) >> 24]);
    }
    if (ok) out.push({ addr: a, steps, rider });
  }
  return out;
}
