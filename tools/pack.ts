// Simple shelf packer for sprite atlases.
export interface Rect { w: number; h: number; x?: number; y?: number; page?: number }

export function pack(rects: Rect[], size = 2048): number {
  const order = rects.map((_, i) => i).sort((a, b) => rects[b].h - rects[a].h);
  let page = 0, x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const r = rects[i];
    if (x + r.w > size) { x = 0; y += shelf + 1; shelf = 0; }
    if (y + r.h > size) { page++; x = 0; y = 0; shelf = 0; }
    r.x = x; r.y = y; r.page = page;
    x += r.w + 1;
    shelf = Math.max(shelf, r.h);
  }
  return page + 1;
}
