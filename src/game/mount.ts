// Bizarrians: Chicken Leg (tail whip), the blue dragon (flame) and the red dragon (fireballs).
// Every rider has a full set of mounted scripts in the ROM, each followed by a table giving the
// rider's frame and offset for every step (see tools/mounts.ts).
import { assets } from '../assets';
import { audio } from '../audio';
import { drawSprite } from '../gfx';
import { Actor } from './actor';
import { Enemy, KINDS } from './enemy';
import { Fighter, type Anims } from './fighter';
import type { Hero } from './hero';
import type { Stage } from './stage';

export type BeastType = 'chicken' | 'blue' | 'red';
type RiderName = 'ax' | 'tyris' | 'gilius' | 'heninger' | 'amazon' | 'longmoan';

/**
 * stand, walk, walk up (away from the viewer), run, attack, hurt, jump, thrown off. (The
 * recordings show the beast standing still in the first, a single still frame.)
 */
type MountSet = [number, number, number, number, number, number, number, number];

const SETS: Record<BeastType, Record<RiderName, MountSet>> = {
  chicken: {
    ax: [0xf12a, 0xf144, 0xf1d8, 0xf26c, 0xf2b6, 0xf330, 0xf35a, 0xf46e],
    tyris: [0x129e8, 0x12a02, 0x12a96, 0x12b2a, 0x12b74, 0x12bee, 0x12c18, 0x12d2c],
    gilius: [0x161e4, 0x161fe, 0x16292, 0x16326, 0x16370, 0x163ea, 0x16414, 0x164d8],
    heninger: [0x2bd70, 0x2bd8a, 0x2be5a, 0x2bf74, 0x2bffa, 0x2c0d4, 0x2c0fe, 0x2c20a],
    amazon: [0x2ce16, 0x2ce30, 0x2cf00, 0x2d01a, 0x2d0a0, 0x2d17a, 0x2d1a4, 0x2d2b0],
    longmoan: [0x2dedc, 0x2def6, 0x2dfc6, 0x2e0e0, 0x2e166, 0x2e240, 0x2e26a, 0x2e376],
  },
  blue: {
    ax: [0xfd70, 0xfd8a, 0xfdd4, 0xfe1e, 0xfe68, 0xff54, 0xff6e, 0x1001c],
    tyris: [0x1362e, 0x13648, 0x13692, 0x136dc, 0x13726, 0x137a0, 0x137ba, 0x13868],
    gilius: [0x16dca, 0x16de4, 0x16e2e, 0x16e78, 0x16ec2, 0x16f3c, 0x16f56, 0x17004],
    heninger: [0x2f11e, 0x2f138, 0x2f208, 0x2f322, 0x2f3a8, 0x2f49a, 0x2f4b4, 0x2f5aa],
    amazon: [0x301d0, 0x301ea, 0x302ba, 0x303d4, 0x3045a, 0x3054c, 0x30566, 0x3065c],
    longmoan: [0x312ae, 0x312c8, 0x31398, 0x314b2, 0x31538, 0x3162a, 0x31644, 0x3173a],
  },
  red: {
    ax: [0x10928, 0x10942, 0x1098c, 0x109d6, 0x10a20, 0x10b0c, 0x10b26, 0x10bd4],
    tyris: [0x14174, 0x1418e, 0x141d8, 0x14222, 0x1426c, 0x142e6, 0x14300, 0x143ae],
    gilius: [0x17900, 0x1791a, 0x17964, 0x179ae, 0x179f8, 0x17a72, 0x17a8c, 0x17b3a],
    heninger: [0x32678, 0x32692, 0x32762, 0x3287c, 0x32918, 0x32992, 0x329ac, 0x32aa2],
    amazon: [0x33798, 0x337b2, 0x33882, 0x3399c, 0x33a38, 0x33ab2, 0x33acc, 0x33bc2],
    longmoan: [0x34818, 0x34832, 0x34902, 0x34a1c, 0x34ab8, 0x34b32, 0x34b4c, 0x34c42],
  },
};

/** Riderless beasts. */
const FREE: Record<BeastType, [number, number]> = {
  chicken: [0x2be1e, 0x2beee],
  blue: [0x2f1cc, 0x2f29c],
  red: [0x2f1cc, 0x2f29c],
};

const PAL: Record<BeastType, number> = { chicken: 0x23, blue: 0x43, red: 0x44 };
const HERO_RIDER: RiderName[] = ['ax', 'tyris', 'gilius'];

export interface EnemyRider { name: RiderName; kind: keyof typeof KINDS; pal: number; hp: number }

export class Beast extends Fighter {
  isEnemy = true;
  anims: Anims;
  grabbable = false;
  rider: Hero | EnemyRider | null = null;
  set: MountSet | null = null;
  cooldown = 60;
  /** frames a freed beast stays put before wandering off */
  idle = 0;

