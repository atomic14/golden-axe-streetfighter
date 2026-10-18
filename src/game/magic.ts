// Spells replay the original's effect objects tick by tick around the caster (recorded with
// tools/mame/magic.lua, see tools/magic.ts). Damage lands when the most effects are on screen.
import { drawSprite } from '../gfx';
import { audio } from '../audio';
import { Actor } from './actor';
import type { Hero } from './hero';
import type { Stage } from './stage';

export class MagicEffect extends Actor {
  tick = 0;
  peak: number;

  constructor(stage: Stage, public caster: Hero, public ticks: number[][][], public level: number) {
    super(stage);
    this.x = caster.x;
    this.z = caster.z + 0.5;
    this.y = caster.y;
    let best = 0;
    ticks.forEach((t, i) => { if (t.length > (ticks[best]?.length ?? 0)) best = i; });
    this.peak = Math.max(30, best);
    audio.sfx('magic');
  }

  get length() {
    return Math.max(this.ticks.length, 60);
  }

  update() {
    this.tick++;
    if (this.tick === this.peak) this.stage.magicDamage(this.caster, this.level);
    if (this.tick >= this.length) this.gone = true;
  }

  draw() {
    // effects can spread over the whole screen: draw each at its own depth position
    const t = this.ticks[this.tick];
    if (!t) return;
    for (const [frame, pal, flip, dx, dz, dy] of t) {
      const [sx, sy] = this.stage.project(this.x + dx, this.z - 0.5 + dz, this.y + dy);
      drawSprite(frame, pal, sx, sy, flip === 1);
    }
  }
}
