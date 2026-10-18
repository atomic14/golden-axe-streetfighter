// Maps the ROM spawn script's init routines (see tools/spawns.ts) to characters. Palettes and
// kinds were identified by watching what each routine put on screen in recordings.
import type { Actor } from './actor';
import { Enemy, KINDS } from './enemy';
import { Thief, Villager } from './props';
import type { Stage } from './stage';
import { Beast, type BeastType, type EnemyRider } from './mount';

/** Bizarrians and their riders (the rider's people depend on the area). */
const BEASTS: Record<number, BeastType> = {
  0x2c264: 'chicken', 0x2c276: 'chicken', 0x2b10c: 'chicken',
  0x2f60a: 'blue', 0x2f61c: 'blue', 0x306aa: 'red',
};
const RIDERS: EnemyRider[] = [
  { name: 'heninger', kind: 'heninger', pal: 0x1a, hp: 16 },
  { name: 'amazon', kind: 'amazon', pal: 0x64, hp: 16 },
  { name: 'longmoan', kind: 'longmoan', pal: 0x79, hp: 16 },
  { name: 'longmoan', kind: 'longmoanFast', pal: 0x7b, hp: 16 },
  { name: 'amazon', kind: 'amazon', pal: 0x65, hp: 16 },
];

const ENEMIES: Record<number, [keyof typeof KINDS, number]> = {
  0x18b28: ['heninger', 0x1b], 0x18b3c: ['heninger', 0x18], 0x18b50: ['heninger', 0x1d], 0x18ba6: ['heninger', 0x18],
  0x1a0a8: ['heninger', 0x1a], 0x317b8: ['heninger', 0x1b],
  0x1c846: ['longmoan', 0x79], 0x1c868: ['longmoan', 0x78], 0x1dc3e: ['longmoan', 0x77], 0x1f016: ['longmoanFast', 0x7b],
  0x21854: ['amazon', 0x63], 0x21876: ['amazon', 0x64], 0x2536e: ['amazon', 0x65], 0x229c8: ['amazon', 0x65],
  0x282d4: ['badbro', 0x38], 0x282ec: ['badbro', 0x38],
  0x2a358: ['knight', 0x86], 0x2a338: ['knight', 0x87],
  // areas 3 and 4
  0x23bda: ['skeleton', 0x73], 0x2538a: ['skeleton', 0x6f], 0x29364: ['badbro', 0x39],
};

const VILLAGERS: Record<number, [number, number]> = {
  0x99c0: [0x9fe8, 0x4d], 0x99c8: [0x9fe8, 0x4d], 0x99fe: [0xa10e, 0x4d], 0x9a9a: [0xa10e, 0x64],
};

export function spawnActor(stage: Stage, init: number, x: number, z: number, param: number): Actor | null {
  const e = ENEMIES[init];
  if (e) return new Enemy(stage, KINDS[e[0]], x, z, e[1]);
  // the throne room: Death Adder (param 0x1005) with skeletons rising at his side
  if (init === 0x25352) return param === 0x1005 ? new Enemy(stage, KINDS.adder, x, z, 0x50) : new Enemy(stage, KINDS.skeleton, x, z, 0x70);
  const beast = BEASTS[init];
  if (beast) return new Beast(stage, beast, x, z, { ...RIDERS[Math.min(stage.area, RIDERS.length - 1)] });
  if (init === 0x17d0e || init === 0x17d24) return new Thief(stage, x, z, param);
  const v = VILLAGERS[init];
  if (v) return new Villager(stage, x, z, v[0], v[1]);
  return null;
}
