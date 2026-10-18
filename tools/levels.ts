// Rebuilds each stage's background layers, height map and palette from MAME RAM recordings
// of a playthrough (tools/mame/bot.lua). The game streams tiles into a small virtual tilemap as
// it scrolls; here every visible tile is mapped to world coordinates and the most common tile
// seen in each cell wins.
import { readDump, u16, u32, s16, type Frame } from './dumpfile';
import { tileCode, virtualTile } from './render16b';

const wrap512 = (d: number) => ((((d + 256) % 512) + 512) % 512) - 256;
const wrap256 = (d: number) => ((((d + 128) % 256) + 256) % 256) - 128;
const W = (f: Frame, a: number) => s16(f.work, a - 0xc000);

export interface LayerCapture {
  /** votes per world tile: key (ty << 16 | tx & 0xffff) -> tile word -> count */
  cells: Map<number, Map<number, number>>;
}

export interface StageCapture {
  stage: number;
  fg: LayerCapture;
  bg: LayerCapture;
  /** samples of [fgU, fgV, bgU, bgV] to relate the background scroll to the camera */
  scroll: number[][];
  /** tile palette RAM (1024 colours) for each displayed stage number in this area */
  palettes: Map<number, Uint8Array>;
  height: Uint8Array;
  bank1: number;
  frames: number;
  camMin: [number, number];
  camMax: [number, number];
}

let hudSeen = false;

/** The stage index (0xffed4a) and whether this frame shows normal play. */
export function playState(f: Frame) {
  const camx = W(f, 0xecf8) + W(f, 0xed20), camy = W(f, 0xecfa) - W(f, 0xed28);
  const effx = (0xc0 - u16(f.text, 0xe98)) & 0x1ff, ys = u16(f.text, 0xe90) & 0x1ff;
  // the game keeps x scroll to 9 bits and y scroll to 8, swapping tilemap pages to cover the rest
  const ok = ((effx - (-7 - camx)) & 0x1ff) === 0 && ((ys - (-512 - camy)) & 0xff) === 0
    && !(u16(f.text, 0xe98) & 0x8000) && !(u16(f.text, 0xe90) & 0x8000);
  // the HUD's "STAGE n" label is only shown during play; n is the displayed stage
  const hud = (u16(f.text, 0x134) & 0x1ff) === 0x53 && (u16(f.text, 0x136) & 0x1ff) === 0x54;
  const shown = (u16(f.text, 0x140) & 0x1ff) - 0x30;
  // the opening intro (walking in before the HUD appears) is play too, once the select screen is over
  // (the select screen runs the player object with the handler at 0x2490)
  const intro = !hud && !hudSeen && f.work[0xed4a - 0xc000] === 0 && u32(f.work, 2) !== 0x2490 && f.frame > 300;
  if (hud) hudSeen = true;
  return { stage: f.work[0xed4a - 0xc000], shown: hud ? shown : 1, camx, camy, ok: ok && (hud || intro) };
}

function vote(cap: LayerCapture, tx: number, ty: number, word: number) {
  const k = (ty << 16) | (tx & 0xffff);
  let m = cap.cells.get(k);
  if (!m) cap.cells.set(k, (m = new Map()));
  m.set(word, (m.get(word) ?? 0) + 1);
}

function sample(f: Frame, cap: LayerCapture, which: 0 | 1, U: number, V: number) {
  const pages = u16(f.text, 0xe80 + which * 2);
  const xs = u16(f.text, 0xe98 + which * 2), ys = u16(f.text, 0xe90 + which * 2);
  const effx = (0xc0 - xs) & 0x3ff, effy = ys & 0x1ff;
  // world tiles fully inside the 320x224 screen
  for (let wy = Math.ceil(V / 8) * 8; wy + 8 <= V + 224; wy += 8) {
    for (let wx = Math.ceil(U / 8) * 8; wx + 8 <= U + 320; wx += 8) {
      const sx = wx - U, sy = wy - V;
      const vx = (sx + effx) & 0x3ff, vy = (sy + effy) & 0x1ff;
      vote(cap, wx >> 3, wy >> 3, virtualTile(f, pages, vx, vy));
    }
  }
}

