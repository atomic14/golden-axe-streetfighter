// The three playable characters. Moves and their timing follow recordings of the original
// (tools/mame/moves.lua): walking 1.5 px/tick both ways, running up to 4, a 12-tick crouch
// then a 5.75 px/tick jump (7.875 from a run) under 0.25 px/tick² gravity.
import { attackOf } from '../assets';
import { input, type Pad } from '../input';
import { audio } from '../audio';
import { Fighter, type Anims } from './fighter';
import type { Stage } from './stage';
import type { Beast } from './mount';
import type { Brain } from './partner';
import type { Item } from './props';

export interface HeroDef {
  name: string;
  pal: number;
  /** HUD portrait frame */
  face: number;
  magicLevels: number;
  anims: Anims & { magic: number; walkUp: number; run: number; jump: number; jumpAttack: number; knee: number; throw: number; back: number; dash: number };
}

export const HEROES: HeroDef[] = [
  {
    name: 'AX BATTLER', pal: 0x13, face: 0x1c5, magicLevels: 4,
    anims: {
      idle: 0xdfea, magic: 0xe002, walk: 0xe03e, walkUp: 0xe092, run: 0xe0e6, attacks: [0xe13a, 0xe25e, 0xe38c, 0xe416],
      knee: 0xe2d8, throw: 0xe482, back: 0xe4d6, dash: 0xe580, jump: 0xe598, jumpAttack: 0xe5e0,
      hurt: [0xe634, 0xe664, 0xe694], collapse: 0xe6b8, fly: 0xe700, lie: 0xe7dc, getup: 0xe80c,
    },
  },
  {
    name: 'TYRIS FLARE', pal: 0x14, face: 0x1cd, magicLevels: 6,
    anims: {
      idle: 0x1192a, magic: 0x118ee, walk: 0x11942, walkUp: 0x11996, run: 0x119ea, attacks: [0x11a3e, 0x11b62, 0x11c80, 0x11ce0],
      knee: 0x11bcc, throw: 0x11d4c, back: 0x11da0, dash: 0x11e4a, jump: 0x11e62, jumpAttack: 0x11eaa,
      hurt: [0x11efe, 0x11f22, 0x11f52], collapse: 0x11f76, fly: 0x11fbe, lie: 0x1209a, getup: 0x120ca,
    },
  },
  {
    name: 'GILIUS THUNDERHEAD', pal: 0x15, face: 0x1d5, magicLevels: 3,
    anims: {
      idle: 0x150ac, magic: 0x150c4, walk: 0x15100, walkUp: 0x15154, run: 0x151a8, attacks: [0x151fc, 0x15300, 0x1542e, 0x154b8],
      knee: 0x1537a, throw: 0x15524, back: 0x15578, dash: 0x1562c, jump: 0x15644, jumpAttack: 0x1568c,
      hurt: [0x156ee, 0x1571e, 0x1574e], collapse: 0x15772, fly: 0x157ba, lie: 0x15896, getup: 0x158c6,
    },
  },
];

const WALK = 1.5, RUN = 4, JUMP = 5.75, RUN_JUMP = 7.875;
/** ticks after attack or jump in which pressing the other still makes a back attack */
const BACK_WINDOW = 6;
/** where a thrown enemy is held, (forward, height), for each step of the throw (recordings) */
const CARRY: [number, number][] = [[28, 0], [1, -16], [-9, -18], [1, -10]];

export class Hero extends Fighter {
  anims: HeroDef['anims'];
  def: HeroDef;
  hp = 48;
  maxHp = 48;
  lives = 2;
  // the original starts with none (player 1's count is 0xffe030); thieves bring them
  potions = 0;
  isHero = true;
  /** current combo step and whether the last swing connected */
  combo = 0;
  comboTimer = 0;
  connected = false;
  queued = false;
  grabbed: Fighter | null = null;
  knees = 0;
  /** double-tap tracking */
  private lastX = 0;
  private tapDir = 0;
  private tapTime = -99;
  private releaseTime = -99;
  running = false;
  /** ticks since attack / jump were pressed, for the attack + jump back attack */
  private atkAge = 99;
  private jumpAge = 99;
  airAttacked = false;
  respawnTimer = 0;
  pad: Pad = { x: 0, y: 0, attack: false, jump: false, magic: false, run: false };
  /** the bizarrian being ridden */
  mount: Beast | null = null;
  /** no remounting straight after being thrown off */
  mountCooldown = 0;
  pressed = { attack: false, jump: false, magic: false };
  /** a computer player drives this hero instead of the controls */
  brain: Brain | null = null;
  /** versus: the back attack's long lunge outdid everything else at the original 8 */
  damage(dmg: number) {
    return this.foe && this.anim.addr === this.anims.back ? 5 : dmg;
  }


