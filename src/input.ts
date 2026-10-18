// Arcade controls (8-way stick + Attack / Jump / Magic) from keyboard, gamepad and touch.
//
// Touch layout: a floating stick for the left thumb and three buttons for the right thumb.
//  - The stick appears where the thumb lands and follows it if it drifts too far. Running is the
//    arcade's double-tap: flick the stick twice (or lift and touch again) in the same direction.
//  - Every touch on the right half goes to the nearest button, so near misses still count.
//    Sliding between buttons presses the new one (jump, then slide onto attack = jump attack).
//    A thumb on the seam between Attack and Jump presses both (the back attack).
//  - Magic spends every potion, so it only fires from a fresh touch, never by sliding onto it.

export interface Pad {
  x: number; // -1, 0, 1
  y: number;
  attack: boolean;
  jump: boolean;
  magic: boolean;
  /** hold-to-run modifier (Shift, a gamepad shoulder) */
  run: boolean;
}

const emptyPad = (): Pad => ({ x: 0, y: 0, attack: false, jump: false, magic: false, run: false });

class Input {
  pad: Pad = emptyPad();
  /** edges for this tick */
  pressed = { attack: false, jump: false, magic: false, start: false, pause: false, select: false, any: false };
  touch = false;
  /** set by the game so the stick can show when the hero is running */
  running = false;
  /** where the last tap landed, in screen pixels (320x224), for menus */
  tapAt: { x: number; y: number } | null = null;
  private pendingTapAt: { x: number; y: number } | null = null;

  private keys = new Set<string>();
  private prev = emptyPad();
  private latch = { start: false, pause: false, select: false, any: false };
  private padPrev = { start: false, select: false };
  private touchPad = emptyPad();
  private touchTap = false;

  init() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.latch.any = true;
      if (e.code === 'Enter') this.latch.start = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.latch.pause = true;
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.initTouch();
    if (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')) this.enableTouch();
    document.getElementById('btn-pause')!.addEventListener('touchstart', (e) => {
      this.latch.pause = true;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });
    document.getElementById('btn-pause')!.addEventListener('click', () => (this.latch.pause = true));
  }

