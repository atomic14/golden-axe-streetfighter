// Canvas renderer working in the original 320x224 screen space. Sprites are recoloured from
// the indexed atlas on demand (one small canvas per frame and palette), like the hardware's
// per-object palettes; tile layers are rendered once per area/palette into big canvases.
import { assets, decode32, type HdLayer, type LayerData } from './assets';

export const W = 320;
export const H = 224;

export let ctx: CanvasRenderingContext2D;
/** device pixels per game pixel: 1, or the HD sprites' scale when HD art is on */
export let scale = 1;

export function initGfx(canvas: HTMLCanvasElement) {
  ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingEnabled = false;
}

/**
 * Draw at `s` device pixels per game pixel: the canvas grows and everything keeps drawing in
 * 320x224 game coordinates through the transform; sprites then come from the HD atlas.
 */
export function setScale(s: number) {
  scale = s;
  const c = ctx.canvas;
  c.width = W * s;
  c.height = H * s;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // a big canvas shown smaller is smoothed; the 320x224 one is shown pixelated
  c.style.imageRendering = s > 1 ? 'auto' : '';
  frameCache.clear();
}

// ---- palettes -------------------------------------------------------------------------------

const spritePalCache = new Map<number, Uint32Array>();
/** Sprite palette `id` as ABGR words (pen 0 and 15 transparent). */
export function spritePalette(id: number): Uint32Array {
  let p = spritePalCache.get(id);
  if (!p) {
    const hex = assets.sprites.palettes[id];
    p = new Uint32Array(16);
    for (let i = 1; i < 15; i++) {
      const v = parseInt(hex.slice(i * 6, i * 6 + 6), 16);
      p[i] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | (v >> 16);
    }
    spritePalCache.set(id, p);
  }
  return p;
}

// ---- sprites --------------------------------------------------------------------------------

/** a frame recoloured: its canvas, size in game pixels and offset from the anchor */
interface FrameImage { c: HTMLCanvasElement; w: number; h: number; ox: number; oy: number }
const frameCache = new Map<number, FrameImage | null>();

function frameImage(frame: number, pal: number): FrameImage | null {
  const key = frame * 256 + pal;
  let f = frameCache.get(key);
  if (f !== undefined) return f;
  // HD art where there is some (drawn at its scale), else the original
  const hd = scale > 1 ? assets.hd?.frames[frame] : undefined;
  const m = hd ?? assets.sprites.frames[frame];
  if (!m || (!hd && m[3] <= 1)) {
    frameCache.set(key, null);
    return null;
  }
  const [page, sx, sy, w, h, ox, oy] = m;
  const pens = hd ? assets.hd!.pens[page] : assets.spritePens[page], pw = hd ? assets.hd!.size : assets.spriteW;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  const out = new Uint32Array(img.data.buffer);
  const p = spritePalette(pal);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = p[pens[(sy + y) * pw + sx + x]];
  g.putImageData(img, 0, 0);
  const k = hd ? assets.hd!.scale : 1;
  f = { c, w: w / k, h: h / k, ox, oy };
  // HD frames are big: keep the cache bounded
  if (frameCache.size > (scale > 1 ? 400 : 4000)) frameCache.clear();
  frameCache.set(key, f);
  return f;
}

function blit(c: HTMLCanvasElement, f: FrameImage, x: number, y: number, flip: boolean) {
  const left = Math.round(flip ? x - f.ox - f.w : x + f.ox), top = Math.round(y + f.oy);
  if (flip) {
    ctx.save();
    ctx.translate(left + f.w, top);
    ctx.scale(-1, 1);
    ctx.drawImage(c, 0, 0, f.w, f.h);
    ctx.restore();
  } else ctx.drawImage(c, left, top, f.w, f.h);
}

/** Draw `frame` with its anchor (horizontal centre, feet) at screen (x, y). */
export function drawSprite(frame: number, pal: number, x: number, y: number, flip: boolean, alpha = 1) {
  const f = frameImage(frame, pal);
  if (!f) return;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  blit(f.c, f, x, y, flip);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

/** Silhouette of a frame in a solid colour (hit flashes, shadows). */
export function drawSpriteTinted(frame: number, x: number, y: number, flip: boolean, color: string, alpha = 1) {
  const f = frameImage(frame, 0x13);
  if (!f) return;
  ctx.globalAlpha = alpha;
  blit(tintCanvas(f.c, color), f, x, y, flip);
  ctx.globalAlpha = 1;
}

const tints = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
function tintCanvas(src: HTMLCanvasElement, color: string) {
  let m = tints.get(src);
  if (!m) tints.set(src, (m = new Map()));
  let t = m.get(color);
  if (!t) {
    t = document.createElement('canvas');
    t.width = src.width;
    t.height = src.height;
    const g = t.getContext('2d')!;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, t.width, t.height);
    m.set(color, t);
  }
  return t;
}