  constructor(stage: Stage, public index: number) {
    super(stage);
    this.def = HEROES[index];
    this.anims = this.def.anims;
    this.pal = this.def.pal;
    this.setState('stand', this.anims.idle);
  }

  get enemies(): Fighter[] {
    const others = this.stage.actors.filter((a) => a.isEnemy && a !== this.foe) as Fighter[];
    return this.foe ? [this.foe, ...others] : others;
  }

  get cpu() {
    return !!this.brain;
  }

  /** Whether walking over an item picks it up (a computer partner leaves the leader first pick). */
  mayTake(item: Item) {
    return !this.brain || this.brain.wants(item);
  }

  private readPad() {
    if (this.brain) {
      const { pad, pressed } = this.brain.read();
      this.pad = pad;
      this.pressed = pressed;
    } else {
      this.pad = input.pad;
      this.pressed = { attack: input.pressed.attack, jump: input.pressed.jump, magic: input.pressed.magic };
    }
    // the arcade's run: tap a direction twice (the touch stick's double flick sends the same)
    const now = this.stage.time;
    if (this.pad.x !== this.lastX) {
      if (this.pad.x !== 0) {
        if (this.pad.x === this.tapDir && now - this.tapTime < 22 && now - this.releaseTime < 14) this.running = true;
        this.tapDir = this.pad.x;
        this.tapTime = now;
      } else {
        this.releaseTime = now;
        this.running = false;
      }
      if (this.pad.x !== 0 && this.lastX !== 0) this.running = false;
      this.lastX = this.pad.x;
    }
    if (this.pad.run && this.pad.x) this.running = true;
    this.atkAge = this.pressed.attack ? 0 : this.atkAge + 1;
    this.jumpAge = this.pressed.jump ? 0 : this.jumpAge + 1;
  }

  /** Heroes (and what they ride) stay inside the camera's view. */
  clampToScreen() {
    const s = this.stage;
    const lo = 0x1000 - s.camx - 8 + 14, hi = 0x1000 - s.camx - 8 + 306;
    const body = this.mount ?? this;
    if (body.x < lo) body.x = lo;
    if (body.x > hi) body.x = hi;
    if (this.mount) this.x = body.x;
  }