  private enableTouch() {
    if (this.touch) return;
    this.touch = true;
    document.body.classList.add('touch');
    // phones: fullscreen on the first tap where allowed (Android); iPhone uses Add to Home Screen
    const go = () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    };
    addEventListener('touchend', go, { passive: true });
    this.layoutTouch();
    requestAnimationFrame(() => this.layoutTouch());
  }

  /** Call once per game tick. */
  poll() {
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const p = emptyPad();
    p.x = (k('ArrowRight', 'KeyD') ? 1 : 0) - (k('ArrowLeft', 'KeyA') ? 1 : 0);
    p.y = (k('ArrowDown', 'KeyS') ? 1 : 0) - (k('ArrowUp', 'KeyW') ? 1 : 0);
    p.attack = k('KeyJ', 'KeyZ');
    p.jump = k('KeyK', 'KeyX', 'Space');
    p.magic = k('KeyL', 'KeyC');
    p.run = k('ShiftLeft', 'ShiftRight');

    let start = false, select = false;
    for (const g of navigator.getGamepads?.() ?? []) {
      if (!g) continue;
      const b = (i: number) => !!g.buttons[i]?.pressed;
      const ax = g.axes[0] ?? 0, ay = g.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.4) {
        const a = Math.atan2(ay, ax), s = Math.round(a / (Math.PI / 4));
        p.x ||= Math.round(Math.cos(s * Math.PI / 4));
        p.y ||= Math.round(Math.sin(s * Math.PI / 4));
      }
      if (b(14)) p.x = -1;
      if (b(15)) p.x = 1;
      if (b(12)) p.y = -1;
      if (b(13)) p.y = 1;
      // X attacks, A jumps, Y casts magic, B is attack + jump (back attack), shoulders run
      if (b(2) || b(1)) p.attack = true;
      if (b(0) || b(1)) p.jump = true;
      if (b(3)) p.magic = true;
      if (b(4) || b(5) || b(6) || b(7)) p.run = true;
      if (b(9)) start = true;
      if (b(8)) select = true;
      if (g.buttons.some((x) => x.pressed)) this.latch.any ||= !this.padPrev.start && !this.padPrev.select && (b(0) || b(2) || b(9));
    }
    if (start && !this.padPrev.start) this.latch.start = true;
    if (select && !this.padPrev.select) this.latch.select = true;
    this.padPrev = { start, select };

    const t = this.touchPad;
    p.x ||= t.x;
    p.y ||= t.y;
    p.attack ||= t.attack;
    p.jump ||= t.jump;
    p.magic ||= t.magic;

    this.pressed = {
      attack: p.attack && !this.prev.attack,
      jump: p.jump && !this.prev.jump,
      magic: p.magic && !this.prev.magic,
      start: this.latch.start || this.touchTap,
      pause: this.latch.pause,
      select: this.latch.select,
      any: this.latch.any || this.touchTap,
    };
    this.prev = p;
    this.pad = p;
    this.latch = { start: false, pause: false, select: false, any: false };
    this.touchTap = false;
    this.tapAt = this.pendingTapAt;
    this.pendingTapAt = null;
    document.getElementById('stick')?.classList.toggle('run', this.running);
  }

  // ---- touch ----------------------------------------------------------------------------------

  private stickEl!: HTMLElement;
  private knobEl!: HTMLElement;
  private btns!: Record<'attack' | 'jump' | 'magic', { el: HTMLElement; x: number; y: number; r: number }>;

  /** Place the stick's resting spot and the buttons for the current orientation. */
  layoutTouch() {
    if (!this.touch) return;
    // keep clear of notches and the home indicator
    const css = getComputedStyle(document.documentElement);
    const inset = (n: string) => parseFloat(css.getPropertyValue(n)) || 0;
    const left = inset('--sal'), right = inset('--sar'), bottom = inset('--sab');
    const vw = innerWidth - right, vh = innerHeight - bottom;
    const screen = document.getElementById('screen')!.getBoundingClientRect();
    const portrait = vh > vw;
    // attack button diameter: bigger in portrait, where there is room under the screen
    const size = Math.min(Math.max(Math.min(vw, vh) * (portrait ? 0.21 : 0.17), 56), 92);
    let cx: number, cy: number, sx: number, sy: number;
    if (portrait) {
      // controls in the space under the screen
      // controls in the space under the screen, low enough for resting thumbs
      const top = screen.bottom, mid = top + (vh - top) * 0.62;
      cx = vw - size * 1.75;
      cy = Math.min(mid, vh - size * 1.2);
      sx = vw * 0.25;
      sy = cy - size * 0.15;
    } else {
      // landscape: in the margins beside the screen when there is room, else over its edges
      const margin = (vw - screen.width) / 2;
      cx = margin > size * 2.2 ? vw - margin / 2 + size * 0.15 : vw - size * 1.45;
      cy = vh - size * 1.15;
      sx = Math.max(left + size * 0.9, margin > size * 2.2 ? margin / 2 : size * 1.4);
      sy = vh - size * 1.4;
    }
    const D = size * 1.05;
    // keep the jump button on screen on narrow layouts
    const over = cx + D * 0.95 + size * 0.45 - (vw - 4);
    if (over > 0) cx -= over;
    const place = (el: HTMLElement, x: number, y: number, d: number) => {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = el.style.height = `${d}px`;
      return { el, x, y, r: d / 2 };
    };
    this.btns = {
      attack: place(document.getElementById('btn-attack')!, cx, cy, size),
      jump: place(document.getElementById('btn-jump')!, cx + D * 0.95, cy - D * 0.6, size * 0.9),
      magic: place(document.getElementById('btn-magic')!, cx - D * 0.35, cy - D * 1.35, size * 0.7),
    };
    this.stickHome = { x: sx, y: sy };
    if (!this.stickTouch) this.moveStick(sx, sy);
  }

  private stickHome = { x: 0, y: 0 };
  private stickTouch: { id: number; ox: number; oy: number; sector: number; t: number; moved: boolean } | null = null;
  private btnTouches = new Map<number, { buttons: Set<'attack' | 'jump' | 'magic'>; t: number }>();

  private moveStick(x: number, y: number) {
    this.stickEl.style.left = `${x}px`;
    this.stickEl.style.top = `${y}px`;
  }

  private initTouch() {
    this.stickEl = document.getElementById('stick')!;
    this.knobEl = this.stickEl.firstElementChild as HTMLElement;
    addEventListener('resize', () => requestAnimationFrame(() => this.layoutTouch()));
    const R = 46;

    const updateStick = (s: NonNullable<Input['stickTouch']>, x: number, y: number) => {
      let dx = x - s.ox, dy = y - s.oy;
      let d = Math.hypot(dx, dy);
      // drag the origin along when the thumb wanders past the rim
      if (d > R * 1.35) {
        const k = (d - R * 1.35) / d;
        s.ox += dx * k;
        s.oy += dy * k;
        this.moveStick(s.ox, s.oy);
        dx = x - s.ox; dy = y - s.oy; d = Math.hypot(dx, dy);
      }
      const kk = d > R ? R / d : 1;
      this.knobEl.style.transform = `translate(${dx * kk}px, ${dy * kk}px)`;
      if (d > 10) s.moved = true;
      // 8 sectors with hysteresis: keep the current sector until the thumb is clearly in another
      const dead = s.sector < 0 ? R * 0.32 : R * 0.22;
      if (d < dead) s.sector = -1;
      else {
        const a = Math.atan2(dy, dx);
        const sec = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
        if (s.sector < 0 || sec !== s.sector) {
          const centre = s.sector * (Math.PI / 4);
          let diff = Math.abs(a - centre) % (2 * Math.PI);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (s.sector < 0 || diff > Math.PI / 8 + 0.14) s.sector = sec;
        }
      }
      if (s.sector < 0) { this.touchPad.x = 0; this.touchPad.y = 0; }
      else {
        this.touchPad.x = Math.round(Math.cos(s.sector * Math.PI / 4));
        this.touchPad.y = Math.round(Math.sin(s.sector * Math.PI / 4));
      }
    };

    const buttonsAt = (x: number, y: number, fresh: boolean, prev?: Set<'attack' | 'jump' | 'magic'>) => {
      const b = this.btns;
      const dist = (n: 'attack' | 'jump' | 'magic') => Math.hypot(x - b[n].x, y - b[n].y) / b[n].r;
      const out = new Set<'attack' | 'jump' | 'magic'>();
      const dA = dist('attack'), dJ = dist('jump'), dM = dist('magic');
      // magic only from a fresh touch close to it (or a thumb that started on it)
      if (dM < 1.25 && dM < dA && dM < dJ && (fresh || prev?.has('magic'))) {
        out.add('magic');
        return out;
      }
      const rawA = Math.hypot(x - b.attack.x, y - b.attack.y), rawJ = Math.hypot(x - b.jump.x, y - b.jump.y);
      if (Math.abs(rawA - rawJ) < b.attack.r * 0.32 && Math.max(dA, dJ) < 1.9) {
        out.add('attack');
        out.add('jump');
      } else if (Math.min(dA, dJ) < 3.2) out.add(dA <= dJ ? 'attack' : 'jump');
      else if (prev && !prev.has('magic')) for (const p of prev) out.add(p);
      return out;
    };

    const syncButtons = () => {
      const held = new Set<string>();
      for (const t of this.btnTouches.values()) for (const b of t.buttons) held.add(b);
      for (const n of ['attack', 'jump', 'magic'] as const) {
        const on = held.has(n);
        if (on && !this.touchPad[n]) navigator.vibrate?.(n === 'magic' ? 25 : 8);
        this.touchPad[n] = on;
        this.btns[n].el.classList.toggle('down', on);
      }
    };

    const onStart = (e: TouchEvent) => {
      this.enableTouch();
      for (const t of Array.from(e.changedTouches)) {
        const left = t.clientX < innerWidth / 2;
        if (left && !this.stickTouch) {
          this.stickTouch = { id: t.identifier, ox: t.clientX, oy: t.clientY, sector: -1, t: performance.now(), moved: false };
          this.moveStick(t.clientX, t.clientY);
          this.stickEl.classList.add('active');
          updateStick(this.stickTouch, t.clientX, t.clientY);
        } else if (!left) {
          this.btnTouches.set(t.identifier, { buttons: buttonsAt(t.clientX, t.clientY, true), t: performance.now() });
        }
      }
      syncButtons();
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (this.stickTouch?.id === t.identifier) updateStick(this.stickTouch, t.clientX, t.clientY);
        const bt = this.btnTouches.get(t.identifier);
        if (bt) bt.buttons = buttonsAt(t.clientX, t.clientY, false, bt.buttons);
      }
      syncButtons();
      e.preventDefault();
    };
    const toScreen = (x: number, y: number) => {
      const r = document.getElementById('screen')!.getBoundingClientRect();
      return { x: ((x - r.left) / r.width) * 320, y: ((y - r.top) / r.height) * 224 };
    };
    const onEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const at = toScreen(t.clientX, t.clientY);
        if (at.x >= 0 && at.x < 320 && at.y >= 0 && at.y < 224) this.pendingTapAt = at;
        if (this.stickTouch?.id === t.identifier) {
          if (!this.stickTouch.moved && performance.now() - this.stickTouch.t < 300) this.touchTap = true;
          this.stickTouch = null;
          this.touchPad.x = this.touchPad.y = 0;
          this.knobEl.style.transform = '';
          this.stickEl.classList.remove('active');
          this.moveStick(this.stickHome.x, this.stickHome.y);
        }
        const bt = this.btnTouches.get(t.identifier);
        if (bt) {
          if (performance.now() - bt.t < 300) this.touchTap = true;
          this.btnTouches.delete(t.identifier);
        }
      }
      syncButtons();
      e.preventDefault();
    };
    const opts = { passive: false } as AddEventListenerOptions;
    const surface = document.getElementById('app')!;
    surface.addEventListener('touchstart', onStart, opts);
    surface.addEventListener('touchmove', onMove, opts);
    surface.addEventListener('touchend', onEnd, opts);
    surface.addEventListener('touchcancel', onEnd, opts);
  }
}

export const input = new Input();