/** Does the text layer show this string (tiles are ASCII codes)? */
function hasText(f: Frame, str: string): boolean {
  // only the visible part: 28 rows of columns 24..63
  const codes = [...str].map((c) => c.charCodeAt(0));
  for (let row = 0; row < 28; row++) {
    for (let col = 24; col + codes.length <= 64; col++) {
      let ok = true;
      for (let i = 0; i < codes.length && ok; i++) ok = (u16(f.text, (row * 64 + col + i) * 2) & 0x1ff) === codes[i];
      if (ok) return true;
    }
  }
  return false;
}

/** Background scroll predicted from earlier [fgU, fgV, bgU, bgV] samples (linear per axis). */
function predictBg(S: number[][], fgU: number, fgV: number): [number, number] {
  const fit = (xi: number, yi: number, x: number) => {
    const n = S.length, mx = S.reduce((a, r) => a + r[xi], 0) / n, my = S.reduce((a, r) => a + r[yi], 0) / n;
    let sxy = 0, sxx = 0;
    for (const r of S) { sxy += (r[xi] - mx) * (r[yi] - my); sxx += (r[xi] - mx) ** 2; }
    const a = sxx > 100 ? sxy / sxx : 1;
    return my + a * (x - mx);
  };
  return [fit(0, 2, fgU), fit(1, 3, fgV)];
}