  update() {
    // interrupted mid-throw: drop the victim
    if (this.thrown && this.state !== 'throw') {
      const g = this.thrown;
      this.thrown = null;
      g.heldBy = null;
      if (g.state === 'thrown') g.knockDown(this.facing, 1, 2);
    }
    this.clampToScreen();
    // versus: the opponent's spell stops everything else
    if (this.foe && this.stage.frozen && this.stage.frozen !== this) return;
    this.readPad();
    if (this.comboTimer > 0 && --this.comboTimer === 0) this.combo = 0;
    if (!this.brain) input.running = this.state === 'run';
    if (this.state === 'gameover') return;
    if (this.state === 'respawn') {
      if (--this.respawnTimer <= 0) this.respawn();
      return;
    }
    if (this.mountCooldown > 0) this.mountCooldown--;
    if (this.mount) return this.updateRiding();
    if (this.state === 'sleep') return;
    if (this.updateCommon()) return;
    const p = this.pad;
    switch (this.state) {
      case 'stand':
      case 'walk':
      case 'run': {
        // back attack: attack and jump together
        if ((this.pressed.attack && this.jumpAge <= 3) || (this.pressed.jump && this.atkAge <= 3)) {
          this.backAttack();
          break;
        }
        if (this.pressed.magic && this.potions > 0) return this.castMagic();
        if (this.pressed.attack) {
          if (this.state === 'run') return this.dashAttack();
          return this.attack();
        }
        if (this.pressed.jump) return this.jump(this.state === 'run');
        if (this.state === 'run' && p.x === this.facing && this.running) {
          this.vx = Math.min(RUN, Math.abs(this.vx) + 0.5) * this.facing;
          this.move(this.vx, p.y * 0.75);
          this.anim.tick();
          break;
        }
        if (p.x || p.y) {
          if (p.x) this.facing = p.x;
          if (this.running && p.x) {
            this.setState('run', this.anims.run, false);
            this.vx = 1 * this.facing;
            break;
          }
          this.move(p.x * WALK, p.y * WALK);
          const a = p.y < 0 ? this.anims.walkUp : this.anims.walk;
          if (this.state !== 'walk' || this.anim.addr !== a) this.setState('walk', a, true);
          this.anim.tick();
        } else if (this.state !== 'stand') this.setState('stand', this.anims.idle);
        this.edgeCheck();
        break;
      }
      case 'attack':
      case 'back': {
        // jump pressed just after attack: a back attack, as long as the jab hasn't landed
        if (this.state === 'attack' && this.pressed.jump && this.t <= BACK_WINDOW && !this.connected && !this.struck.size) {
          this.backAttack();
          break;
        }
        this.anim.tick();
        if (this.pressed.attack) this.queued = true;
        if (this.attackHits(this.enemies).length) {
          this.connected = true;
          this.stage.heroHit();
          audio.sfx('hit');
        }
        if (this.anim.looped) {
          if (this.state === 'attack' && this.queued && this.connected && this.combo < 3) {
            this.combo++;
            this.attack(true);
          } else {
            if (this.state === 'attack') this.combo = this.connected ? (this.combo + 1) % 4 : 0;
            this.comboTimer = 40;
            this.setState('stand', this.anims.idle);
          }
        }
        break;
      }
      case 'dash': {
        this.t < 16 ? (this.vy = this.t === 1 ? -2.6 : this.vy) : null;
        this.vx = this.t < 18 ? RUN * this.facing : 0;
        this.physics();
        if (this.t < 18 && this.attackHits(this.enemies).length) {
          this.stage.heroHit();
          audio.sfx('hit');
        }
        if (this.t >= 34) this.setState('stand', this.anims.idle);
        break;
      }
      case 'squat':
        // attack pressed just after jump: a back attack instead
        if (this.pressed.attack && this.t <= BACK_WINDOW) {
          this.vx = 0;
          this.backAttack();
          break;
        }
        this.anim.tick();
        if (this.t >= 12) {
          this.setState('air', this.anims.jump, false);
          this.anim.go(2);
          this.vy = -(this.vx && Math.abs(this.vx) > 2 ? RUN_JUMP : JUMP);
          this.vx = p.x ? p.x * 1 : 0;
          this.airAttacked = false;
        }
        break;
      case 'air': {
        // the attack can be repeated as often as it's pressed, once the last swing has struck
        const swing = this.anim.addr === this.anims.jumpAttack ? attackOf(this.anim.addr) : null;
        if (this.pressed.attack && !this.airAttacked && (!swing || this.anim.index > swing[2])) {
          // the original starts it on its second step: a wind-up, the active step, a follow-through
          this.anim.set(this.anims.jumpAttack, true);
          this.anim.go(1);
          this.struck.clear();
        }
        if (this.anim.addr === this.anims.jumpAttack) {
          this.anim.tick();
          if (this.attackHits(this.enemies).length) {
            this.stage.heroHit();
            audio.sfx('hit');
          }
          if (this.anim.looped) this.anim.set(this.anims.jump, true);
        }
        if (this.anim.addr === this.anims.jump) this.anim.go(this.vy < 0 ? 2 : 3);
        if (this.physics()) {
          this.vx = 0;
          this.setState('land', this.anims.jump, true);
          this.anim.go(4);
        } else if (this.y > 0x1480) this.fallInPit();
        break;
      }
      case 'land':
        this.anim.tick();
        if (this.t >= 8) this.setState('stand', this.anims.idle);
        break;
      case 'grab': {
        const g = this.grabbed;
        this.anim.tick();
        if (!g || g.dead || g.heldBy !== this) {
          this.grabbed = null;
          this.setState('stand', this.anims.idle);
          break;
        }
        const knee = attackOf(this.anim.addr);
        if (knee && this.anim.stepped && this.anim.index === knee[2]) {
          this.knees++;
          g.hp = Math.max(0, g.hp - knee[1]);
          g.flash = 3;
          audio.sfx('hit');
        }
        if (this.anim.looped) {
          if (this.knees >= 2 || g.hp <= 0) this.throwGrabbed();
          else if (this.pressed.attack || this.queued) {
            this.queued = false;
            this.playMove(this.anims.knee);
          } else if (this.t > 60) this.throwGrabbed();
        }
        if (this.pressed.attack) this.queued = true;
        break;
      }
      case 'throw':
        this.anim.tick();
        if (this.thrown) {
          if (this.thrown.state !== 'thrown' || this.thrown.dead) this.thrown = null;
          else this.carry(this.thrown);
        }
        if (this.anim.looped || this.t > 70) this.setState('stand', this.anims.idle);
        break;
      case 'magic':
        this.anim.tick();
        if (this.t >= this.magicTime) this.setState('stand', this.anims.idle);
        break;
      case 'fall':
        this.y += this.vy;
        this.vy += 0.25;
        if (this.y > 0x1480) this.fallInPit();
        break;
    }
  }

