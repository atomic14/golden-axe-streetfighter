# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "spandrel", "pillow", "numpy"]
# ///
"""
Upscale each area's background layers with an AI model, whole and in context (so there are no
seams between tiles), and map the result back onto the tiles' palettes.

Each layer (public/assets/areas/<n>.json: cells of tile + 8-colour group + priority) is built in
colour from the tile atlas with the area's own palette, upscaled in overlapping blocks, and every
8x8 cell's block of the result then takes the nearest of that cell's group's colours (pens 1..7,
or 0..7 for the opaque far layer; the near layer's transparent pixels come from upscaling its
shape). The pens are written as public/assets/hd/area<n>-<fg|bg>.png (pen * 32, like tiles.png),
so the game can still swap palettes (night, the boss's sunset).

usage: uv run tools/upscale/layers.py <model.pth> [areas, e.g. 0,1]
"""
import base64
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

ASSETS = Path('public/assets')
BLOCK, OVERLAP = 160, 24


def u32(b64: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(b64), dtype='<u4')


def spread(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill pixels outside mask from their filled neighbours, ring by ring (no fake background)."""
    rgb, filled = rgb.astype(np.float32).copy(), mask.copy()
    if not filled.any():
        return rgb
    for _ in range(48):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    rgb[~filled] = rgb[filled].mean(0)
    return rgb


def upscale(model, img: np.ndarray, scale: int, device) -> np.ndarray:
    """Run the model over an HxWx3 image (0..255) in overlapping blocks."""
    h, w, _ = img.shape
    out = np.zeros((h * scale, w * scale, 3), np.float32)
    for y in range(0, h, BLOCK):
        for x in range(0, w, BLOCK):
            y0, x0 = max(0, y - OVERLAP), max(0, x - OVERLAP)
            y1, x1 = min(h, y + BLOCK + OVERLAP), min(w, x + BLOCK + OVERLAP)
            t = torch.from_numpy(img[y0:y1, x0:x1].transpose(2, 0, 1).copy()).float().div(255).unsqueeze(0).to(device)
            with torch.no_grad():
                o = model(t).squeeze(0).clamp(0, 1).cpu().numpy().transpose(1, 2, 0) * 255
            by, bx = (y - y0) * scale, (x - x0) * scale
            hh, ww = (min(h, y + BLOCK) - y) * scale, (min(w, x + BLOCK) - x) * scale
            out[y * scale:y * scale + hh, x * scale:x * scale + ww] = o[by:by + hh, bx:bx + ww]
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    model_path = Path(args[0])
    areas = [int(a) for a in args[1].split(',')] if len(args) > 1 else range(5)
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    desc = ModelLoader().load_from_file(str(model_path))
    model, S = desc.model.to(device).eval(), desc.scale
    tiles = np.asarray(Image.open(ASSETS / 'tiles.png').convert('RGBA'))
    tile_pens = np.where(tiles[..., 3] > 0, np.round(tiles[..., 0] / 32), 0).astype(np.uint8)
    cols = tiles.shape[1] // 8
    (ASSETS / 'hd').mkdir(exist_ok=True)
    for n in areas:
        area = json.loads((ASSETS / f'areas/{n}.json').read_text())
        keys = sorted(int(k) for k in area['palettes'])
        key = next((k for k in keys if 0 < k < 100), keys[0])
        v = u32(area['palettes'][str(key)])
        pal = np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255], 1).astype(np.float32)
        for name, opaque in (('bg', True), ('fg', False)):
            L = area[name]
            cells = u32(L['cells']).reshape(L['h'], L['w'])
            H, W = L['h'] * 8, L['w'] * 8
            pens = np.zeros((H, W), np.uint8)
            group = np.zeros((L['h'], L['w']), np.int32)
            used = cells != 0xFFFFFFFF
            for ty, tx in zip(*np.nonzero(used)):
                c = int(cells[ty, tx])
                t, g = c & 0xFFFF, ((c >> 16) & 0x7F) * 8
                ax, ay = (t % cols) * 8, (t // cols) * 8
                pens[ty * 8:ty * 8 + 8, tx * 8:tx * 8 + 8] = tile_pens[ay:ay + 8, ax:ax + 8]
                group[ty, tx] = g
            gpx = np.kron(group, np.ones((8, 8), np.int32))
            usedpx = np.kron(used, np.ones((8, 8), bool))
            shape = usedpx if opaque else usedpx & (pens > 0)
            rgb = pal[gpx + pens]
            big = upscale(model, spread(rgb, shape).clip(0, 255), S, device)
            mask = upscale(model, np.repeat((shape * 255).astype(np.float32)[..., None], 3, 2), S, device)[..., 0] > 127
            # each cell's block takes the nearest colour of its own group
            out = np.zeros((H * S, W * S), np.uint8)
            lo = 0 if opaque else 1
            for ty, tx in zip(*np.nonzero(used)):
                g = group[ty, tx]
                cand = pal[g + lo:g + 8]
                blk = big[ty * 8 * S:(ty + 1) * 8 * S, tx * 8 * S:(tx + 1) * 8 * S]
                d = ((blk[..., None, :] - cand[None, None]) ** 2).sum(-1)
                p = d.argmin(-1).astype(np.uint8) + lo
                if not opaque:
                    p[~mask[ty * 8 * S:(ty + 1) * 8 * S, tx * 8 * S:(tx + 1) * 8 * S]] = 0
                out[ty * 8 * S:(ty + 1) * 8 * S, tx * 8 * S:(tx + 1) * 8 * S] = p
            a = np.where((out > 0) | (opaque & np.kron(used, np.ones((8 * S, 8 * S), bool))), 255, 0).astype(np.uint8)
            g8 = (out.astype(np.uint16) * 32).clip(0, 255).astype(np.uint8)
            Image.fromarray(np.stack([g8, g8, g8, a], 2)).save(ASSETS / f'hd/area{n}-{name}.png', optimize=True)
            print(f'area {n} {name}: {W}x{H} -> {W * S}x{H * S}', flush=True)


main()
