// Loads the data extracted from the ROM (tools/extract.ts) out of public/assets.

/** [page, x, y, w, h, ox, oy]: atlas rectangle and the offset of its top-left from the anchor (centre, feet) */
export type FrameMeta = [number, number, number, number, number, number, number];
/** [frame, duration, flags, dx, dy, [x1, x2, y1, y2]] */
export type AnimStep = [number, number, number, number, number, [number, number, number, number]];

export interface SpriteData {
  pages: number;
  frames: FrameMeta[];
  /** 256 palettes of 16 colours, as 96-char hex strings */
  palettes: string[];
  anims: Record<string, AnimStep[]>;
  /** per mounted script: the rider's [frame, flip, dx, dy] for each step */
  riders: Record<string, [number, number, number, number][]>;
  /** per attacking script, from the header before it: [reaction, damage, active step, x1, x2, y1, y2] */
  attacks: Record<string, number[]>;
}

export interface LayerData { x: number; y: number; w: number; h: number; cells: string }

export interface AreaData {
  fg: LayerData;
  bg: LayerData;
  parallax: [[number, number], [number, number]];
  height: string;
  palettes: Record<string, string>;
  camPath: Record<string, [number, number]>;
  cam: [[number, number], [number, number]];
  stops: number[];
  /** [trigger, x, z, param, init] */
  spawns: [number, number, number, number, number][];
  /** the bonus camp's spawns */
  camp: [number, number, number, number, number][];
}

export const assets = {
  sprites: null as unknown as SpriteData,
  /** sprite atlas pixels: pen (0..15) per pixel, one array per page */
  spritePens: [] as Uint8Array[],
  spriteW: 2048,
  /** tile atlas pens (0..7), 128 tiles per row */
  tilePens: new Uint8Array(0) as Uint8Array,
  tileCols: 128,
  areas: new Map<number, AreaData>(),
  /** the original title screen, rendered from the attract mode (tools/record-title.sh) */
  title: null as HTMLImageElement | null,
  /** the select screen's skull (tools/select-bg.ts) */
  select: null as HTMLImageElement | null,
  /** recorded spells: hero -> level -> tick -> sprites [frame, pal, flip, dx, dz, dy] */
  magic: {} as Record<string, number[][][][]>,
  /** AI-upscaled sprites (tools/upscale), loaded the first time HD art is switched on */
  hd: null as HdSprites | null,
};

export interface HdSprites {
  scale: number;
  size: number;
  /** frame -> [page, x, y, w, h (HD pixels), ox, oy (offset from the anchor, game pixels)] */
  frames: Record<string, FrameMeta>;
  pens: Uint8Array[];
}

/** AI-upscaled background layers of an area (tools/upscale/layers.py): pens per pixel */
export interface HdLayer { pens: Uint8Array; w: number; h: number }
const hdAreas = new Map<number, Promise<{ fg: HdLayer; bg: HdLayer } | null>>();
/** Load an area's HD layers (once); null if there are none. */
export function loadHdArea(n: number): Promise<{ fg: HdLayer; bg: HdLayer } | null> {
  let p = hdAreas.get(n);
  if (!p) {
    const layer = async (name: string): Promise<HdLayer> => {
      const img = await loadImage(`${BASE}hd/area${n}-${name}.png`);
      return { pens: pens(img, 32), w: img.width, h: img.height };
    };
    p = Promise.all([layer('fg'), layer('bg')]).then(([fg, bg]) => {
      hdArea.set(n, { fg, bg });
      return { fg, bg };
    }).catch(() => null);
    hdAreas.set(n, p);
  }
  return p;
}
/** an area's HD layers if they have loaded */
export const hdArea = new Map<number, { fg: HdLayer; bg: HdLayer }>();

let hdLoading: Promise<HdSprites | null> | null = null;
/** Load the HD sprite atlas (once); null if it isn't there. */
export function loadHd(): Promise<HdSprites | null> {
  hdLoading ??= (async () => {
    const meta = await fetch(`${BASE}hd/sprites.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!meta) return null;
    const pages = await Promise.all(Array.from({ length: meta.pages }, (_, i) => loadImage(`${BASE}hd/sprites-${i}.png`)));
    assets.hd = { scale: meta.scale, size: meta.size, frames: meta.frames, pens: pages.map((p) => pens(p, 17)) };
    return assets.hd;
  })();
  return hdLoading;
}

const BASE = `${import.meta.env.BASE_URL}assets/`;

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function pens(img: HTMLImageElement, scale: number): Uint8Array {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] ? Math.round(d[i * 4] / scale) : 0;
  return out;
}

export async function loadAssets() {
  const json = (url: string) => fetch(BASE + url).then((r) => {
    if (!r.ok) throw new Error(`missing ${url}`);
    return r.json();
  });
  assets.sprites = await json('sprites.json');
  const pages = await Promise.all(Array.from({ length: assets.sprites.pages }, (_, i) => loadImage(`${BASE}sprites-${i}.png`)));
  assets.spritePens = pages.map((p) => pens(p, 17));
  assets.spriteW = pages[0].width;
  assets.tilePens = pens(await loadImage(`${BASE}tiles.png`), 32);
  assets.title = await loadImage(`${BASE}title.png`).catch(() => null);
  assets.select = await loadImage(`${BASE}select.png`).catch(() => null);
  assets.magic = await json('magic.json').catch(() => ({}));
}

export async function loadArea(n: number): Promise<AreaData> {
  let a = assets.areas.get(n);
  if (!a) {
    a = (await fetch(`${BASE}areas/${n}.json`).then((r) => r.json())) as AreaData;
    assets.areas.set(n, a);
  }
  return a;
}

export function decode32(b64: string): Uint32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint32Array(bytes.buffer);
}

export function decode8(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** The attack header of a script, if it attacks: [reaction, damage, active step, x1, x2, y1, y2]. */
export function attackOf(addr: number): number[] | undefined {
  return assets.sprites.attacks[addr.toString(16)];
}

export function anim(addr: number): AnimStep[] {
  const a = assets.sprites.anims[addr.toString(16)];
  if (!a) throw new Error(`no anim ${addr.toString(16)}`);
  return a;
}