  get vulnerable() {
    return !this.mount && super.vulnerable;
  }

  /** knocked flying: the whoosh, or the hero's own scream if the blow killed */
  cry() {
    audio.sfx(this.hp <= 0 ? `die-${this.def.name.split(' ')[0].toLowerCase()}` : 'knock');
  }

  canMount(b: Beast) {
    if (this.brain && !this.brain.mayMount(b)) return false;
    return !this.mount && !this.dead && this.mountCooldown <= 0 && ['stand', 'walk', 'run', 'air'].includes(this.state) &&
      Math.abs(this.x - b.x) < 14 && Math.abs(this.z - b.z) < 6 && this.y <= b.y + 2;
  }

  mountBeast(b: Beast) {
    this.mount = b;
    b.setRider(this);
    b.facing = this.facing;
    this.state = 'ride';
    this.vx = this.vy = 0;
    audio.sfx('mount');
  }

  dismount() {
    this.mount = null;
    this.mountCooldown = 60;
    this.setState('stand', this.anims.idle);
  }

  /** Knocked off a mount: fall like any other knockdown. */
  takeHitDirect(from: Fighter, dmg: number, dir: number) {
    this.hp = Math.max(0, this.hp - dmg);
    this.lastHitBy = from;
    this.y = this.mount ? this.mount.y - 24 : this.y - 24;
    this.knockDown(dir, 2, 3);
    audio.sfx('hurt');
  }

  private updateRiding() {
    const b = this.mount!;
    const set = b.set!;
    const p = this.pad;
    if (this.flash > 0) this.flash--;
    if (this.invuln > 0) this.invuln--;
    this.blink = this.invuln > 0;
    b.blink = this.blink;
    if (b.state === 'attack') {
      b.anim.tick();
      b.attackEffects(this.enemies);
      if (b.anim.looped || b.t > 120) b.setState('stand', set[0]);
    } else if (this.pressed.jump) {
      // hop off backwards
      b.setRider(null);
      this.mount = null;
      this.mountCooldown = 40;
      this.y = b.y - 20;
      this.setState('air', this.anims.jump, false);
      this.anim.go(2);
      this.vy = -4;
      this.vx = -this.facing * 1.5;
      this.airAttacked = true;
      return;
    } else if (this.pressed.attack) {
      b.setState('attack');
      b.playMove(set[4]);
    } else if (p.x || p.y) {
      if (p.x) this.facing = b.facing = p.x;
      const run = this.running && p.x;
      b.move(p.x * (run ? 3 : 1.5), p.y * 1.5);
      const a = run ? set[3] : p.y < 0 ? set[2] : set[1];
      if (b.anim.addr !== a) b.setState('walk', a);
      b.anim.tick();
    } else {
      if (b.anim.addr !== set[0]) b.setState('stand', set[0]);
      b.anim.tick();
    }
    // off a ledge: the beast drops (into a pit, rider and all)
    if (b.y < b.ground - 1) {
      b.vy += 0.25;
      b.y = Math.min(b.ground, b.y + b.vy);
      if (b.y > 0x1480) {
        b.setRider(null);
        b.gone = true;
        this.mount = null;
        this.fallInPit();
        return;
      }
    } else b.vy = 0;
    this.x = b.x;
    this.z = b.z;
    this.y = b.y;
  }

  attack(chain = false) {
    if (!chain) {
      // a close enemy in front gets grabbed instead
      const t = this.enemies.find((e) => e.vulnerable && e.state !== 'fly' && !e.airborne && (e as Fighter & { grabbable?: boolean }).grabbable !== false &&
        (e.x - this.x) * this.facing > 4 && (e.x - this.x) * this.facing < 22 && Math.abs(e.z - this.z) < 6 && ['hurt', 'stand', 'walk'].includes(e.state));
      if (t) return this.grab(t);
      if (this.comboTimer <= 0) this.combo = 0;
    }
    this.connected = false;
    this.queued = false;
    audio.sfx('swing');
    this.setState('attack');
    this.playMove(this.anims.attacks[this.combo]);
  }

  grab(t: Fighter) {
    this.grabbed = t;
    t.heldBy = this;
    t.setState('held', t.anims.hurt[0]);
    t.facing = -this.facing;
    t.x = this.x + this.facing * 18;
    t.z = this.z;
    this.knees = 0;
    this.setState('grab');
    this.playMove(this.anims.knee);
  }

