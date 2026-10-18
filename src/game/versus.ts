// Versus: one on one, on the flat ground where each area's boss is fought. Best of three rounds
// of 99 seconds; a round ends in a knock-out or on time (most health left wins). The fighting is
// the arcade game's own: the combo, grab, knees and throw, the dash and jump attacks, the back
// attack and magic. Thieves run through now and then carrying magic.
//
// The arcade ladder: the other two heroes, then the bosses of the original on their own ground,
// a Bad Brother, a knight and Death Adder. Lose and you can continue (the same fight again); beat
// Death Adder for the original's ending.
import { input } from '../input';
import { assets } from '../assets';
import { audio } from '../audio';
import { ctx, drawSprite, drawSpriteTinted, drawText, fillRect, W, H } from '../gfx';
import { Stage } from './stage';
import { Hero, HEROES } from './hero';
import { Enemy, KINDS } from './enemy';
import type { Fighter } from './fighter';
import { Brain } from './partner';
import { Thief } from './props';

const params = new URLSearchParams(location.search);
/** hero indices from left to right on the select screen */
const SELECT_ORDER = [2, 0, 1];
const ROUND_TIME = 99 * 60;
const WINS = 2;
/** where the fighters stand at the start of a round (screen x) */
const START = [100, 220];

/** A rung of the ladder: a hero (played by a brain this sharp) or a boss, and where. */
type Rung = { area: number } & (
  | { hero: number; think: number; aggression: number }
  | { boss: keyof typeof KINDS; name: string; pal: number; hp: number; rest: [number, number]; dmg: number }
);

/** The ladder for a hero: the other two (the second sharper), then the bosses. */
function ladder(hero: number): Rung[] {
  const rivals = SELECT_ORDER.filter((i) => i !== hero);
  return [
    { area: 1, hero: rivals[0], think: 9, aggression: 0.45 },
    { area: 3, hero: rivals[1], think: 6, aggression: 0.62 },
    // the palettes the original gives them (spawn.ts)
    { area: 0, boss: 'badbro', name: 'BAD BROTHER', pal: 0x38, hp: 64, rest: [36, 30], dmg: 12 },
    { area: 2, boss: 'knight', name: 'KNIGHT', pal: 0x86, hp: 64, rest: [24, 26], dmg: 12 },
    { area: 4, boss: 'adder', name: 'DEATH ADDER', pal: 0x50, hp: 80, rest: [24, 24], dmg: 12 },
  ];
}

export function nameOf(f: Fighter): string {
  if (f instanceof Hero) return f.def.name.split(' ')[0];
  return (f as Fighter & { title?: string }).title ?? '';
}

type State = 'title' | 'select' | 'loading' | 'vs' | 'intro' | 'fight' | 'ko' | 'over' | 'continue' | 'gameover' | 'ending';

export class Versus {
  state: State = 'title';
  t = 0;
  choice = 0;
  stage: Stage | null = null;
  /** the player (left) and the opponent (right) */
  fighters: Fighter[] = [];
  paused = false;
  round = 1;
  wins = [0, 0];
  clock = ROUND_TIME;
  /** who won the last round (-1 a draw) */
  winner = -1;
  koText = '';
  /** the ladder's rung being fought */
  rung = 0;
  rungs: Rung[] = [];
  /** ?demo: the computer plays the player's side too, continuing when it loses */
  demo = params.has('demo') || params.has('auto');
  private selMove = 0;
  private toastText = '';
  private toastTimer = 0;
  zMid = 0x1080;

  constructor() {
    if (this.demo) this.startLadder(Math.floor(Math.random() * 3));
  }

  get player() {
    return this.fighters[0] as Hero;
  }

  toast(text: string) {
    this.toastText = text;
    this.toastTimer = 90;
  }

  go(s: State) {
    this.state = s;
    this.t = 0;
  }

