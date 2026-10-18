// Non-fighting characters: the thieves who carry magic potions and food, the items they drop,
// and villagers fleeing across the screen.
import { audio } from '../audio';
import { Actor } from './actor';
import { Fighter, type Anims } from './fighter';
import type { Hero } from './hero';
import type { Stage } from './stage';

const THIEF: Anims = {
  idle: 0x1873a, walk: 0x1876a, attacks: [], hurt: [0x189aa], fly: 0x189aa, collapse: 0x189aa, getup: 0x18a3a, lie: 0x189aa,
};

/** A thief: runs on, gets kicked, drops what he carries and runs away. */
export class Thief extends Fighter {
  isEnemy = true;
  anims = THIEF;
  items: ('potion' | 'food')[] = [];
  fleeing = false;
  grabbable = false;
  hostile = false;
  /** at the bonus camp the potion thief goes for the jars beside the sleeping heroes */
  camp = false;
  food = false;

  /** param: the item count in the top nibble; food thieves (init 0x17d00, green) carry only food */
  constructor(stage: Stage, x: number, z: number, param: number, food = false) {
    super(stage);
    this.x = x;
    this.z = stage.floorZ(x + (x < 0x1000 - stage.camx ? 60 : -60), z);
    this.y = this.ground;
    this.pal = food ? 0x3c : 0x3d;
    this.hp = 99;
    const n = Math.max(1, param >> 12);
    for (let i = 0; i < n; i++) this.items.push(food ? 'food' : 'potion');
    this.food = food;
    this.facing = x > 0x1000 - stage.camx + 160 ? -1 : 1;
    this.setState('walk', this.anims.walk);
    audio.sfx('thief-appear');
  }

  get vulnerable() {
    return !this.gone && this.items.length > 0 && this.state === 'walk';
  }

  takeHit(from: Fighter): boolean {
    if (!this.vulnerable) return false;
    this.flash = 3;
    const item = this.items.shift()!;
    this.stage.actors.push(new Item(this.stage, this.x, this.z, this.y - 20, item, from.facing));
    audio.sfx('item');
    audio.sfx('thief-hurt');
    this.setState('hurt', this.anims.hurt[0]);
    this.facing = from.x > this.x ? -1 : 1;
    this.vy = -2;
    this.vx = -this.facing * 1.5;
    if (!this.items.length) this.fleeing = true;
    return true;
  }

  update() {
    if (this.flash > 0) this.flash--;
    this.t++;
    this.anim.tick();
    const sx = this.x - 0x1000 + this.stage.camx + 8;
    if (this.state === 'hurt') {
      this.physics();
      if (this.t > 24) {
        this.facing = this.fleeing ? (sx < 160 ? -1 : 1) : this.facing;
        this.setState('walk', this.anims.walk);
      }
      return;
    }
    // now and then a giggle
    if (Math.random() < 1 / 900) audio.sfx('thief-giggle');
    // at the camp the potion thief goes for the jars by the sleeping heroes and takes them
    const jar = this.camp && !this.food && !this.fleeing
      ? (this.stage.actors.find((a) => a instanceof CampPotion && !a.gone) as CampPotion | undefined) : undefined;
    if (jar) {
      const dx = jar.x - this.x, dz = jar.z - this.z;
      if (Math.abs(dx) < 4 && Math.abs(dz) < 4) {
        jar.gone = true;
        jar.owner.potions = Math.max(0, jar.owner.potions - 1);
        this.items.push('potion');
        audio.sfx('pickup');
      } else {
        this.facing = dx > 0 ? 1 : -1;
        this.x += Math.sign(dx) * Math.min(1.5, Math.abs(dx));
        this.z += Math.sign(dz) * Math.min(1, Math.abs(dz));
        const g = this.ground;
        if (g < 0x1480) this.y = g;
        return;
      }
    }
    // run across (thieves ignore walls); turn back at the screen edge a few times, then leave
    this.x += this.facing * (this.fleeing ? 2.5 : 1.5);
    const g = this.ground;
    if (g < 0x1480) this.y = g;
    if (this.t > 900) this.fleeing = true;
    if (!this.fleeing && ((sx > 300 && this.facing > 0) || (sx < 20 && this.facing < 0))) this.facing = -this.facing;
    // gone once off screen (thieves start off it, so only after coming on or while fleeing)
    if (sx > 0 && sx < 320) this.entered = true;
    if ((this.entered || this.fleeing) && (sx < -60 || sx > 380)) this.gone = true;
  }
  private entered = false;
}

/**
 * A hero's potion jar on the ground beside them at the camp (the original's 0x17bf8: up to two
 * for each hero who has any), for the potion thief to steal.
 */
export class CampPotion extends Actor {
  hostile = false;
  constructor(stage: Stage, public owner: Hero, dx: number) {
    super(stage);
    this.x = owner.x + dx;
    this.z = owner.z + 4;
    this.y = stage.groundAt(this.x, this.z);
    this.pal = 0x4a;
    this.anim.set(0x1870a);
  }
  update() {}
}

/** The bonus camp's fire. */
export class Campfire extends Actor {
  constructor(stage: Stage, x: number, z: number) {
    super(stage);
    this.x = x;
    this.z = z;
    this.y = this.ground;
    this.pal = 0x3d;
    this.anim.set(0x18aa6);
  }
  update() {
    this.anim.tick();
  }
}

/** A potion or a piece of meat on the ground (the original's 0x17dbc). */
export class Item extends Actor {
  life = 600;
  constructor(stage: Stage, x: number, z: number, y: number, public type: 'potion' | 'food', dir: number) {
    super(stage);
    this.x = x;
    this.z = z;
    this.y = y;
    this.vx = dir * 0.8;
    this.vy = -3;
    this.pal = type === 'potion' ? 0x4a : 0x7f;
    this.anim.set(type === 'potion' ? 0x1870a : 0x18722);
  }

  update() {
    if (this.y < this.ground) {
      this.y += this.vy;
      this.vy += 0.25;
      this.move(this.vx, 0);
      if (this.y >= this.ground) this.y = this.ground;
    }
    if (--this.life < 120) this.blink = true;
    if (this.life <= 0) this.gone = true;
    for (const h of this.stage.heroes as Hero[]) {
      if (h.dead || !h.mayTake(this) || Math.abs(h.x - this.x) > 14 || Math.abs(h.z - this.z) > 8 || this.y < this.ground - 2) continue;
      if (this.type === 'potion') h.potions = Math.min(h.def.magicLevels, h.potions + 1);
      else h.hp = Math.min(h.maxHp, h.hp + 16);
      audio.sfx('pickup');
      this.gone = true;
      break;
    }
  }
}

/** Villagers fleeing from the soldiers. */
export class Villager extends Actor {
  constructor(stage: Stage, x: number, z: number, walk: number, pal: number) {
    super(stage);
    this.x = x;
    this.z = z;
    this.y = this.ground;
    this.pal = pal;
    this.anim.set(walk);
    this.facing = x > 0x1000 - stage.camx + 160 ? -1 : 1;
  }

  update() {
    this.anim.tick();
    this.x += this.facing * 1.6;
    const sx = this.x - 0x1000 + this.stage.camx + 8;
    if (sx < -60 || sx > 380) this.gone = true;
  }
}
