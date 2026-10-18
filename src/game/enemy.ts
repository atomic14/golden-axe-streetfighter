// Enemies: soldiers, giants and beasts. Each kind maps animation roles to its block of ROM
// scripts; one AI drives them all: close in on a hero, line up in depth, attack (the script's
// header decides what it hits, see Fighter.attackHits), then back off for a while.
import { audio } from '../audio';
import { Fighter, type Anims } from './fighter';
import type { Hero } from './hero';
import type { Stage } from './stage';

export interface Kind {
  name: string;
  anims: Anims;
  hp: number;
  /** how far in front [near, far] the AI starts an attack from */
  reach: [number, number];
  /** walking speed (px/tick across; depth is 3/4 of it), measured from recordings */
  speed: number;
  /** can be grabbed and kneed/thrown */
  grabbable: boolean;
  /** body radius for spacing */
  size?: number;
  /** a riderless beast: waits to be mounted rather than fighting */
  mount?: boolean;
  /** the death scream (a key of audio's SND) */
  voice?: string;
}

const a = (o: Partial<Anims> & Pick<Anims, 'idle' | 'walk' | 'attacks' | 'hurt' | 'fly' | 'collapse' | 'getup' | 'lie'>): Anims => o as Anims;

export const KINDS: Record<string, Kind> = {
  heninger: {
    name: 'heninger', hp: 16, voice: 'die-heninger', reach: [8, 44], speed: 0.6, grabbable: true,
    anims: a({ idle: 0x199e0, walk: 0x19a04, walkUp: 0x19aac, run: 0x19b54, attacks: [0x19bfc, 0x19d20, 0x19d9a], jump: 0x19e3c, jumpAttack: 0x19e84, hurt: [0x19efe, 0x19f2e, 0x19f5e], collapse: 0x19f82, fly: 0x19fca, getup: 0x1a02a, lie: 0x1a07e }),
  },
  longmoan: {
    name: 'longmoan', hp: 16, voice: 'die-longmoan', reach: [8, 44], speed: 0.75, grabbable: true,
    anims: a({ idle: 0x1d522, walk: 0x1d546, walkUp: 0x1d5ee, run: 0x1d696, attacks: [0x1d73e, 0x1d8a2, 0x1d90c], jump: 0x1d9be, jumpAttack: 0x1da06, hurt: [0x1da80, 0x1dab0, 0x1dae0], collapse: 0x1db04, fly: 0x1db4c, getup: 0x1dbac, lie: 0x1dc18 }),
  },
  longmoanFast: {
    name: 'longmoan', hp: 16, voice: 'die-longmoan', reach: [8, 44], speed: 0.85, grabbable: true,
    anims: a({ idle: 0x1e8fc, walk: 0x1e920, walkUp: 0x1e9c8, run: 0x1ea70, attacks: [0x1eb18, 0x1ec7c, 0x1ece6], jump: 0x1ed98, jumpAttack: 0x1ede0, hurt: [0x1ee5a, 0x1ee8a, 0x1eeba], collapse: 0x1eede, fly: 0x1ef26, getup: 0x1ef86, lie: 0x1eff2 }),
  },
  amazon: {
    name: 'amazon', hp: 16, voice: 'die-amazon', reach: [8, 46], speed: 0.85, grabbable: true,
    anims: a({ idle: 0x224ba, walk: 0x224de, walkUp: 0x22586, run: 0x2262e, attacks: [0x226d6, 0x22760], jump: 0x227e2, hurt: [0x2282a, 0x2284e, 0x2287e], collapse: 0x228a2, fly: 0x228ea, getup: 0x2294a, lie: 0x2299e }),
  },
  skeleton: {
    name: 'skeleton', hp: 16, voice: 'die-skeleton', reach: [8, 46], speed: 0.8, grabbable: true,
    anims: a({ idle: 0x24a54, walk: 0x24a6c, walkUp: 0x24b14, run: 0x24bbc, attacks: [0x24c64, 0x24d68, 0x24eb6], jump: 0x2508e, jumpAttack: 0x250d6, hurt: [0x251ca, 0x251ee, 0x2521e], collapse: 0x2528a, fly: 0x2528a, getup: 0x252ea, lie: 0x2533e }),
  },
  badbro: {
    name: 'badbro', hp: 32, voice: 'die-big', reach: [10, 52], speed: 0.5, grabbable: false, size: 14,
    anims: a({ idle: 0x28daa, walk: 0x28dce, walkUp: 0x28e46, run: 0x28ebe, attacks: [0x28f66, 0x28fc6, 0x29090], hurt: [0x291ba, 0x291de], collapse: 0x2920e, fly: 0x29256, getup: 0x292b6, lie: 0x2930a }),
  },
  knight: {
    name: 'knight', hp: 32, voice: 'die-big', reach: [10, 52], speed: 0.9, grabbable: false, size: 12,
    anims: a({ idle: 0x2ac72, walk: 0x2ac96, walkUp: 0x2ad3e, attacks: [0x2ade6, 0x2ae60], hurt: [0x2af62, 0x2af86, 0x2afb6], collapse: 0x2afda, fly: 0x2afda, getup: 0x2b022, lie: 0x2b076 }),
  },
  adder: {
    name: 'adder', hp: 64, voice: 'die-big', reach: [10, 56], speed: 0.9, grabbable: false, size: 14,
    anims: a({ idle: 0x35c58, walk: 0x35c70, walkUp: 0x35d18, run: 0x35dc0, attacks: [0x35e14], hurt: [0x35f20, 0x35f44, 0x35f74], collapse: 0x35f98, fly: 0x35fe0, getup: 0x36028, lie: 0x36058 }),
  },
};

