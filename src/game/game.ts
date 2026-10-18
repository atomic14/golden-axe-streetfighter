// Game flow: title, character select, the five areas, game over.
import { input } from '../input';
import { assets } from '../assets';
import { audio } from '../audio';
import { ctx, drawSprite, drawSpriteTinted, drawText, fillRect, W, H } from '../gfx';
import { Stage, END } from './stage';
import { Hero, HEROES } from './hero';
import { Brain } from './partner';
import { drawHud } from './hud';
import { Thief, Campfire, CampPotion } from './props';

export const AREAS = 5;

/** settings kept between visits (storage can be unavailable: private windows, blocked sites) */
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not remembered, then
  }
}
/** hero indices from left to right on the select screen */
const SELECT_ORDER = [2, 0, 1];

type State = 'title' | 'select' | 'loading' | 'play' | 'clear' | 'camp' | 'map' | 'continue' | 'gameover' | 'ending';

export class Game {
  state: State = 'title';
  t = 0;
  choice = 0;
  stage: Stage | null = null;
  heroes: Hero[] = [];
  area = 0;
  paused = false;
  /** a computer-controlled second player (chosen on the select screen, remembered) */
  partner = load('ga.partner') === 'on' || new URLSearchParams(location.search).has('cpu');

  update() {
    this.t++;
    const pr = input.pressed;
    switch (this.state) {
      case 'title':
        if (pr.start || pr.attack || pr.any) this.go('select');
        break;
      case 'select': {
        if (this.t === 1) audio.music('select');
        if (this.t > 10) {
          // left to right on screen: Gilius, Ax, Tyris
          if (input.pad.x && this.selMove === 0) {
            const slot = SELECT_ORDER.indexOf(this.choice);
            this.choice = SELECT_ORDER[Math.max(0, Math.min(2, slot + input.pad.x))];
          }
          this.selMove = input.pad.x;
          // up / down (or a tap on the line at the top) switches the computer partner
          if (input.pad.y && this.selMoveY === 0) this.togglePartner();
          this.selMoveY = input.pad.y;
          // touch: tap a hero to pick them, tap them again to start
          const tap = input.tapAt;
          if (tap && tap.y < 30) this.togglePartner();
          else if (tap && tap.y > 30 && tap.y < 200) {
            const i = SELECT_ORDER[Math.max(0, Math.min(2, Math.floor(tap.x / (W / 3))))];
            if (i === this.choice) this.startGame();
            else this.choice = i;
          } else if (pr.attack || pr.start || pr.jump) this.startGame();
        }
        break;
      }
      case 'play': {
        if (pr.pause) this.paused = !this.paused;
        if (this.paused) return;
        const s = this.stage!;
        if (this.opening > 0) this.opening--;
        s.update();
        if (s.progress >= 0x1431 && !this.bossMusic) {
          this.bossMusic = true;
          audio.music('boss');
        }
        // a computer partner that runs out of lives rejoins after a while
        for (const h of this.heroes) {
          if (h.cpu && h.state === 'gameover' && ++h.respawnTimer > 300) {
            h.lives = 2;
            h.respawn();
          }
        }
        if (this.players.every((h) => h.state === 'gameover')) this.go('continue');
        else if (s.progress >= END && !s.enemiesAlive && s.spawnIndex >= s.data.spawns.length && this.t > 60) this.go('clear');
        break;
      }
      case 'clear':
        this.stage!.update();
        if (this.t > 150) {
          if (this.area + 1 < AREAS) this.startCamp();
          else this.startEnding();
        }
        break;
      case 'camp': {
        const s = this.stage!;
        if (pr.pause) this.paused = !this.paused;
        if (this.paused) return;
        s.update();
        // the thieves creep in after a while; the heroes wake when they arrive
        if (this.t === 150) {
          // the heroes' potions lie beside them (two at most), for the thief to steal
          this.heroes.forEach((h, i) => {
            if (h.state !== 'sleep' || h.potions <= 0) return;
            const offsets = i === 0 ? (h.potions >= 2 ? [-28, -16] : [-22]) : (h.potions >= 2 ? [-26, -14] : [-20]);
            for (const dx of offsets) s.actors.push(new CampPotion(s, h, dx));
          });
          for (const [, x, z, param, init] of s.data.camp ?? []) {
            if (init === 0x17c7c || init === 0x17d00 || init === 0x17d24) {
              const t = new Thief(s, x, z, param || 0x2300, init === 0x17d00);
              t.camp = true;
              s.actors.push(t);
            }
          }
        }
        if (this.t === 170) for (const h of this.heroes) if (h.state === 'sleep') h.setState('getup', h.anims.getup);
        const thieves = s.actors.some((a) => a instanceof Thief);
        // jars left untouched go back to their owners
        if (this.t > 400 && !thieves) for (const a of s.actors) if (a instanceof CampPotion) a.gone = true;
        if (this.t > 400 && !thieves) this.startMap();
        break;
      }
      case 'map': {
        // the view closes into a box, then the original's map scene: the parchment zooms in and a
        // quill draws the route while the story types out (rendered from a recording)
        const v = this.mapVideo;
        if (this.t === 30) {
          audio.music('map');
          void v.play().catch(() => {});
        }
        // timed in game ticks so it ends the same however the video plays (or if it can't)
        const len = Number.isFinite(v.duration) && !v.error ? v.duration * 60 : 230;
        if (this.t >= 30 && (v.ended || this.t >= 30 + len + 10)) {
          v.pause();
          void this.loadArea(this.area + 1);
        }
        break;
      }
      case 'ending':
        if (this.t > 60 && (pr.start || pr.attack || pr.any)) this.endEnding();
        break;
      case 'continue':
        // like feeding the arcade another coin: carry on where you fell
        this.stage!.update();
        if (this.t > 30 && (pr.start || pr.attack || pr.jump)) {
          for (const h of this.heroes) {
            if (h.state !== 'gameover') continue;
            h.lives = 2;
            h.respawn();
          }
          this.go('play');
        } else if (this.t >= 600) {
          this.go('gameover');
          audio.music('gameover');
        }
        break;
      case 'gameover':
        if (this.t > 120 && (pr.start || pr.attack)) this.go('title');
        break;
    }
  }