  update() {
    this.t++;
    const pr = input.pressed;
    const any = pr.start || pr.attack || pr.jump;
    switch (this.state) {
      case 'title':
        if (pr.start || pr.attack || pr.any) this.go('select');
        break;
      case 'select':
        if (this.t === 1) audio.music('select');
        if (this.t > 10) {
          if (input.pad.x && this.selMove === 0) {
            const slot = SELECT_ORDER.indexOf(this.choice);
            this.choice = SELECT_ORDER[Math.max(0, Math.min(2, slot + input.pad.x))];
          }
          this.selMove = input.pad.x;
          const tap = input.tapAt;
          if (tap && tap.y > 30 && tap.y < 200) {
            const i = SELECT_ORDER[Math.max(0, Math.min(2, Math.floor(tap.x / (W / 3))))];
            if (i === this.choice) this.startLadder(this.choice);
            else this.choice = i;
          } else if (any) this.startLadder(this.choice);
        }
        break;
      case 'vs':
        // who's next, over their arena (skippable)
        this.stage!.time++;
        for (const f of this.fighters) f.anim.tick();
        if (this.t >= 150 || (this.t > 20 && any)) this.startRound();
        break;
      case 'intro':
        // the fighters can't move until FIGHT
        this.stage!.time++;
        for (const f of this.fighters) f.anim.tick();
        if (this.t >= 110) this.go('fight');
        break;
      case 'fight': {
        if (pr.pause) this.paused = !this.paused;
        if (this.paused) return;
        const s = this.stage!;
        s.update();
        if (!s.frozen) this.clock--;
        this.thieves();
        const [a, b] = this.fighters;
        if (a.ko || b.ko) this.endRound(a.ko && b.ko ? -1 : a.ko ? 1 : 0, 'K.O.');
        else if (this.clock <= 0) {
          // on time, the larger share of health left wins (bosses have more)
          const ka = a.hp / a.maxHp, kb = b.hp / b.maxHp;
          this.endRound(ka === kb ? -1 : ka > kb ? 0 : 1, 'TIME');
        }
        break;
      }
      case 'ko':
        // the loser lands; the winner finishes what it was doing
        this.stage!.update();
        if (this.t >= 180) {
          if (Math.max(...this.wins) >= WINS) {
            this.go('over');
            audio.music(this.won ? 'select' : 'gameover');
          } else {
            this.round++;
            this.startRound();
          }
        }
        break;
      case 'over':
        this.stage!.update();
        if (this.t > 200 || (this.t > 60 && any)) {
          if (!this.won) this.go('continue');
          // ?stay: the same fight again (for tests measuring one rung)
          else if (params.has('stay')) void this.startFight(this.rung);
          else if (this.rung + 1 < this.rungs.length) void this.startFight(this.rung + 1);
          else this.startEnding();
        }
        break;
      case 'continue':
        // like feeding the arcade another coin: the same fight again
        if ((this.t > 30 && any) || (this.demo && this.t > 60)) void this.startFight(this.rung);
        else if (this.t >= 600) {
          this.go('gameover');
          audio.music('gameover');
        }
        break;
      case 'gameover':
        if (this.t > 120 && (pr.start || pr.attack)) this.go('title');
        break;
      case 'ending':
        if (this.t > 60 && (pr.start || pr.attack || pr.any)) this.endEnding();
        break;
    }
  }

  /** the player took the match */
  get won() {
    return this.wins[0] >= WINS && this.wins[0] > this.wins[1];
  }

  private endRound(winner: number, text: string) {
    this.winner = winner;
    if (winner >= 0) this.wins[winner]++;
    else this.wins = this.wins.map((w) => w + 1);
    this.koText = text;
    this.go('ko');
    audio.sfx(text === 'TIME' ? 'item' : 'fall');
  }