  constructor(stage: Stage, public type: BeastType, x: number, z: number, rider: EnemyRider | null) {
    super(stage);
    this.x = x;
    this.z = z;
    this.y = this.ground;
    this.pal = PAL[type];
    this.radius = 14;
    this.hp = 99;
    this.facing = x > 0x1000 - stage.camx + 160 ? -1 : 1;
    this.anims = this.freeAnims();
    this.setRider(rider);
  }

  private freeAnims(): Anims {
    const [stand, walk] = FREE[this.type];
    return { idle: stand, walk, attacks: [], hurt: [stand], fly: stand, collapse: stand, getup: stand, lie: stand };
  }

  get heroRider(): Hero | null {
    return this.rider && (this.rider as Hero).isHero ? (this.rider as Hero) : null;
  }

  setRider(r: Hero | EnemyRider | null) {
    this.rider = r;
    // only an enemy-ridden beast holds up the scroll; one a hero rides is on the heroes' side
    this.hostile = !!r && !(r as Hero).isHero;
    this.isEnemy = !r || !(r as Hero).isHero;
    if (!r) {
      this.set = null;
      this.anims = this.freeAnims();
      this.setState('stand', this.anims.idle);
      return;
    }
    const name = (r as Hero).isHero ? HERO_RIDER[(r as Hero).index] : (r as EnemyRider).name;
    this.set = SETS[this.type][name];
    const [stand, walk, , , attack, hurt] = this.set;
    this.anims = { idle: stand, walk, attacks: [attack], hurt: [hurt], fly: hurt, collapse: hurt, getup: stand, lie: hurt };
    this.setState('stand', stand);
  }

  get vulnerable() {
    return !this.gone && !!this.rider && !['fly', 'down', 'getup', 'thrown'].includes(this.state) && this.invuln <= 0;
  }

  /** A hit knocks the rider off; the beast is left free to ride. */
  takeHit(from: Fighter, dmg: number): boolean {
    if (!this.vulnerable) return false;
    const r = this.rider!;
    this.flash = 3;
    const dir = from.x > this.x ? -1 : 1;
    const h = this.heroRider;
    if (h) {
      this.setRider(null);
      h.dismount();
      h.takeHitDirect(from, dmg, dir);
    } else {
      const e = r as EnemyRider;
      const foot = new Enemy(this.stage, KINDS[e.kind], this.x, this.z, e.pal);
      foot.hp = Math.max(0, e.hp - dmg);
      foot.y = this.y - 20;
      foot.lastHitBy = from;
      foot.entering = false;
      foot.knockDown(dir, 2, 3);
      this.stage.actors.push(foot);
      this.setRider(null);
    }
    this.idle = 0;
    this.invuln = 30;
    audio.sfx('hit');
    return true;
  }

  update() {
    if (this.stage.frozen && this.stage.frozen !== this.heroRider) return;
    if (this.flash > 0) this.flash--;
    if (this.invuln > 0) this.invuln--;
    this.t++;
    const h = this.heroRider;
    if (h) return; // the hero drives (Hero.updateRiding)
    if (!this.rider) return this.updateFree();
    this.updateEnemyRider();
  }

  private updateFree() {
    this.anim.tick();
    // wander slowly towards the middle of the screen after a while
    this.idle++;
    if (this.y < this.ground) this.physics();
    for (const hero of this.stage.heroes) {
      if (hero.canMount(this)) {
        hero.mountBeast(this);
        return;
      }
    }
  }

  private updateEnemyRider() {
    const set = this.set!;
    const heroes = this.stage.heroes.filter((h) => !h.dead && h.state !== 'respawn' && h.state !== 'gameover');
    if (!heroes.length) return;
    const h = heroes.reduce((m, x) => (Math.abs(x.x - this.x) + 2 * Math.abs(x.z - this.z) < Math.abs(m.x - this.x) + 2 * Math.abs(m.z - this.z) ? x : m));
    if (this.cooldown > 0) this.cooldown--;
    if (this.state === 'attack') {
      this.anim.tick();
      this.attackEffects(this.stage.heroes);
      if (this.anim.looped || this.t > 120) {
        this.cooldown = 70 + Math.floor(Math.random() * 60);
        this.setState('stand', set[0]);
      }
      return;
    }
    const reach = this.type === 'chicken' ? 48 : this.type === 'blue' ? 70 : 140;
    let side = h.x > this.x ? -1 : 1;
    const want = this.cooldown > 0 ? reach + 30 : reach - 14;
    const scr = (x: number) => x - 0x1000 + this.stage.camx + 8;
    if (scr(h.x + side * want) > 300 || scr(h.x + side * want) < 20) side = -side;
    const tx = h.x + side * want;
    const mx = Math.abs(tx - this.x) > 4 ? Math.sign(tx - this.x) : 0;
    const mz = Math.abs(h.z - this.z) > 2 ? Math.sign(h.z - this.z) : 0;
    this.facing = h.x > this.x ? 1 : -1;
    if (mx || mz) {
      this.move(mx * 1.1, mz * 0.8);
      const a = mz < 0 ? set[2] : set[1];
      if (this.state !== 'walk' || this.anim.addr !== a) this.setState('walk', a);
    } else if (this.state !== 'stand') this.setState('stand', set[0]);
    this.anim.tick();
    if (this.cooldown <= 0 && Math.abs(h.z - this.z) < 6 && Math.abs(h.x - this.x) < reach + 8) {
      this.setState('attack');
      this.playMove(set[4]);
    }
  }