  private selMove = 0;
  private toastText = '';
  private toastTimer = 0;

  /** a short message across the top of the screen */
  toast(text: string) {
    this.toastText = text;
    this.toastTimer = 90;
  }
  private selMoveY = 0;

  /** the heroes people play (all of them when the computer plays alone, in tests) */
  get players() {
    const people = this.heroes.filter((h) => !h.cpu);
    return people.length ? people : this.heroes;
  }

  togglePartner() {
    this.partner = !this.partner;
    save('ga.partner', this.partner ? 'on' : 'off');
  }

  /** the partner takes the next hero along from the player's */
  get partnerChoice() {
    return SELECT_ORDER[(SELECT_ORDER.indexOf(this.choice) + 1) % 3];
  }

  private makeHeroes(s: Stage): Hero[] {
    const p1 = new Hero(s, this.choice);
    // ?auto: the computer plays player 1 too (for tests)
    if (new URLSearchParams(location.search).has('auto')) p1.brain = new Brain(p1, null);
    if (!this.partner) return [p1];
    const p2 = new Hero(s, this.partnerChoice);
    p2.brain = new Brain(p2, p1);
    return [p1, p2];
  }
  /** an area opens out of a box, as the original does after the map */
  private opening = 0;
  private bossMusic = false;

  go(s: State) {
    this.state = s;
    this.t = 0;
  }

  /** Night falls: the bonus camp at the end of an area. */
  startCamp() {
    const s = this.stage!;
    this.go('camp');
    audio.music('camp');
    s.camp = true;
    s.shown++; // the HUD counts the camp as a stage of its own
    s.buildLayers();
    s.actors = s.actors.filter((a) => a.isHero);
    // the camp script places the sleepers (0x2b0ae, 0x2b0b4)
    const spots = (s.data.camp ?? []).filter((c) => c[4] === 0x2b0ae || c[4] === 0x2b0b4);
    const [cx, cz] = spots.length ? [spots[0][1], spots[0][2]] : [0x1000 - s.camx + 130, 0x1080];
    this.heroes.forEach((h, i) => {
      if (h.mount) {
        h.mount.setRider(null);
        h.mount = null;
      }
      h.x = spots[i]?.[1] ?? cx;
      h.z = s.floorZ(h.x, spots[i]?.[2] ?? cz);
      h.y = h.ground;
      h.facing = 1;
      h.setState('sleep', h.anims.lie);
    });
    s.actors.push(new Campfire(s, cx + 24, s.floorZ(cx + 24, cz + 2)));
  }

  private mapVideo = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto' });

  startMap() {
    this.go('map');
    // start loading while the view closes
    this.mapVideo.src = `${import.meta.env.BASE_URL}assets/map${this.area + 1}.mp4`;
    this.mapVideo.load();
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
    this.go('title');
  }

  startGame() {
    this.heroes = [];
    this.area = Number(new URLSearchParams(location.search).get('area') ?? 0);
    void this.loadArea(this.area, true);
  }

  async loadArea(n: number, fresh = false) {
    this.go('loading');
    const s = new Stage(n);
    await s.load();
    this.area = n;
    if (fresh || !this.heroes.length) this.heroes = this.makeHeroes(s);
    this.heroes.forEach((h, i) => {
      h.stage = s;
      h.x = 0x1000 - s.camx + 60 - i * 24;
      h.z = 0x1080;
      // find solid ground near the left of the screen
      for (let z = 0x1040 + i * 24; z < 0x1100; z += 4) {
        const g = s.groundAt(h.x, z);
        if (g > 0xf00 && g < 0x1480) { h.z = z; break; }
      }
      h.y = h.ground;
      h.facing = 1;
      h.setState('stand', h.anims.idle);
    });
    s.heroes = this.heroes;
    s.actors.push(...this.heroes);
    this.stage = s;
    this.bossMusic = false;
    this.go('play');
    this.opening = 30;
    audio.music(`area${n}`);
  }