  /** a thief runs on twice a round with magic for whoever kicks him */
  private thieves() {
    const s = this.stage!;
    const due = this.clock === ROUND_TIME - 20 * 60 || this.clock === ROUND_TIME - 55 * 60;
    if (due) {
      const left = Math.random() < 0.5;
      const x = 0x1000 - s.camx - 8 + (left ? -20 : 340);
      const th = new Thief(s, x, this.zMid, 0x2000);
      th.z = this.zMid + (Math.random() < 0.5 ? -16 : 16);
      th.y = th.ground;
      th.facing = left ? 1 : -1;
      s.actors.push(th);
      (th as Thief & { born: number }).born = this.clock;
    }
    // they don't hang about: after 8 seconds they run off with what's left
    for (const a of s.actors) {
      if (a instanceof Thief && !a.fleeing && (a as Thief & { born: number }).born - this.clock > 8 * 60) {
        a.fleeing = true;
        a.facing = a.x - 0x1000 + s.camx + 8 < 160 ? -1 : 1;
      }
    }
  }

  startLadder(hero: number) {
    this.choice = hero;
    this.rungs = ladder(hero);
    // ?rung=n starts further up (for tests)
    void this.startFight(Number(params.get('rung') ?? 0));
  }

  async startFight(rung: number) {
    this.go('loading');
    this.rung = rung;
    const r = this.rungs[rung];
    const s = new Stage(r.area);
    await s.load();
    s.arena = true;
    // the boss's ground at the end of the area, under the boss fight's sky
    s.camx = s.data.cam[0][0];
    s.camy = s.camYRange(s.camx)[0];
    s.boss = true;
    s.buildLayers();
    // the middle of the flat ground's depth, under the middle of the screen
    const cx = 0x1000 - s.camx - 8 + 160;
    const g = s.groundAt(cx, s.floorZ(cx, 0x1080));
    const rows: number[] = [];
    for (let z = 0xf84; z < 0x1180; z += 8) if (s.groundAt(cx, z) === g) rows.push(z);
    this.zMid = rows.length ? rows[Math.floor(rows.length / 2)] : 0x1080;
    const p = new Hero(s, this.choice);
    if (this.demo) p.brain = new Brain(p, null);
    let o: Fighter;
    if ('hero' in r) {
      const h = new Hero(s, r.hero);
      h.brain = new Brain(h, null);
      h.brain.think = r.think;
      h.brain.aggression = r.aggression;
      o = h;
    } else {
      const e = new Enemy(s, KINDS[r.boss], 0, this.zMid, r.pal);
      e.hp = e.maxHp = r.hp;
      e.rest = r.rest;
      e.entering = false;
      e.armor = true;
      // the original's 16 a blow is a third of a hero's health: four or five blows here
      e.damage = (d: number) => Math.min(d, r.dmg);
      Object.assign(e, { title: r.name });
      o = e;
    }
    p.foe = o;
    o.foe = p;
    this.fighters = [p, o];
    s.heroes = [p, o].filter((f): f is Hero => f instanceof Hero);
    // a boss fights the player alone
    if (!(o instanceof Hero)) s.heroes = [p];
    this.stage = s;
    this.wins = [0, 0];
    this.round = 1;
    audio.music('boss' in r ? 'boss' : `area${r.area}`);
    this.place();
    this.go('vs');
  }

  /** everyone back to their corners, fresh */
  private place() {
    const s = this.stage!;
    s.actors = [...this.fighters];
    s.frozen = null;
    this.fighters.forEach((f, i) => {
      f.x = 0x1000 - s.camx - 8 + START[i];
      f.z = this.zMid;
      f.y = f.ground;
      f.vx = f.vy = f.vz = 0;
      f.hp = f.maxHp;
      f.dead = false;
      f.invuln = 0;
      f.flash = 0;
      f.blink = false;
      f.heldBy = null;
      f.hitCount = 0;
      f.facing = i === 0 ? 1 : -1;
      if (f instanceof Hero) {
        f.grabbed = null;
        f.thrown = null;
        f.potions = 0;
        f.combo = 0;
      } else if (f instanceof Enemy) f.cooldown = 40;
      f.setState('stand', f.anims.idle);
    });
  }