export class Enemy extends Fighter {
  isEnemy = true;
  anims: Anims;
  cooldown = 40;
  wait = 0;
  /** which side of its target it prefers */
  side = 1;
  target: Hero | null = null;
  attackIndex = 0;
  /** walk in from off screen before fighting */
  entering = true;
  /** ticks of rest after an attack: [least, random extra] (versus bosses rest less) */
  rest: [number, number] = [50, 70];

  constructor(stage: Stage, public kind: Kind, x: number, z: number, pal: number) {
    super(stage);
    this.anims = kind.anims;
    this.x = x;
    this.z = z;
    this.y = this.ground;
    this.hp = this.maxHp = kind.hp;
    this.pal = pal;
    this.radius = kind.size ?? 8;
    this.facing = x > 0x1000 - stage.camx + 160 ? -1 : 1;
    this.cooldown = 30 + Math.floor(Math.random() * 60);
    if (kind.mount) this.hostile = false;
    this.setState('stand', this.anims.idle);
  }

  get grabbable() {
    return this.kind.grabbable;
  }

  update() {
    if (this.stage.frozen && this.stage.frozen !== this) return;
    if (this.updateCommon()) return;
    if (this.kind.mount) {
      this.anim.tick();
      return;
    }
    const heroes = this.stage.heroes.filter((h) => !h.dead && h.state !== 'respawn' && h.state !== 'gameover');
    if (!heroes.length) {
      this.setState('stand', this.anims.idle, false);
      this.anim.tick();
      return;
    }
    if (!this.target || !heroes.includes(this.target)) this.target = heroes[Math.floor(Math.random() * heroes.length)];
    const h = this.target;
    if (this.cooldown > 0) this.cooldown--;
    switch (this.state) {
      case 'stand':
      case 'walk': {
        const dx = h.x - this.x, dz = h.z - this.z;
        this.side = dx > 0 ? -1 : 1;
        // keep a spot at attack distance on our side of the hero, unless cooling down
        const reach = this.kind.reach;
        const want = this.cooldown > 0 ? reach[1] + 28 : (reach[0] + reach[1]) / 2;
        // take the other side of the hero if ours is off screen
        const scr = (x: number) => x - 0x1000 + this.stage.camx + 8;
        if (scr(h.x + this.side * want) > 300 || scr(h.x + this.side * want) < 20) this.side = -this.side;
        const tx = h.x + this.side * want, tz = h.z;
        let mx = Math.abs(tx - this.x) > 3 ? Math.sign(tx - this.x) : 0;
        let mz = Math.abs(tz - this.z) > 2 ? Math.sign(tz - this.z) : 0;
        // stay inside the screen once we have entered it
        const sx = this.x - 0x1000 + this.stage.camx + 8;
        if (sx > 20 && sx < 300) this.entering = false;
        if (!this.entering && ((sx < 12 && mx < 0) || (sx > 308 && mx > 0))) mx = 0;
        // far off but level with the hero: run in at 3px/tick, as the originals do
        if (this.anims.run && Math.abs(tx - this.x) > 90 && Math.abs(dz) < 6 && !this.entering && this.cooldown <= 0) {
          this.setState('run', this.anims.run);
          this.facing = tx > this.x ? 1 : -1;
          break;
        }
        if (mx || mz) {
          const ox = this.x, oz = this.z;
          this.move(mx * this.kind.speed, mz * this.kind.speed * 0.75);
          // walked off an edge: drop; blocked by a ledge it could clear: jump up
          if (this.ground > this.y + 4) {
            this.setState('drop', this.anims.jump ?? this.anims.hurt[0]);
            if (this.anims.jump) this.anim.go(3);
            break;
          }
          if (this.x === ox && this.z === oz && this.anims.jump) {
            const ahead = this.stage.groundAt(this.x + mx * 12, this.z + mz * 12);
            if (ahead < this.y - 12 && ahead > this.y - 72) {
              this.setState('leap', this.anims.jump);
              this.vx = mx * 1.2;
              this.vz = mz * 0.8;
              break;
            }
          }
          this.facing = dx > 0 ? 1 : -1;
          if (this.state !== 'walk') this.setState('walk', mz < 0 && !mx ? this.anims.walkUp ?? this.anims.walk : this.anims.walk);
          this.anim.tick();
        } else {
          this.facing = dx > 0 ? 1 : -1;
          if (this.state !== 'stand') this.setState('stand', this.anims.idle);
          this.anim.tick();
        }
        const rel = (h.x - this.x) * this.facing;
        if (this.cooldown <= 0 && rel >= reach[0] - 4 && rel <= reach[1] && Math.abs(dz) < 6 && !h.airborne) {
          this.wait++;
          if (this.wait > 6) {
            this.wait = 0;
            this.attackIndex = Math.floor(Math.random() * this.anims.attacks.length);
            this.setState('attack');
            this.playMove(this.anims.attacks[this.attackIndex]);
            audio.sfx('grunt');
          }
        }
        break;
      }
      case 'run': {
        this.anim.tick();
        const ox = this.x;
        this.move(this.facing * 3, 0);
        const rel = (h.x - this.x) * this.facing;
        if (this.x === ox || rel < this.kind.reach[1] - 6 || Math.abs(h.z - this.z) > 10 || this.t > 120) {
          // arrive swinging when in reach
          if (rel >= this.kind.reach[0] && rel <= this.kind.reach[1] && Math.abs(h.z - this.z) < 8) {
            this.attackIndex = 0;
            this.setState('attack');
            this.playMove(this.anims.attacks[0]);
            audio.sfx('grunt');
          } else this.setState('stand', this.anims.idle);
        }
        break;
      }
      case 'leap':
        // the jump script: crouch, then rise and fall frames
        if (this.t < 12) { this.anim.tick(); break; }
        if (this.t === 12) this.vy = -6.5;
        this.anim.go(this.vy < 0 ? 2 : 3);
        if (this.physics()) { this.vx = this.vz = 0; this.setState('stand', this.anims.idle); }
        break;
      case 'drop':
        if (this.physics()) { this.vx = this.vz = 0; this.setState('stand', this.anims.idle); }
        if (this.y > 0x1480) this.gone = true;
        break;
      case 'attack': {
        this.anim.tick();
        if (this.attackHits(this.stage.heroes).length) audio.sfx('hurt');
        if (this.anim.looped || this.t > 90) {
          this.cooldown = this.rest[0] + Math.floor(Math.random() * this.rest[1]);
          this.setState('stand', this.anims.idle);
        }
        break;
      }
    }
  }

  onHit() {
    this.cooldown = Math.max(this.cooldown, 24);
  }

  /** knocked flying: the whoosh, and the kind's scream if the blow killed */
  cry() {
    audio.sfx('knock');
    if (this.hp <= 0 && this.kind.voice) audio.sfx(this.kind.voice);
  }

  die() {
    super.die();
  }
}
