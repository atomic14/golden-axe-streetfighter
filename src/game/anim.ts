// Plays the ROM's animation scripts (interpreter at 0xbd54): each step shows a frame for `dur`
// ticks with a display offset (dx, dy), a flip flag and the body box; scripts loop at the end.
import { anim, type AnimStep } from '../assets';

export class AnimPlayer {
  addr = 0;
  steps: AnimStep[] = [];
  index = 0;
  timer = 0;
  /** true on the tick the script wrapped back to its first step */
  looped = false;
  /** true on the tick a new step started */
  stepped = false;

  set(addr: number, restart = false) {
    if (addr === this.addr && !restart) return;
    this.addr = addr;
    this.steps = anim(addr);
    this.index = 0;
    this.timer = this.steps[0][1];
    this.looped = false;
    this.stepped = true;
  }

  /** Jump to a step (scripts like the jump are driven by the game, not by time). */
  go(i: number) {
    if (i === this.index) return;
    this.index = Math.min(i, this.steps.length - 1);
    this.timer = this.steps[this.index][1];
    this.stepped = true;
  }

  tick() {
    this.looped = this.stepped = false;
    if (--this.timer > 0) return;
    this.index++;
    if (this.index >= this.steps.length) {
      this.index = 0;
      this.looped = true;
    }
    this.timer = this.steps[this.index][1];
    this.stepped = true;
  }

  get step(): AnimStep {
    return this.steps[this.index];
  }
  get frame() {
    return this.steps[this.index][0];
  }
  get last() {
    return this.index === this.steps.length - 1;
  }
}