  private startRound() {
    this.place();
    this.clock = ROUND_TIME;
    this.go('intro');
  }

  /** The original's ending, rendered from a recording into a video with its music. */
  startEnding() {
    this.go('ending');
    audio.music(null);
    const v = document.getElementById('ending') as HTMLVideoElement;
    const c = document.getElementById('screen')!.getBoundingClientRect();
    Object.assign(v.style, { left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, height: `${c.height}px` });
    v.src = `${import.meta.env.BASE_URL}assets/ending.mp4`;
    v.classList.add('show');
    v.onended = () => this.endEnding();
    v.onerror = () => this.endEnding();
    void v.play().catch(() => this.endEnding());
  }

  endEnding() {
    const v = document.getElementById('ending') as HTMLVideoElement;
    v.pause();
    v.classList.remove('show');
    v.removeAttribute('src');
    if (this.demo) this.startLadder(Math.floor(Math.random() * 3));
    else this.go('title');
  }

  /** How to play, under the fighters on the select screen, for whatever is being played with. */
  private drawControls() {
    const pad = [...(navigator.getGamepads?.() ?? [])].some(Boolean);
    // the keyboard also takes the arrows and Z X C (see the README); this shows WASD and J K L
    const lines = input.touch
      ? ['STICK MOVES  TAP IT TWICE TO RUN', 'ATTACK AND JUMP TOGETHER: BACK ATTACK', 'RUN AND ATTACK: DASH  CLOSE IN: GRAB']
      : pad
        ? ['X ATTACK  A JUMP  Y MAGIC  SHOULDER RUN', 'B BACK ATTACK  TAP TWICE TO RUN TOO', 'RUN+ATTACK DASH  CLOSE IN+ATTACK GRAB']
        : ['WASD MOVE  J ATTACK  K JUMP  L MAGIC', 'J+K BACK ATTACK  SHIFT OR TAP TWICE RUN', 'RUN+ATTACK DASH  CLOSE IN+ATTACK GRAB'];
    fillRect(0, 192, W, 32, 'rgba(0,0,0,0.6)');
    lines.forEach((l, i) => drawText(l, W / 2, 194 + i * 10, i ? '#ccc' : '#fff', 'center'));
  }