  /**
   * The tail whip and the blue dragon's breath hit through their scripts' attack boxes (the
   * whip sweeps low, the breath reaches 48-96px ahead); the red dragon spits a fireball.
   */
  attackEffects(targets: Fighter[]) {
    const foes = targets.filter((t) => t !== this.heroRider);
    if (this.attackHits(foes, this.heroRider ?? this).length) audio.sfx('hit');
    if (!this.anim.stepped) return;
    const from = this.heroRider ?? this;
    // the flame appears with the open-mouthed frame (0x277), the fireball with 0x274
    if (this.type === 'blue' && this.anim.frame === 0x277 && this.anim.steps[this.anim.index - 1]?.[0] !== 0x277) {
      this.stage.actors.push(new Flame(this.stage, this));
      audio.sfx('fire');
    } else if (this.type === 'red' && this.anim.frame === 0x274 && this.anim.steps[this.anim.index - 1]?.[0] !== 0x274) {
      this.stage.actors.push(new Fireball(this.stage, this, from));
      audio.sfx('fire');
    }
  }

  draw() {
    super.draw();
    if (!this.rider || !this.set) return;
    // the rider, from the table after the current mounted script
    const table = assets.sprites.riders[this.anim.addr.toString(16)];
    if (!table) return;
    const [frame, flip, dx, dy] = table[this.anim.index] ?? table[0];
    const pal = this.heroRider ? this.heroRider.pal : (this.rider as EnemyRider).pal;
    const [sx, sy] = this.stage.project(this.x + (this.facing < 0 ? -dx : dx), this.z, this.y + dy);
    if (this.blink && (this.stage.time >> 1) & 1) return;
    drawSprite(frame, pal, sx, sy, (flip === 1) !== (this.facing < 0));
  }
}

/** The blue dragon's breath (script 0x2f422), drawn in front of it; the hit is the dragon's. */
export class Flame extends Actor {
  hostile = false;
  constructor(stage: Stage, public beast: Beast) {
    super(stage);
    this.pal = 0x45;
    this.anim.set(0x2f422);
  }
  update() {
    const b = this.beast;
    this.x = b.x;
    this.z = b.z + 1;
    this.y = b.y;
    this.facing = b.facing;
    this.anim.tick();
    if (this.anim.looped || b.gone) this.gone = true;
  }
}

/**
 * The red dragon's fireball (object 0x32178): flies 4px/tick at mouth height cycling three
 * scripts whose headers make it hit (8 damage, knocks down), with a black copy of itself on the
 * ground as its shadow; it bursts into a column of fire (0x32b90) when it hits or leaves the
 * screen.
 */
const FIREBALL = [0x32b00, 0x32b30, 0x32b60];
export class Fireball extends Actor {
  hostile = false;
  burst = false;
  age = 0;
  constructor(stage: Stage, beast: Beast, public owner: Fighter) {
    super(stage);
    this.pal = 0x45;
    this.facing = beast.facing;
    this.x = beast.x + beast.facing * 52;
    this.z = beast.z;
    this.y = beast.y - 28;
    this.anim.set(FIREBALL[0]);
  }
  update() {
    if (this.burst) {
      // the column of fire shows 0x113, 0x114 then 0x115 (the script's first step) last
      this.anim.tick();
      if (this.anim.looped) this.age = -1;
      else if (this.age < 0 && this.anim.stepped) this.gone = true;
      return;
    }
    this.x += this.facing * 4;
    // frames 0x110-0x112 for 4 ticks each, each shown as the active step of its own script
    const i = Math.floor(this.age++ / 4) % 3;
    this.anim.set(FIREBALL[i]);
    this.anim.go(i);
    const targets = this.owner.isHero ? (this.stage.actors.filter((a) => a.isEnemy) as Fighter[]) : this.stage.heroes;
    const sx = this.screen()[0];
    if (this.attackHits(targets, this.owner).length || sx < -16 || sx > 336) {
      this.burst = true;
      this.anim.set(0x32b90, true);
      this.anim.go(1);
    }
  }
  draw() {
    if (!this.burst) {
      const [sx, sy] = this.stage.project(this.x, this.z + 8, this.ground);
      const st = this.anim.step;
      drawSprite(st[0], 0, sx + (this.facing < 0 ? -st[3] : st[3]), sy, this.flip);
    }
    super.draw();
  }
}
