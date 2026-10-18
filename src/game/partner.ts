// A computer-controlled hero. It plays through the same virtual stick and buttons as a person
// (so it is held to the same rules), deciding every few ticks:
//  - who to fight: the nearest hostile enemy it can reach, preferring ones going for its leader,
//    and thieves carrying something;
//  - where to stand: level with the target in depth (hits need |dz| < 7) at swinging distance,
//    on its own side of it, turning round with a back attack when something closes in behind;
//  - how to get there: a breadth-first search over the stage's height map on screen, walking,
//    dropping off ledges and jumping up them, never into a pit;
//  - otherwise: following its leader without getting in front (the camera follows people, not
//    the partner), picking up only what the leader doesn't need, and leaving beasts to the leader.
// Without a leader (tests) it plays alone and walks right.
import { anim, attackOf } from '../assets';
import type { Pad } from '../input';
import type { Actor } from './actor';
import type { Fighter } from './fighter';
import type { Hero } from './hero';
import { Beast, Fireball } from './mount';
import { Item, Thief } from './props';

const PIT = 0xd0;
const WALL = 0x20;
/** the first step of a route, and how close (in cells, depth counting double) it gets */
type Step = { c: number; r: number; jump: boolean; miss: number; leap?: Step };

const emptyPad = (): Pad => ({ x: 0, y: 0, attack: false, jump: false, magic: false, run: false });

export class Brain {
  /** ticks between decisions: lower reacts faster */
  think = 6;
  /** cast magic at all */
  magic = true;
  target: Fighter | null = null;
  private t = Math.floor(Math.random() * 6);
  private prev = emptyPad();
  private goal: [number, number] | null = null;
  private next: Step | null = null;
  private wantMagic = false;
  private wantBack = false;
  private atLeft = 0;
  private jumpDir = 0;
  private commit: { leap: Step; until: number } | null = null;
  /** ticks to leave beasts alone after having to get off one */
  private noBeast = 0;
  /** ticks spent pushing the stick without getting anywhere */
  private stuck = 0;
  private lastPos = [0, 0];
  /** what the brain decided last, for tests */
  doing = '';

  constructor(public hero: Hero, public leader: Hero | null = null) {}

  private get stage() {
    return this.hero.stage;
  }

  /** The buttons for this tick, with their press edges. */
  read(): { pad: Pad; pressed: { attack: boolean; jump: boolean; magic: boolean } } {
    const h = this.hero;
    if (++this.t % this.think === 0) this.decide();
    const p = emptyPad();
    if (h.mount) this.ride(p);
    else if (h.state === 'squat') p.x = this.jumpDir;
    else if (h.foe && h.state !== 'air') this.steerVersus(p);
    else if (h.state === 'air') {
      // keep swinging on the way down (the jump attack only reaches standing enemies low)
      p.attack = !!this.target && h.vy > 1.5 && Math.abs(this.target.x - h.x) < 50 && this.t % 2 === 0;
      if (this.next?.jump) p.x = Math.sign(this.next.c * 8 + 0x1004 - h.x);
    } else this.steer(p);
    const pressed = {
      attack: p.attack && !this.prev.attack,
      jump: p.jump && !this.prev.jump,
      magic: p.magic && !this.prev.magic,
    };
    this.prev = p;
    return { pad: p, pressed };
  }

  // ---- what may it have ------------------------------------------------------------------------

  private get leaderIn() {
    const l = this.leader;
    return l && !l.dead && l.state !== 'respawn' && l.state !== 'gameover' ? l : null;
  }

  /** Items: the leader comes first unless it doesn't need it. */
  wants(item: Item): boolean {
    const h = this.hero, l = this.leaderIn;
    if (item.type === 'potion') return h.potions < h.def.magicLevels && (!l || l.potions >= l.def.magicLevels);
    return h.hp < h.maxHp && (!l || l.hp >= l.maxHp || h.hp + 8 < l.hp);
  }

  /** Beasts: only once the leader has one, or is nowhere near this one. */
  mayMount(b: Beast): boolean {
    const l = this.leaderIn;
    return this.noBeast <= 0 && (!l || !!l.mount || Math.abs(l.x - b.x) > 140);
  }

  // ---- deciding ------------------------------------------------------------------------------------

  private sx(x: number) {
    return x - 0x1000 + this.stage.camx + 8;
  }