export function captureStages(dumpPaths: string | string[]): Map<number, StageCapture> {
  const out = new Map<number, StageCapture>();
  let cur: StageCapture | null = null;
  let bgU = 0, bgV = 0, lastBg: [number, number] | null = null;
  hudSeen = false;
  const stageFrames = new Map<string, Uint8Array[]>();
  const inCamp = new Set<number>();
  const heightFill = new Map<number, number>();
  // "path@n" only takes area n from that recording (e.g. a run started in area n that ends
  // with attract-mode demos of other areas)
  for (const spec of [dumpPaths].flat()) {
  const [dumpPath, only] = spec.split('@');
  lastBg = null;
  hudSeen = false;
  inCamp.clear();
  for (const f of readDump(dumpPath)) {
    const st = playState(f);
    if (!st.ok || (only !== undefined && st.stage !== Number(only))) { lastBg = null; continue; }
    if (!out.has(st.stage)) {
      out.set(st.stage, {
        stage: st.stage, fg: { cells: new Map() }, bg: { cells: new Map() }, scroll: [],
        palettes: new Map(), height: new Uint8Array(0x4000), bank1: 0, frames: 0,
        camMin: [st.camx, st.camy], camMax: [st.camx, st.camy],
      });
    }
    cur = out.get(st.stage)!;
    const fgU = -7 - st.camx, fgV = -512 - st.camy;
    const bx = (0xc0 - u16(f.text, 0xe9a)) & 0x1ff, by = u16(f.text, 0xe92) & 0x1ff;
    if (!lastBg) {
      // (re)anchor the background next to the foreground
      bgU = fgU + wrap512(bx - ((0xc0 - u16(f.text, 0xe98)) & 0x1ff));
      bgV = fgV + wrap256(by - (u16(f.text, 0xe90) & 0x1ff));
      if (cur.scroll.length) {
        // keep continuity with the stage's earlier samples when re-entering play: predict the
        // background scroll from the relation seen so far and take the nearest equivalent
        const [pu, pv] = predictBg(cur.scroll, fgU, fgV);
        bgU += 512 * Math.round((pu - bgU) / 512);
        bgV += 256 * Math.round((pv - bgV) / 256);
      }
    } else {
      bgU += wrap512(bx - lastBg[0]);
      bgV += wrap256(by - lastBg[1]);
    }
    lastBg = [bx, by];
    sample(f, cur.fg, 0, fgU, fgV);
    // the background sometimes moves on its own (area 3's drawbridge sequence): only sample it
    // while it keeps to the relation with the foreground seen so far
    let bgOk = true;
    if (cur.scroll.length > 200) {
      const [pu, pv] = predictBg(cur.scroll, fgU, fgV);
      bgOk = Math.abs(pu - bgU) < 24 && Math.abs(pv - bgV) < 24;
    }
    if (bgOk) {
      sample(f, cur.bg, 1, bgU, bgV);
      cur.scroll.push([fgU, fgV, bgU, bgV]);
    } else lastBg = null;
    cur.frames++;
    cur.camMin = [Math.min(cur.camMin[0], st.camx), Math.min(cur.camMin[1], st.camy)];
    cur.camMax = [Math.max(cur.camMax[0], st.camx), Math.max(cur.camMax[1], st.camy)];
    // the height map is written when the area starts and cleared on the way out: keep the
    // fullest copy seen
    if (cur.frames % 16 === 1) {
      let n = 0;
      for (let i = 0xc000; i < 0x10000; i++) if (f.tile[i]) n++;
      if (n > (heightFill.get(st.stage) ?? -1)) {
        heightFill.set(st.stage, n);
        cur.height.set(f.tile.subarray(0xc000, 0x10000));
      }
    }
    // palettes: keep the sequence per displayed stage, with the bonus camp (from when the
    // text layer says BONUS) apart; resolved below
    // the HUD counts the camps as stages too (2, 4, 6); the boss fight at the end of an action
    // stage gets its own palette (key 100 + stage: the sky turns to sunset)
    if (hasText(f, 'BONUS') || st.shown % 2 === 0) inCamp.add(st.stage);
    const boss = -7 - st.camx + 0x1000 - 7 >= 0x14c0 - 7;
    const pk = inCamp.has(st.stage) ? `${st.stage}/0` : `${st.stage}/${boss ? 100 + st.shown : st.shown}`;
    const seq = stageFrames.get(pk) ?? [];
    stageFrames.set(pk, seq);
    if (seq.length % 4 === 0) seq.push(f.pal.slice(0, 0x800));
    else seq.push(seq[seq.length - 1]);
    cur.bank1 = f.work[0xec95 - 0xc000];
  }
  }
  // each stage's palette is the one shown most over its first 40% (skies can fade later); the
  // bonus camp (key 0) has its own night palette
  const mode = (list: Uint8Array[]) => {
    const counts = new Map<string, [number, Uint8Array]>();
    for (const p of list) {
      const k = Buffer.from(p).toString('base64');
      const e = counts.get(k);
      if (e) e[0]++; else counts.set(k, [1, p]);
    }
    return [...counts.values()].sort((a, b) => b[0] - a[0])[0][1];
  };
  for (const [pk, seq] of stageFrames) {
    const [area, shown] = pk.split('/').map(Number);
    out.get(area)!.palettes.set(shown, mode(shown && shown < 100 ? seq.slice(0, Math.max(1, Math.floor(seq.length * 0.4))) : seq));
  }
  return out;
}

/** The winning tile word of each cell, as a dense grid. */
export function layerGrid(cap: LayerCapture) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of cap.cells.keys()) {
    const tx = (k << 16) >> 16, ty = k >> 16;
    x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const grid = new Int32Array(w * h).fill(-1);
  for (const [k, m] of cap.cells) {
    const tx = (k << 16) >> 16, ty = k >> 16;
    let best = -1, bn = 0;
    for (const [word, n] of m) if (n > bn) { bn = n; best = word; }
    grid[(ty - y0) * w + (tx - x0)] = best;
  }
  return { x0, y0, w, h, grid };
}

export { tileCode };
