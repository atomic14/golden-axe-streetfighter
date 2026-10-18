// Loads the Golden Axe (set 6, US, 8751) ROM set from a MAME zip or a directory of files.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

export interface Roms {
  /** 68000 program, 512K, big-endian words */
  prog: Uint8Array;
  /** tile ROMs: three 128K bitplanes */
  tiles: Uint8Array;
  /** sprite ROM as big-endian words, 0x20000 bytes per bank */
  sprites: Uint8Array;
  /** Z80 sound program and the banked sample ROM */
  sound: Uint8Array;
  samples: Uint8Array;
}

function files(path: string): Map<string, Uint8Array> {
  const m = new Map<string, Uint8Array>();
  if (statSync(path).isDirectory()) {
    for (const f of readdirSync(path)) m.set(f.toLowerCase(), new Uint8Array(readFileSync(join(path, f))));
  } else {
    for (const [k, v] of Object.entries(unzipSync(new Uint8Array(readFileSync(path))))) m.set(k.toLowerCase().split('/').pop()!, v);
  }
  return m;
}

export function loadRoms(path: string): Roms {
  const f = files(path);
  const get = (n: string) => {
    const d = f.get(n);
    if (!d) throw new Error(`missing ${n} in ${path}`);
    return d;
  };
  const prog = new Uint8Array(0x80000);
  const even = get('epr-12545.ic2'), odd = get('epr-12544.ic1');
  for (let i = 0; i < 0x40000; i++) {
    prog[i * 2] = even[i];
    prog[i * 2 + 1] = odd[i];
  }
  const tiles = new Uint8Array(0x60000);
  tiles.set(get('epr-12385.ic19'), 0);
  tiles.set(get('epr-12386.ic20'), 0x20000);
  tiles.set(get('epr-12387.ic21'), 0x40000);
  // each sprite chip holds two halves: the first 128K go to bank group 0, the second to +0x100000
  const sprites = new Uint8Array(0x200000);
  const load16 = (name: string, base: number) => {
    const d = get(name);
    for (let i = 0; i < 0x20000; i++) {
      sprites[base + i * 2] = d[i];
      sprites[base + 0x100000 + i * 2] = d[0x20000 + i];
    }
  };
  load16('mpr-12379.ic12', 0x000000);
  load16('mpr-12378.ic9', 0x000001);
  load16('mpr-12381.ic13', 0x040000);
  load16('mpr-12380.ic10', 0x040001);
  load16('mpr-12383.ic14', 0x080000);
  load16('mpr-12382.ic11', 0x080001);
  return { prog, tiles, sprites, sound: get('epr-12390.ic8'), samples: get('mpr-12384.ic6') };
}

export const ROM_ARG = process.env.GOLDNAXE_ROM ?? '';
export const rw = (a: Uint8Array, o: number) => (a[o] << 8) | a[o + 1];
export const rl = (a: Uint8Array, o: number) => ((rw(a, o) << 16) | rw(a, o + 2)) >>> 0;
export const rs = (a: Uint8Array, o: number) => (rw(a, o) << 16) >> 16;