  private onScreen(a: Actor, m = 0) {
    const sx = this.sx(a.x);
    return sx > -m && sx < 320 + m;
  }

  private foes(): Fighter[] {
    return this.stage.actors.filter((a) => a.isEnemy && !a.dead && !a.gone && this.onScreen(a)) as Fighter[];
  }

  private decide() {
    if (this.hero.foe) return this.decideVersus();
    const h = this.hero, s = this.stage;
    if (this.noBeast > 0) this.noBeast -= this.think;
    this.wantMagic = false;
    this.wantBack = false;
    if (h.dead || h.state === 'respawn' || h.state === 'gameover') return;
    const foes = this.foes();
    const hostile = foes.filter((f) => f.hostile);
    const l = this.leaderIn;
    // pick a target: close, level, reachable; help the leader; chase thieves with something
    let best: Fighter | null = null, bd = 1e9;
    for (const f of foes) {
      if (!f.vulnerable && !['down', 'getup', 'fly'].includes(f.state)) continue;
      if (f instanceof Thief && !f.vulnerable) continue;
      // only enemies that count (and thieves); not a free beast or one a hero rides
      if (!f.hostile && !(f instanceof Thief)) continue;
      let d = Math.abs(f.x - h.x) + 2 * Math.abs(f.z - h.z);
      if (Math.abs(f.ground - h.ground) > 64) d += 200;
      if (l && (f as Fighter & { target?: Hero }).target === l && Math.abs(f.x - l.x) < 80) d -= 40;
      if (f instanceof Thief) d -= 60;
      if (f === this.target) d -= 24;
      if (d < bd) { bd = d; best = f; }
    }
    this.target = best;
    // magic when crowded, or to save the leader
    if (this.magic && h.potions > 0 && !s.frozen) {
      const near = hostile.filter((f) => Math.abs(f.x - h.x) < 120).length;
      this.wantMagic = near >= 3 || (near >= 2 && (h.hp < 16 || (!!l && l.hp < 12)));
    }
    let goal: [number, number] | null = null;
    // dodge a fireball coming our way
    for (const a of s.actors) {
      if (!(a instanceof Fireball) || a.burst || a.owner.isHero) continue;
      const dx = h.x - a.x;
      if (Math.abs(a.z - h.z) < 10 && Math.sign(dx) === a.facing && Math.abs(dx) < 120) {
        goal = [h.x, h.z + (s.groundAt(h.x, h.z + 20) === h.ground ? 20 : -20)];
        this.doing = 'dodge';
      }
    }
    const t = this.target;
    if (!goal && t) {
      // stand on our side of it at swinging distance (the first swing lands from 6 to 48px)
      let side = h.x < t.x ? -1 : 1;
      const reach = t instanceof Thief ? 16 : 26;
      const bad = (x: number) => this.sx(x) < 16 || this.sx(x) > 304 || s.groundAt(x, t.z) >= PIT * 8 + 0xe00;
      if (bad(t.x + side * reach)) side = -side;
      goal = [t.x + side * reach, t.z];
      this.doing = t instanceof Thief ? 'thief' : 'fight';
      // something closing in behind while we face the target: turn and hit it (where this
      // hero's back attack lands: Gilius leaps much further than the others)
      const [near, far] = this.backReach();
      const behind = hostile.find((f) => f !== t && f.vulnerable && Math.abs(f.z - h.z) < 6 &&
        -(f.x - h.x) * h.facing > near && -(f.x - h.x) * h.facing < far);
      this.wantBack = !!behind && Math.abs(t.x - h.x) > 40;
    }
    if (!goal) {
      const reachable = (a: Actor) => (this.route([a.x, a.z])?.miss ?? 0) <= 2;
      const item = s.actors.find((a) => a instanceof Item && this.onScreen(a) && this.wants(a) && reachable(a)) as Item | undefined;
      const beast = s.actors.find((a) => a instanceof Beast && !a.rider && this.onScreen(a, -16) && this.mayMount(a) && reachable(a)) as Beast | undefined;
      if (item) { goal = [item.x, item.z]; this.doing = 'item'; }
      else if (beast && !h.mount) { goal = [beast.x, beast.z]; this.doing = 'beast'; }
      else if (l) {
        // behind the leader (the way the screen scrolls) and a little to one side in depth
        const back = l.facing > 0 ? -44 : 44;
        let gx = l.x + back;
        if (this.sx(gx) < 24) gx = l.x + 44;
        const near = Math.abs(gx - h.x) < 36 && Math.abs(l.z - h.z) < 30;
        goal = near ? null : [gx, l.z + (h.z < l.z ? -12 : 12)];
        this.doing = 'follow';
      } else {
        goal = [h.x + 200, h.z];
        this.doing = 'explore';
      }
    }
    this.goal = goal;
    this.next = goal ? this.route(goal) : null;
    // stuck at the left edge, far behind: drop back in beside the leader (as a respawn would)
    this.atLeft = this.sx(h.x) < 26 && l && Math.abs(l.x - h.x) > 120 ? this.atLeft + this.think : 0;
    if (this.atLeft > 240 && l) {
      this.atLeft = 0;
      h.dropIn(l.x - 30 * l.facing, l.z);
    }
  }

