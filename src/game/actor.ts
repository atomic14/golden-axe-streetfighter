// Shared state for everything that walks the stage. Positions use the original's units:
// x and z (depth) are world pixels offset by 0x1000, y is height (bigger is lower) with the
// ground at height-map value * 8 + 0xe00.
import { attackOf } from '../assets';
import { drawSprite, drawSpriteTinted } from '../gfx';
import type { Fighter } from './fighter';
import { AnimPlayer } from './anim';
import type { Stage } from './stage';

export abstract class Actor {
  x = 0x1100;
  z = 0x1080;
  y = 0x1300;
  vx = 0;
  vz = 0;
  vy = 0;
  /** -1 left, 1 right */
  facing = 1;
  pal = 0;
  anim = new AnimPlayer();
  dead = false;
  /** remove from the stage */
  gone = false;
  /** draw order tie-break and hit flash */
  flash = 0;
  blink = false;
  hp = 16;
  /** half-width used for wall collisions */
  radius = 8;
  isEnemy = false;
  /** enemies that must be beaten before the scroll moves on (thieves don't count) */
  hostile = true;
  isHero = false;
  /** can be hit by attacks right now */
  get vulnerable() {
    return !this.dead && !this.gone;
  }

  constructor(public stage: Stage) {}

  abstract update(): void;

  get ground() {
    return this.stage.groundAt(this.x, this.z);
  }
  get airborne() {
    return this.y < this.ground - 1;
  }

  /** Screen position of the feet. */
  screen(): [number, number] {
    return this.stage.project(this.x, this.z, this.y);
  }

  /** Display flip: the step's flag (art faces left) toggled when facing left. */
  get flip() {
    return ((this.anim.step[2] & 1) === 1) !== (this.facing < 0);
  }

  /** Body box in world x / height: [x1, x2, y1, y2]. */
  box(): [number, number, number, number] {
    const [, , , dx, dy, b] = this.anim.step;
    let [x1, x2] = [b[0], b[1]];
    if (this.facing < 0) [x1, x2] = [-x2, -x1];
    // the box is relative to the displayed position (with the step's display offset)
    const x = this.x + (this.facing < 0 ? -dx : dx), y = this.y + dy;
    return [x + x1, x + x2, y + b[2], y + b[3]];
  }

  /** targets the current attack has already hit */
  struck = new Set<Actor>();

  /**
   * The original's hit test (0xad26). An attacking script has a header with its active step,
   * an attack box (relative to the displayed position, facing right), the damage and the
   * reaction. While that step plays, the box hits each target whose body box it overlaps
   * within 6px of depth, once per swing. Reactions 5 and up knock the target down. `credit`
   * is who the hit counts as coming from (the rider of a beast, the dragon behind a fireball).
   */
  attackHits(targets: Fighter[], credit?: Fighter): Fighter[] {
    const h = attackOf(this.anim.addr);
    if (!h || this.anim.index !== h[2]) return [];
    if (this.anim.stepped && this.anim.steps.length > 1) this.struck.clear();
    const [react, dmg, , x1, x2, y1, y2] = h;
    const [, , , dx, dy] = this.anim.step;
    const ax = this.x + (this.facing < 0 ? -dx : dx), ay = this.y + dy;
    const [l, r] = this.facing < 0 ? [ax - x2, ax - x1] : [ax + x1, ax + x2];
    const hit: Fighter[] = [];
    for (const t of targets) {
      if ((t as Actor) === this || this.struck.has(t) || !t.vulnerable || Math.abs(t.z - this.z) >= 7) continue;
      const [bx1, bx2, by1, by2] = t.box();
      if (bx2 < l || bx1 > r || by2 < ay + y1 || by1 > ay + y2) continue;
      this.struck.add(t);
      if (t.takeHit(credit ?? (this as unknown as Fighter), this.damage(dmg), react >= 5)) hit.push(t);
    }
    return hit;
  }

  /** the damage this actor's current attack does (versus retunes some moves) */
  damage(dmg: number) {
    return dmg;
  }

  /**
   * Walk by (dx, dz) against the height map: steps up of more than 12px are walls; walking off
   * an edge leaves the actor in the air to fall.
   */
  move(dx: number, dz: number) {
    const s = this.stage;
    // only the leading edge counts: higher ground behind is not a wall
    const ok = (x: number, z: number, edge: number) => Math.min(s.groundAt(x + edge, z), s.groundAt(x, z)) >= this.y - 12;
    if (dx && ok(this.x + dx, this.z, Math.sign(dx) * this.radius)) this.x += dx;
    if (dz && ok(this.x, this.z + dz, 0)) this.z += dz;
  }

  draw() {
    const [sx, sy] = this.screen();
    const st = this.anim.step;
    const dx = this.facing < 0 ? -st[3] : st[3];
    const fx = sx + dx, fy = sy + st[4];
    if (this.blink && (this.stage.time >> 1) & 1) return;
    drawSprite(st[0], this.pal, fx, fy, this.flip);
    if (this.flash > 0) drawSpriteTinted(st[0], fx, fy, this.flip, '#fff', 0.6);
  }
}