  draw() {
    fillRect(0, 0, W, H, '#000');
    switch (this.state) {
      case 'title':
        if (assets.title) ctx.drawImage(assets.title, 0, 0);
        drawText('STREET FIGHTER', W / 2, 100, '#ff0', 'center');
        if ((this.t >> 5) & 1) drawText(input.touch ? 'TAP TO START' : 'PRESS START', W / 2, 116, '#36f', 'center');
        break;
      case 'select': {
        if (assets.select) ctx.drawImage(assets.select, 0, 0);
        SELECT_ORDER.forEach((i, slot) => {
          const h = HEROES[i], x = 62 + slot * 98, on = i === this.choice;
          drawSprite(0x1c2 + i, h.pal, x, 176 - (on ? 4 : 0), false);
          if (!on) drawSpriteTinted(0x1c2 + i, x, 176, false, '#000', 0.5);
          drawText(h.name.split(' ')[0], x, 180, on ? '#ff0' : '#aaa', 'center');
        });
        drawText('CHOOSE YOUR FIGHTER', W / 2, 8, '#ff0', 'center');
        this.drawControls();
        break;
      }
      case 'loading':
        drawText('LOADING', W / 2, H / 2, '#888', 'center');
        break;
      case 'continue':
        drawText('CONTINUE?', W / 2, 84, '#ff0', 'center');
        drawText(String(Math.max(0, 9 - Math.floor(this.t / 60))), W / 2, 100, '#fff', 'center');
        if ((this.t >> 4) & 1) drawText(input.touch ? 'TAP TO CONTINUE' : 'PRESS ATTACK TO CONTINUE', W / 2, 118, '#8af', 'center');
        break;
      case 'gameover':
        drawText('GAME OVER', W / 2, H / 2, '#f22', 'center');
        break;
      case 'ending':
        break;
      case 'vs': {
        this.stage!.draw();
        // above the fighters' heads
        const y = 20;
        fillRect(0, y, W, 56, 'rgba(0,0,0,0.65)');
        const last = this.rung === this.rungs.length - 1;
        drawText(last ? 'FINAL BATTLE' : `BATTLE ${this.rung + 1}`, W / 2, y + 6, '#f80', 'center');
        const [a, b] = this.fighters.map(nameOf);
        drawText(a, W / 2 - 16, y + 26, '#fff', 'right');
        drawText('VS', W / 2, y + 26, '#f22', 'center');
        drawText(b, W / 2 + 16, y + 26, '#fff', 'left');
        // the ladder: a dot per rung, lit up to here
        this.rungs.forEach((_, i) => fillRect(W / 2 - this.rungs.length * 6 + i * 12 + 2, y + 42, 8, 8, i < this.rung ? '#ff0' : i === this.rung ? '#f80' : '#444'));
        break;
      }
      default: {
        this.stage!.draw();
        this.drawHud();
        const names = this.fighters.map(nameOf);
        if (this.state === 'intro') {
          if (this.t < 70) drawText(`ROUND ${this.round}`, W / 2, 90, '#ff0', 'center');
          else drawText('FIGHT', W / 2, 90, '#f80', 'center');
        } else if (this.state === 'ko' && this.t > 20) {
          drawText(this.koText, W / 2, 80, '#f22', 'center');
          if (this.t > 70) drawText(this.winner < 0 ? 'DRAW' : `${names[this.winner]} WINS`, W / 2, 96, '#ff0', 'center');
        } else if (this.state === 'over') {
          const w = this.wins[0] === this.wins[1] ? -1 : this.wins[0] > this.wins[1] ? 0 : 1;
          drawText(w < 0 ? 'DRAW GAME' : w === 0 ? 'YOU WIN' : `${names[1]} WINS`, W / 2, 90, '#ff0', 'center');
        }
        if (this.paused) drawText('PAUSED', W / 2, 110, '#fff', 'center');
      }
    }
    if (this.toastTimer > 0) {
      this.toastTimer--;
      fillRect(0, 40, W, 13, 'rgba(0,0,0,0.6)');
      drawText(this.toastText, W / 2, 43, '#ff0', 'center');
    }
  }

  private drawHud() {
    const BAR = 120;
    // the clock
    drawText(String(Math.max(0, Math.ceil(this.clock / 60))).padStart(2, '0'), W / 2, 10, '#fff', 'center');
    this.fighters.forEach((f, i) => {
      const left = i === 0;
      const x0 = left ? 16 : W - 16 - BAR;
      // health drains towards the middle of the screen
      fillRect(x0 - 1, 9, BAR + 2, 10, '#000');
      fillRect(x0, 10, BAR, 8, '#a00');
      const w = Math.round((BAR * Math.max(0, f.hp)) / f.maxHp);
      if (w > 0) fillRect(left ? x0 + BAR - w : x0, 10, w, 8, f.hp <= f.maxHp / 4 ? '#f80' : '#ff0');
      drawText(nameOf(f), left ? x0 : x0 + BAR, 22, '#fff', left ? 'left' : 'right');
      // rounds won
      for (let k = 0; k < WINS; k++) {
        const wx = left ? x0 + BAR - 8 - k * 10 : x0 + k * 10 + 1;
        fillRect(wx, 23, 7, 7, '#000');
        if (k < this.wins[i]) fillRect(wx + 1, 24, 5, 5, '#ff0');
      }
      // magic jars
      const jars = f instanceof Hero ? f.potions : 0;
      for (let k = 0; k < jars; k++) {
        const jx = left ? x0 + k * 8 : x0 + BAR - 7 - k * 8;
        fillRect(jx, 32, 7, 10, '#36f');
        fillRect(jx + 2, 33, 3, 3, '#9cf');
      }
    });
  }
}