  /** how far behind the hero its back attack lands, from the script's attack header */
  private backReach(): [number, number] {
    const a = this.hero.anims.back, hdr = attackOf(a);
    if (!hdr) return [14, 56];
    const lunge = anim(a)[hdr[2]]?.[3] ?? 0;
    return [lunge + hdr[3] + 4, lunge + hdr[4] - 4];
  }

  // ---- moving ------------------------------------------------------------------------------------

  private steer(p: Pad) {
    const h = this.hero, t = this.target;
    if (this.wantMagic && ['stand', 'walk', 'run'].includes(h.state)) {
      p.magic = true;
      return;
    }
    if (this.goal) {
      const [gx, gz] = (!this.next?.jump && this.waypoint()) || this.goal;
      const dx = gx - h.x, dz = gz - h.z;
      p.x = Math.abs(dx) > 3 ? Math.sign(dx) : 0;
      p.y = Math.abs(dz) > 2 ? Math.sign(dz) : 0;
      p.run = Math.abs(dx) > 110 && Math.abs(dz) < 8;
      const n = this.next;
      // once lining up a jump, stick with it (routes of equal length can flip-flop)
      if (this.commit && (this.t > this.commit.until || !['stand', 'walk', 'run'].includes(h.state))) this.commit = null;
      const leap = this.commit?.leap ?? (n?.jump ? n : n?.leap);
      let leaping = false, go = false;
      if (leap) {
        // up a ledge or over a pit: find the nearest take-off point from which the jump (as
        // the game would play it) lands where we want, walk there, line up in depth and go
        const lx = leap.c * 8 + 0x1004, lz = leap.r * 8 + 0xf84, dir = Math.sign(lx - h.x) || h.facing;
        const land = this.stage.groundAt(lx, lz);
        const from = this.takeOff(h.x, lz, h.ground, dir, land);
        leaping = from !== null;
        if (from !== null) {
          const off = from - h.x;
          p.x = Math.abs(off) < 1.5 ? 0 : Math.sign(off);
          go = Math.abs(off) < 1.5;
        }
        if (leaping) {
          this.commit ??= { leap, until: this.t + 90 };
          p.y = Math.abs(lz - h.z) > 2 ? Math.sign(lz - h.z) : 0;
          p.run = false;
          if (go && Math.abs(lz - h.z) < 4) {
            // the jump goes the way the stick points when the crouch ends (see read)
            p.x = 0;
            p.jump = !this.prev.jump;
            this.jumpDir = dir;
          }
        }
      }
      // never walk into a pit or off the screen (a jump over one takes off from the edge)
      if (p.x && !leaping && this.unsafe(h.x + p.x * 12, h.z)) p.x = 0;
      if (p.y && this.unsafe(h.x, h.z + p.y * 6)) p.y = 0;
      if (p.run && !p.x) p.run = false;
      // pushing and not moving: try another way for a moment
      if (this.stalled(p, ['walk', 'run'].includes(h.state)) > 40) {
        const k = Math.floor(this.stuck / 40) % 3;
        if (k === 1) p.y = p.y ? -p.y : (this.t & 64 ? 1 : -1);
        else if (k === 2) { p.x = -p.x; p.y = 0; }
        p.run = false;
        if (this.stuck > 200) this.stuck = 0;
      }
    }
    if (t && t.vulnerable) {
      const dx = t.x - h.x, adz = Math.abs(t.z - h.z);
      if (adz < 5 && Math.abs(dx) < 46 && Math.abs(dx) > 4) {
        if (Math.sign(dx) !== h.facing) p.x = Math.sign(dx); // turn to face it
        else {
          p.x = 0;
          // tap attack: the hero chains the combo while hits land
          p.attack = this.t % 4 < 2;
        }
      }
    }
    if (this.wantBack && !p.attack && ['stand', 'walk'].includes(h.state) && this.t % 8 === 0) {
      p.attack = p.jump = true;
      p.x = 0;
    }
  }