  /**
   * The throw, as recorded from the original: the hero's throw script starts on its second step,
   * and the victim plays its own thrown script (its 'fly' script) a step behind, carried at these
   * places (forward of the hero, height) up and over the shoulder, then is let go on the last
   * step, high up, flying forward at 3px a tick.
   */
  throwGrabbed() {
    const g = this.grabbed;
    this.grabbed = null;
    this.setState('throw');
    this.playMove(this.anims.throw);
    this.anim.go(1);
    this.thrown = g;
    if (g) {
      g.setState('thrown', g.anims.fly);
      this.carry(g);
      audio.sfx('throw');
    }
  }

  /** the thrown victim, while still in the hero's hands */
  thrown: Fighter | null = null;

  private carry(g: Fighter) {
    const i = this.anim.index;
    if (i >= 1 && i <= 4) {
      const [fx, fy] = CARRY[i - 1];
      g.x = this.x + this.facing * fx;
      g.z = this.z;
      g.y = this.y + fy;
      if (g.anim.index !== i - 1) g.anim.go(i - 1);
      return;
    }
    // let go: high in front, flying forward
    this.thrown = null;
    g.heldBy = null;
    g.x = this.x + this.facing * 12;
    g.y = this.y - 48;
    g.hp = Math.max(0, g.hp - (attackOf(this.anims.throw)?.[1] ?? 4));
    g.lastHitBy = this;
    g.facing = -this.facing;
    g.vx = this.facing * 3;
    g.vz = 0;
    g.vy = -2;
    g.hitCount = 0;
    g.cry();
    g.setState('fly', undefined);
    g.anim.go(4);
  }

  dashAttack() {
    this.setState('dash', this.anims.dash);
    this.vy = -2.6;
    this.y -= 1;
  }

  /** Attack and jump together. The original turns round for it, and stays turned. */
  backAttack() {
    this.facing = -this.facing;
    this.setState('back');
    this.playMove(this.anims.back);
  }

  jump(fromRun: boolean) {
    audio.sfx('jump');
    this.vx = fromRun ? RUN * this.facing : 0;
    this.setState('squat', this.anims.jump);
  }

  magicTime = 0;

  castMagic() {
    const level = Math.min(this.potions, this.def.magicLevels);
    this.potions = 0;
    this.setState('magic', this.anims.magic);
    this.magicTime = this.stage.castMagic(this, level);
  }

  /** Walking off a ledge drops you; pits have a ground far below. */
  edgeCheck() {
    const g = this.ground;
    if (g > this.y + 8) {
      this.vy = 0;
      if (g >= 0x1480) {
        this.setState('fall', this.anims.hurt[0]);
      } else {
        this.setState('air', this.anims.jump, false);
        this.anim.go(3);
        this.airAttacked = true;
      }
    }
  }

  fallInPit() {
    if (this.state === 'respawn') return;
    this.hp = 0;
    audio.sfx('scream');
    this.loseLife();
  }

  onLanded() {
    audio.sfx('fall');
  }

  die() {
    // versus: no lives, the round is over
    if (this.foe) return super.die();
    this.loseLife();
  }

  loseLife() {
    this.dead = true;
    this.blink = false;
    this.state = 'respawn';
    this.respawnTimer = 90;
    this.vx = this.vy = 0;
  }

  respawn() {
    if (this.lives <= 0) {
      this.state = 'gameover';
      this.gone = false;
      return;
    }
    this.lives--;
    this.dead = false;
    this.hp = this.maxHp;
    // drop back in near the left of the screen on solid ground
    const s = this.stage;
    let best: [number, number] | null = null;
    for (let x = 0x1000 - s.camx + 40; x < 0x1000 - s.camx + 200 && !best; x += 8) {
      for (let z = 0x1040; z < 0x1100; z += 8) {
        const g = s.groundAt(x, z);
        if (g > 0xf00 && g < 0x1480) { best = [x, z]; break; }
      }
    }
    if (best) [this.x, this.z] = best;
    this.dropIn(this.x, this.z);
  }

  /** Fall in from above the screen onto solid ground at (x, z), blinking. */
  dropIn(x: number, z: number) {
    const s = this.stage;
    const lo = 0x1000 - s.camx + 24, hi = 0x1000 - s.camx + 296;
    this.x = Math.max(lo, Math.min(hi, x));
    this.z = s.floorZ(this.x, z);
    this.y = this.ground - 120;
    this.vy = 0;
    this.vx = 0;
    this.invuln = 120;
    this.setState('air', this.anims.jump, false);
    this.anim.go(3);
    this.airAttacked = true;
  }

  draw() {
    if (this.state === 'respawn' || this.state === 'gameover' || this.mount) return;
    super.draw();
  }
}
