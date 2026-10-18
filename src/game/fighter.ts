// Behaviour shared by heroes and enemies: animation roles, gravity, being hit, knocked down,
// lying and getting up.
import { Actor } from './actor';
import type { Stage } from './stage';

/** Animation roles; every fighter maps them to ROM scripts. */
export interface Anims {
  idle: number;
  walk: number;
  walkUp?: number;
  run?: number;
  attacks: number[];
  jump?: number;
  jumpAttack?: number;
  hurt: number[];
  /** knocked flying (art reversed, tumbling) */
  fly: number;
  /** collapse (killed while standing) */
  collapse: number;
  getup: number;
  /** lying still */
  lie: number;
}

export const GRAVITY = 0.25;

export abstract class Fighter extends Actor {
  abstract anims: Anims;
  state = 'stand';
  t = 0;
  /** invulnerable for this many ticks */
  invuln = 0;
  /** hits taken in quick succession: the third knocks down */
  hitCount = 0;
  hitTimer = 0;
  /** who last hit us, for knock directions */
  lastHitBy: Fighter | null = null;
  /** being held in a grab */
  heldBy: Fighter | null = null;
  /** versus: the opponent (fighting one on one rather than through the stages) */
  foe: Fighter | null = null;
  maxHp = 16;
  /** versus bosses: once a swing has started, light blows hurt but don't stop it; only knock-downs do */
  armor = false;

  /** versus: knocked out, lying where they fell */
  get ko() {
    return this.state === 'ko';
  }

  constructor(stage: Stage) {
    super(stage);
  }

  get vulnerable() {
    return !this.dead && !this.gone && this.invuln <= 0 && !['fly', 'down', 'getup', 'dying', 'thrown'].includes(this.state);
  }

  setState(s: string, anim?: number, restart = true) {
    this.state = s;
    this.struck.clear();
    this.t = 0;
    if (anim !== undefined) this.anim.set(anim, restart);
  }

  /** Start an attack-style script, skipping a long hold step at its start. */
  playMove(addr: number) {
    this.anim.set(addr, true);
    if (this.anim.steps.length > 1 && this.anim.steps[0][1] >= 30) this.anim.go(1);
  }

  /** Gravity and landing. Returns true on the tick it lands. */
  physics(): boolean {
    this.y += this.vy;
    this.vy += GRAVITY;
    if (this.vx) this.move(this.vx, 0);
    if (this.vz) this.move(0, this.vz);
    // below 0x1480 is a pit: whoever falls that far is gone
    if (this.y > 0x1480 && !this.dead) {
      this.fallInPit();
      return false;
    }
    const g = this.ground;
    if (this.y >= g && this.vy >= 0) {
      this.y = g;
      this.vy = 0;
      return true;
    }
    return false;
  }

  /** Receive a hit. `knock` sends the fighter flying. Returns true if it landed. */
  takeHit(from: Fighter, dmg: number, knock = false): boolean {
    if (!this.vulnerable) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.lastHitBy = from;
    this.flash = 3;
    this.heldBy = null;
    this.hitCount = this.hitTimer > 0 ? this.hitCount + 1 : 1;
    this.hitTimer = 45;
    if (this.armor && this.state === 'attack' && this.hp > 0 && !knock && !this.airborne) {
      this.onHit(from, dmg);
      return true;
    }
    if (from.x !== this.x) this.facing = from.x > this.x ? 1 : -1;
    if (this.hp <= 0 || knock || this.hitCount >= 3 || this.airborne) this.knockDown(from.x > this.x ? -1 : 1);
    else {
      this.setState('hurt', this.anims.hurt[(this.hitCount - 1) % this.anims.hurt.length]);
      this.t = 0;
    }
    this.onHit(from, dmg);
    return true;
  }

  onHit(_from: Fighter, _dmg: number) {}

  /** the sound of being knocked flying (and a death scream if this blow killed) */
  cry() {}

  knockDown(dir: number, speed = 2.5, lift = 4.5) {
    if (this.state !== 'fly') this.cry();
    this.facing = -dir;
    this.vx = dir * speed;
    this.vz = 0;
    this.vy = -lift;
    if (this.y > this.ground - 1) this.y = this.ground - 1;
    this.setState('fly', this.anims.fly);
    this.anim.go(1);
    this.hitCount = 0;
  }

  /** Common reactions; returns true if the state was handled. */
  updateCommon(): boolean {
    if (this.flash > 0) this.flash--;
    if (this.invuln > 0) this.invuln--;
    this.blink = this.invuln > 0 && this.state !== 'down';
    if (this.hitTimer > 0) this.hitTimer--;
    this.t++;
    switch (this.state) {
      case 'hurt':
        this.anim.tick();
        if (this.t >= 18) this.recover();
        if (!this.airborne) return true;
        // hit in the air: fall
        this.knockDown(this.facing > 0 ? -1 : 1, 1, 0);
        return true;
      case 'fly': {
        // tumble through the script's frames while in the air
        if (this.anim.index < this.anim.steps.length - 2 && this.t % 8 === 0) this.anim.go(this.anim.index + 1);
        if (this.physics()) {
          this.vx = 0;
          this.anim.go(this.anim.steps.length - 1);
          this.setState('down');
          this.onLanded();
        }
        return true;
      }
      case 'down':
        if (this.t >= (this.hp <= 0 ? 50 : 32)) {
          if (this.hp <= 0) this.die();
          else {
            this.setState('getup', this.anims.getup);
          }
        }
        return true;
      case 'getup':
        this.anim.tick();
        if (this.t >= 24) {
          this.invuln = this.isHero ? 70 : 20;
          this.recover();
        }
        return true;
      case 'dying':
        this.blink = true;
        if (this.t >= 50) this.gone = true;
        return true;
      case 'held':
      case 'thrown': // carried through a throw by whoever holds it (Hero.updateThrow)
        return true;
    }
    return false;
  }

  onLanded() {}

  fallInPit() {
    this.hp = 0;
    this.dead = true;
    this.gone = true;
  }

  recover() {
    this.setState('stand', this.anims.idle);
  }

  die() {
    this.dead = true;
    // versus: no fading away, the round is over
    this.setState(this.foe ? 'ko' : 'dying');
  }

}