  private getOff(p: Pad) {
    p.jump = this.t % 4 === 0;
    this.noBeast = 600;
  }

  /**
   * The nearest x (within 40px, on the same ground) to jump from, heading `dir`, to land on
   * ground `land`: each candidate is tried by playing the jump the way the game does (the
   * 12-tick crouch doesn't move; then 5.75px/tick up under 0.25 gravity, drifting 1px a tick,
   * stopped by anything more than 12px above the feet).
   */
  private takeOff(x: number, z: number, ground: number, dir: number, land: number): number | null {
    const s = this.stage;
    const g = (x: number) => s.groundAt(x, z);
    const lands = (x: number) => {
      let y = ground, vy = -5.75;
      for (let t = 0; t < 120; t++) {
        y += vy;
        vy += 0.25;
        const nx = x + dir;
        if (Math.min(g(nx + dir * this.hero.radius), g(nx)) >= y - 12) x = nx;
        if (y >= g(x) && vy >= 0) return g(x) === land;
        if (y > 0x1480) return false;
      }
      return false;
    };
    for (let o = 0; o <= 40; o += 1.5) {
      for (const xx of o ? [x + o, x - o] : [x]) {
        if (g(xx) !== ground || g(xx + this.hero.radius) > ground + 8 || g(xx - this.hero.radius) > ground + 8) continue;
        if (lands(xx)) return xx;
      }
    }
    return null;
  }

  /** the centre of the next cell on the route, unless we are in it */
  private waypoint(): [number, number] | null {
    const h = this.hero, n = this.next;
    if (!n || (n.c === (h.x - 0x1000) >> 3 && n.r === (h.z - 0xf80) >> 3)) return null;
    return [n.c * 8 + 0x1004, n.r * 8 + 0xf84];
  }

  /** ticks the stick has been pushed without the hero getting anywhere */
  private stalled(p: Pad, walking: boolean) {
    const h = this.hero;
    const moved = Math.abs(h.x - this.lastPos[0]) + Math.abs(h.z - this.lastPos[1]) > 0.3;
    this.lastPos = [h.x, h.z];
    this.stuck = (p.x || p.y) && !moved && walking ? this.stuck + 1 : 0;
    return this.stuck;
  }

  private unsafe(x: number, z: number) {
    const s = this.stage, sx = this.sx(x);
    return sx < 14 || sx > 306 || s.groundAt(x, z) >= PIT * 8 + 0xe00;
  }

  /** On a beast: get level with the target at the beast's reach and let it rip. */
  private ride(p: Pad) {
    const h = this.hero, b = h.mount!, t = this.target;
    // beasts can't climb or jump: get off for a target up on a ledge (or down off one)
    if (t && Math.abs(t.ground - b.ground) > 12 && !t.airborne) return this.getOff(p);
    const reach = b.type === 'chicken' ? 40 : b.type === 'blue' ? 70 : 110;
    let gx: number, gz: number;
    if (t) {
      let side = h.x < t.x ? -1 : 1;
      if (this.sx(t.x + side * reach) < 20 || this.sx(t.x + side * reach) > 300) side = -side;
      [gx, gz] = [t.x + side * reach, t.z];
    } else if (this.goal) {
      // beasts can't jump: get off where the way on needs a jump
      if (this.next?.jump) return this.getOff(p);
      [gx, gz] = this.waypoint() ?? this.goal;
    } else return;
    const dx = gx - h.x, dz = gz - h.z;
    p.x = Math.abs(dx) > 3 ? Math.sign(dx) : 0;
    p.y = Math.abs(dz) > 2 ? Math.sign(dz) : 0;
    if (p.x && this.unsafe(h.x + p.x * 20, h.z)) p.x = 0;
    if (p.y && this.unsafe(h.x, h.z + p.y * 8)) p.y = 0;
    // going nowhere for a second: get off and walk
    if (this.stalled(p, b.state === 'walk') > 60) return this.getOff(p);
    if (t && Math.abs(t.z - h.z) < 6 && Math.abs(t.x - h.x) < reach + 12) {
      if (Math.sign(t.x - h.x) !== h.facing) p.x = Math.sign(t.x - h.x);
      else p.attack = this.t % 6 < 3;
    }
  }