  draw() {
    fillRect(0, 0, W, H, '#000');
    switch (this.state) {
      case 'title': {
        if (assets.title) ctx.drawImage(assets.title, 0, 0);
        if ((this.t >> 5) & 1) drawText(input.touch ? 'TAP TO START' : 'PRESS START', W / 2, 116, '#36f', 'center');
        break;
      }
      case 'select': {
        // the original's skull, with the heroes standing on its hands
        if (assets.select) ctx.drawImage(assets.select, 0, 0);
        SELECT_ORDER.forEach((i, slot) => {
          const h = HEROES[i], x = 62 + slot * 98, on = i === this.choice;
          drawSprite(0x1c2 + i, h.pal, x, 176 - (on ? 4 : 0), false);
          if (!on) drawSpriteTinted(0x1c2 + i, x, 176, false, '#000', 0.5);
          drawText(h.name.split(' ')[0], x, 180, on ? '#ff0' : '#aaa', 'center');
        });
        // how to play, for whatever the player is holding
        const pad = (navigator.getGamepads?.() ?? []).some((g) => g);
        const help = input.touch
          ? ['TAP A HERO TWICE TO START', 'FLICK THE STICK TWICE TO RUN']
          : pad
            ? ['X ATTACK  A JUMP  Y MAGIC  B BACK ATTACK', 'HOLD RB TO RUN (OR TAP TWICE)']
            : ['ARROWS/WASD  J ATTACK  K JUMP  L MAGIC', 'TAP TWICE TO RUN  J+K: BACK ATTACK'];
        help.forEach((l, i) => drawText(l, W / 2, 202 + i * 10, '#8af', 'center'));
        const how = input.touch ? 'TAP HERE' : 'UP OR DOWN';
        drawText(this.partner ? `CPU PARTNER: ${HEROES[this.partnerChoice].name.split(' ')[0]}` : 'CPU PARTNER: OFF', W / 2, 6,
          this.partner ? '#ff0' : '#888', 'center');
        drawText(`${how} TO CHANGE`, W / 2, 16, '#8af', 'center');
        break;
      }
      case 'loading':
        drawText('LOADING', W / 2, H / 2, '#888', 'center');
        break;
      case 'map': {
        if (this.t < 30) {
          // close the stage into a shrinking box
          this.stage!.draw();
          const k = 1 - this.t / 30, bw = W * k, bh = H * k;
          fillRect(0, 0, W, (H - bh) / 2, '#000');
          fillRect(0, (H + bh) / 2, W, (H - bh) / 2 + 1, '#000');
          fillRect(0, 0, (W - bw) / 2, H, '#000');
          fillRect((W + bw) / 2, 0, (W - bw) / 2 + 1, H, '#000');
        } else if (this.mapVideo.readyState >= 2) {
          ctx.drawImage(this.mapVideo, 0, 0, W, H);
        }
        break;
      }
      case 'camp':
        this.stage!.draw();
        drawHud(this.stage!, this.heroes);
        if (this.t < 240) {
          drawText('BONUS STAGE', W / 2, 40, '#f80', 'center');
          drawText('INCREASE YOUR POWERS', W / 2, 54, '#fff', 'center');
        }
        if (this.paused) drawText('PAUSED', W / 2, 100, '#fff', 'center');
        break;
      case 'play':
      case 'clear':
        this.stage!.draw();
        drawHud(this.stage!, this.heroes);
        if (this.state === 'clear') drawText('STAGE CLEAR', W / 2, 90, '#ff0', 'center');
        if (this.opening > 0) {
          const k = 1 - this.opening / 30, bw = W * k, bh = H * k;
          fillRect(0, 0, W, (H - bh) / 2, '#000');
          fillRect(0, (H + bh) / 2, W, (H - bh) / 2 + 1, '#000');
          fillRect(0, 0, (W - bw) / 2, H, '#000');
          fillRect((W + bw) / 2, 0, (W - bw) / 2 + 1, H, '#000');
        }
        if (this.paused) drawText('PAUSED', W / 2, 100, '#fff', 'center');
        break;
      case 'continue': {
        this.stage!.draw();
        drawHud(this.stage!, this.heroes);
        fillRect(0, 70, W, 70, 'rgba(0,0,0,0.6)');
        drawText('CONTINUE?', W / 2, 84, '#ff0', 'center');
        drawText(String(9 - Math.floor(this.t / 60)), W / 2, 100, '#fff', 'center');
        if ((this.t >> 4) & 1) drawText(input.touch ? 'TAP TO CONTINUE' : 'PRESS ATTACK TO CONTINUE', W / 2, 118, '#8af', 'center');
        break;
      }
      case 'gameover':
        drawText('GAME OVER', W / 2, H / 2, '#f22', 'center');
        break;
    }
    if (this.toastTimer > 0) {
      this.toastTimer--;
      fillRect(0, 26, W, 13, 'rgba(0,0,0,0.6)');
      drawText(this.toastText, W / 2, 29, '#ff0', 'center');
    }
    void ctx;
  }
}