// ---- tile layers ----------------------------------------------------------------------------

export interface TileLayer {
  /** layer-space position of the canvases' top-left */
  x: number;
  y: number;
  low: HTMLCanvasElement;
  /** tiles with the priority bit, drawn over sprites */
  high: HTMLCanvasElement | null;
  /** canvas pixels per game pixel (HD layers are bigger) */
  scale: number;
}

/** Tile palette: 1024 colours (128 groups of 8) as ABGR words. */
export function tilePalette(b64: string): Uint32Array {
  const rgb = decode32(b64);
  const out = new Uint32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const v = rgb[i];
    out[i] = 0xff000000 | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
  }
  return out;
}

/**
 * Render a tile layer with a palette. With `hd` (an AI-upscaled layer, pens per pixel) each 8x8
 * cell becomes a bigger block of its pens, coloured with the cell's group as before.
 */
export function renderLayer(data: LayerData, pal: Uint32Array, opaque: boolean, hd?: HdLayer): TileLayer {
  const cells = decode32(data.cells);
  const S = hd ? hd.w / (data.w * 8) : 1, T = 8 * S;
  const w = data.w * T, h = data.h * T;
  const low = new Uint32Array(w * h), high = new Uint32Array(w * h);
  let anyHigh = false;
  const pens = hd ? hd.pens : assets.tilePens, tw = hd ? hd.w : assets.tileCols * 8;
  for (let ty = 0; ty < data.h; ty++) {
    for (let tx = 0; tx < data.w; tx++) {
      const c = cells[ty * data.w + tx];
      if (c === 0xffffffff) continue;
      const tile = c & 0xffff, group = ((c >> 16) & 0x7f) * 8, pri = (c >> 23) & 1;
      const dst = pri ? high : low;
      if (pri) anyHigh = true;
      // where this cell's pens are: the tile in the atlas, or the cell's own block of the HD layer
      const ax = hd ? tx * T : (tile % assets.tileCols) * 8, ay = hd ? ty * T : Math.floor(tile / assets.tileCols) * 8;
      for (let y = 0; y < T; y++) {
        for (let x = 0; x < T; x++) {
          const p = pens[(ay + y) * tw + ax + x];
          if (!p && !opaque) continue;
          dst[(ty * T + y) * w + tx * T + x] = pal[group + p];
          // opaque layers keep their pixels in the low canvas even under priority tiles
          if (pri && opaque) low[(ty * T + y) * w + tx * T + x] = pal[group + p];
        }
      }
    }
  }
  const toCanvas = (px: Uint32Array) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    new Uint32Array(img.data.buffer).set(px);
    g.putImageData(img, 0, 0);
    return c;
  };
  return { x: data.x, y: data.y, low: toCanvas(low), high: anyHigh && !opaque ? toCanvas(high) : null, scale: S };
}

// ---- text (the text layer's 8x8 font, codes are ASCII) ----------------------------------------

const textCache = new Map<string, HTMLCanvasElement>();
/** Draw text with the hardware font in a solid colour at pixel (x, y). */
export function drawText(s: string, x: number, y: number, color = '#fff', align: 'left' | 'center' | 'right' = 'left') {
  const key = `${s}|${color}`;
  let c = textCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.max(1, s.length * 8);
    c.height = 8;
    const g = c.getContext('2d')!;
    const img = g.createImageData(c.width, 8);
    const out = new Uint32Array(img.data.buffer);
    const col = parseCss(color);
    const pens = assets.tilePens, tw = assets.tileCols * 8;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      const ax = (code % assets.tileCols) * 8, ay = Math.floor(code / assets.tileCols) * 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = pens[(ay + y) * tw + ax + x];
        // the font draws letters in pen 1 with a dark outline in pen 2
        if (p) out[y * c.width + i * 8 + x] = p === 2 ? darken(col) : col;
      }
    }
    g.putImageData(img, 0, 0);
    textCache.set(key, c);
    if (textCache.size > 500) textCache.clear();
  }
  const w = s.length * 8;
  ctx.drawImage(c, Math.round(align === 'left' ? x : align === 'center' ? x - w / 2 : x - w), Math.round(y));
}

function parseCss(c: string): number {
  const m = /^#(..)(..)(..)$/.exec(c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c);
  if (!m) return 0xffffffff;
  return 0xff000000 | (parseInt(m[3], 16) << 16) | (parseInt(m[2], 16) << 8) | parseInt(m[1], 16);
}
function darken(v: number) {
  return 0xff000000 | ((((v >> 16) & 0xff) * 0.25) << 16) | ((((v >> 8) & 0xff) * 0.25) << 8) | ((v & 0xff) * 0.25);
}

export function fillRect(x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