  /**
   * Breadth-first search over 8px cells on screen from the hero towards the goal: walk to cells
   * at most a small step up, drop to lower ones, jump (sideways) up to 64px, never into pits or
   * walls. Returns the first step of the way to the reachable cell nearest the goal.
   */
  private route([gx, gz]: [number, number]): Step | null {
    const s = this.stage, h = this.hero;
    const hm = (c: number, r: number) => (c < 0 || c > 255 || r < 0 || r > 63 ? 0 : s.height[c * 64 + r]);
    const c0 = (h.x - 0x1000) >> 3, r0 = (h.z - 0xf80) >> 3;
    // screen x 16..304 (world x = screen x + 0x1000 - camx - 8)
    const left = (8 - s.camx) >> 3, right = (296 - s.camx) >> 3;
    const gc = (gx - 0x1000) >> 3, gr = (gz - 0xf80) >> 3;
    const key = (c: number, r: number) => c * 64 + r;
    const prev = new Map<number, number>([[key(c0, r0), -1]]);
    const jumpTo = new Set<number>();
    const q: [number, number][] = [[c0, r0]];
    let best = key(c0, r0), bd = Math.abs(gc - c0) + 2 * Math.abs(gr - r0);
    // somewhere to stand: not a wall or pit, and (the body being 8px either side of the feet)
    // not a gap between two walls
    const ok = (c: number, r: number) => {
      const v = hm(c, r);
      return v > WALL && v < PIT && (hm(c - 1, r) >= v - 1 || hm(c + 1, r) >= v - 1);
    };
    const visit = (nc: number, nr: number, c: number, r: number, jump: boolean) => {
      const k = key(nc, nr);
      if (prev.has(k)) return;
      prev.set(k, key(c, r));
      if (jump) jumpTo.add(k);
      q.push([nc, nr]);
      const d = Math.abs(gc - nc) + 2 * Math.abs(gr - nr);
      if (d < bd) { bd = d; best = k; }
    };
    for (let i = 0; i < q.length && i < 3000; i++) {
      const [c, r] = q[i];
      const v = hm(c, r);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, k = key(nc, nr);
        if (nc < left || nc > right || prev.has(k)) continue;
        const nv = hm(nc, nr);
        if (!ok(nc, nr)) continue;
        const up = v - nv; // in 8px steps
        let jump = false;
        if (up > 1) {
          if (dr !== 0 || up > 8) continue;
          jump = true;
        }
        visit(nc, nr, c, r, jump);
      }
      // jump sideways over a pit to ground 2-5 cells on, no more than 32px up
      for (const dc of [1, -1]) {
        if (hm(c + dc, r) < PIT) continue;
        for (let n = 2; n <= 5; n++) {
          const nc = c + dc * n, nv = hm(nc, r);
          if (nc < left || nc > right || nv <= WALL) break;
          if (nv >= PIT) continue;
          if (v - nv <= 4 && ok(nc, r)) visit(nc, r, c, r, true);
          break;
        }
      }
    }
    if (best === key(c0, r0)) return bd <= 2 ? null : { c: c0, r: r0, jump: false, miss: bd };
    // the way there, then aim a few cells along it (up to any jump) rather than at the next cell
    const path: number[] = [];
    for (let k = best; k !== key(c0, r0); k = prev.get(k)!) path.unshift(k);
    let k = path[0];
    for (let i = 1; i < Math.min(4, path.length) && !jumpTo.has(path[i]) && !jumpTo.has(k); i++) k = path[i];
    // and the first jump coming up, to take off for at the right distance
    const j = path.slice(0, 4).find((p) => jumpTo.has(p));
    const step = (k: number): Step => ({ c: Math.floor(k / 64), r: k % 64, jump: jumpTo.has(k), miss: bd });
    return { ...step(k), leap: j !== undefined && j !== k ? step(j) : undefined };
  }

  // ---- versus ------------------------------------------------------------------------------------
  // One on one, on a flat arena: no routes to find. Every so often the brain picks a plan and
  // carries it out until it lands, fails or runs out of time; it gets out of the way of the
  // opponent's swings (sideways in depth, as the arcade game plays) and stays off them while
  // they are down. `aggression` (0..1) sets how often it goes in rather than waits.
  aggression = 0.5 + Math.random() * 0.3;
  plan: 'press' | 'grab' | 'jump' | 'dash' | 'space' | 'evade' | 'thief' | 'punish' = 'space';
  private planUntil = 0;
  private evadeZ = 0;
  /** whether it's safe to commit to an attack now */
  private safe = true;
  /** how often it reads a boss's rhythm right (0..1) */
  timing = 0.75;

  private decideVersus() {
    const h = this.hero, f = h.foe!, s = this.stage;
    this.wantMagic = false;
    this.wantBack = false;
    if (h.dead || h.ko || f.ko) {
      this.target = null;
      return;
    }
    this.target = f;
    // a thief with something: go and kick it, unless the opponent is in our face
    const thief = s.actors.find((a) => a instanceof Thief && a.vulnerable && this.onScreen(a, -16)) as Thief | undefined;
    const dx = f.x - h.x, adx = Math.abs(dx), adz = Math.abs(f.z - h.z);
    const threat = f.vulnerable && adx < 60 && adz < 10;
    if (thief && !threat && Math.abs(thief.x - h.x) < Math.abs(thief.x - f.x) + 40) {
      this.target = thief;
      this.plan = 'thief';
      this.planUntil = this.t + 30;
    } else if (this.plan === 'thief') this.planUntil = 0;
    // magic: with a few jars, or a couple when it would finish them or we're losing
    if (h.potions > 0 && !s.frozen && f.vulnerable) {
      this.wantMagic = h.potions >= 3 || (h.potions >= 2 && (f.hp <= 4 + h.potions * 3 || h.hp < f.hp - 12));
    }
    // their swing is coming: get out of its line
    const swinging = ['attack', 'back', 'dash'].includes(f.state) || (f.state === 'air' && f.anim.addr === f.anims.jumpAttack);
    // a boss's swing can't be stopped: always get out of its way (its blow can reach behind it too)
    const boss = f.armor;
    const hdr = swinging ? attackOf(f.anim.addr) : undefined;
    const struck = !!hdr && f.anim.index > hdr[2];
    const facingUs = (f.x < h.x) === (f.facing > 0);
    if (swinging && !struck && adx < (boss ? 90 : 64) && adz < 8 && (facingUs || boss) && this.plan !== 'evade' && (boss || Math.random() < 0.6)) {
      this.plan = 'evade';
      this.planUntil = this.t + (boss ? 18 : 24);
      const room = (z: number) => s.groundAt(h.x, z) === h.ground;
      this.evadeZ = room(h.z + 24) && (Math.random() < 0.5 || !room(h.z - 24)) ? 24 : -24;
      return;
    }
    // a boss's blow has passed: in while it recovers
    if (boss && f.state === 'attack' && struck && this.plan !== 'punish') {
      this.plan = 'punish';
      this.planUntil = this.t + 40;
      return;
    }
    // a boss only gets hit when it's safe: recovering from a blow, or just starting a rest (a
    // person learns its rhythm; anything slow started into its swing gets the hero flattened)
    // (`timing` is how often it reads that right)
    this.safe = !boss || Math.random() > this.timing ||
      (f.state === 'attack' ? struck : ((f as Fighter & { cooldown?: number }).cooldown ?? 0) > 24);
    // directly behind us and close: the back attack
    const [near, far] = this.backReach();
    const behind = -dx * h.facing;
    this.wantBack = this.safe && f.vulnerable && adz < 6 && behind > near && behind < far && ['stand', 'walk'].includes(h.state);
    if (this.t < this.planUntil) return;
    // a new plan
    const r = Math.random();
    const go = this.aggression + (h.hp > f.hp + 8 ? 0.1 : 0) - (h.hp < f.hp - 8 ? 0.15 : 0);
    if (r > go) this.plan = 'space';
    else {
      const k = Math.random();
      this.plan = adx > 110 ? (k < 0.5 ? 'dash' : 'press') : k < 0.45 ? 'press' : k < 0.7 ? 'grab' : k < 0.88 ? 'jump' : 'dash';
    }
    this.planUntil = this.t + 60 + Math.floor(Math.random() * 90);
  }

  /** backing away from the foe to get into position (see towards in steerVersus) */
  private backing = false;

  private steerVersus(p: Pad) {
    const h = this.hero, f = h.foe!;
    const t = this.target;
    // keep the combo (or the knees in a grab) going
    if (t && ['attack', 'grab'].includes(h.state)) {
      p.attack = this.t % 4 < 2;
      return;
    }
    if (!t || !['stand', 'walk', 'run'].includes(h.state)) return;
    if (this.wantMagic) {
      p.magic = true;
      return;
    }
    if (this.wantBack && this.t % 4 === 0) {
      p.attack = p.jump = true;
      return;
    }
    const dx = t.x - h.x, adx = Math.abs(dx), side = dx > 0 ? 1 : -1, dz = t.z - h.z;
    const lined = Math.abs(dz) < 5;
    // stepping back turns us away from them, so only start backing off when well out of place, then
    // go all the way: otherwise backing off and turning round again flips the sprite every frame
    const towards = (gx: number, gz: number, run = false, slack = 12) => {
      const ex = gx - h.x, ez = gz - h.z;
      if (Math.sign(ex) === side || Math.abs(ex) <= 3) this.backing = false;
      else if (Math.abs(ex) > slack) this.backing = true;
      p.x = Math.abs(ex) > 3 && (Math.sign(ex) === side || this.backing) ? Math.sign(ex) : 0;
      // nowhere to back off to against the screen edge
      const ox = this.sx(h.x) + p.x * 4;
      if (p.x === -side && (ox < 14 || ox > 306)) p.x = 0;
      p.y = Math.abs(ez) > 2 ? Math.sign(ez) : 0;
      p.run = run && !!p.x;
      if (p.y && this.unsafe(h.x, h.z + p.y * 6)) p.y = 0;
      if (p.x && this.unsafe(h.x + p.x * 12, h.z)) p.x = 0;
    };
    const face = () => {
      if (h.facing !== side) p.x = side;
    };
    // they're down (or blinking back up): stand off and wait, lined up for when they rise
    if (t === f && !f.vulnerable && this.plan !== 'thief') {
      towards(f.x - side * 56, f.z);
      if (!p.x && !p.y) face();
      this.doing = 'wait';
      return;
    }
    this.doing = this.plan;
    const strike = (reach: number) => {
      if (lined && adx < reach && adx > 4 && (this.safe || t !== f)) {
        if (h.facing !== side) face();
        else p.attack = this.t % 4 < 2;
        return true;
      }
      return false;
    };
    switch (this.plan) {
      case 'thief':
        towards(t.x - side * 16, t.z);
        strike(30);
        break;
      case 'evade':
        towards(h.x - side * 10, h.z + this.evadeZ, false, 3);
        if (!this.evadeZ) p.y = 0;
        if (Math.abs(dz) > 14) this.evadeZ = 0;
        break;
      case 'space': {
        // hold just out of reach, lined up; hit them if they walk in
        if (strike(40)) break;
        const want = f.armor ? 84 : 62;
        towards(f.x - side * want, f.z);
        if (!p.x && !p.y) face();
        break;
      }
      case 'punish':
        // line up and finish with a knock-down: the combo, or a jump attack from a little way off
        if (strike(42)) break;
        if (lined && adx > 44 && adx < 72 && h.facing === side) {
          p.jump = !this.prev.jump;
          this.jumpDir = side;
          break;
        }
        towards(f.x - side * 28, f.z);
        break;
      case 'press':
        if (strike(42)) break;
        towards(f.x - side * 28, f.z);
        break;
      case 'grab':
        // walk right in: attack at close range grabs
        if (lined && adx < 20 && h.facing === side && this.safe) {
          p.attack = this.t % 4 < 2;
          break;
        }
        towards(f.x - side * 14, f.z);
        break;
      case 'jump':
        if (lined && adx > 44 && adx < 72 && h.facing === side) {
          p.jump = !this.prev.jump;
          this.jumpDir = side;
          this.planUntil = this.t + 40;
          this.plan = 'press';
          break;
        }
        towards(f.x - side * 58, f.z);
        if (!p.x && !p.y) face();
        break;
      case 'dash':
        if (h.state === 'run' && lined && adx < 46) {
          p.attack = true;
          this.plan = 'space';
          break;
        }
        if (adx < 90 && h.state !== 'run') {
          // back off for a run-up
          towards(f.x - side * 110, f.z);
          if (this.sx(h.x) < 24 || this.sx(h.x) > 296) this.plan = 'press';
          break;
        }
        if (!lined) {
          towards(h.x, f.z);
          break;
        }
        // run at them (the run button; a person can double-tap instead)
        p.x = side;
        p.run = true;
        break;
    }
  }
}
