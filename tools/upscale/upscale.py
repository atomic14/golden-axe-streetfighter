# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "spandrel", "pillow", "numpy"]
# ///
"""
Upscale exported sprite frames (tools/upscale/export.ts) with any model spandrel can load
(most of OpenModelDB: ESRGAN, Real-ESRGAN, SwinIR, HAT, ...), then map the result back onto
the frame's palette so the game can still recolour it.

For each frame:
  - the transparent area is filled by spreading the edge colours outwards (so the model sees
    no artificial background to smear into the outline), with a margin all round;
  - the colour image and the shape (alpha as grey) are upscaled separately;
  - every pixel inside the upscaled shape takes the nearest of the frame's 14 colours.

Writes <out>/<model>/fXXX.png (the result in colour) and fXXX-pens.png (pen numbers 0..14 as
grey levels, 0 transparent), plus the model's raw output when --raw is given.

usage: uv run tools/upscale/upscale.py <model.pth> <export dir> [--only f0f0,f0f1,...] [--raw]
"""
import json
import sys
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

PAD = 8


def spread(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill pixels outside mask with the average of filled neighbours, ring by ring."""
    rgb, filled = rgb.astype(np.float32).copy(), mask.copy()
    if not filled.any():
        return rgb
    for _ in range(64):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(filled.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            sh = np.roll(np.roll(filled, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    rgb[~filled] = rgb[filled].mean(0)
    return rgb


def run(model, img: np.ndarray, device) -> np.ndarray:
    t = torch.from_numpy(img.transpose(2, 0, 1)).float().div(255).unsqueeze(0).to(device)
    with torch.no_grad():
        o = model(t)
    return (o.squeeze(0).clamp(0, 1).cpu().numpy().transpose(1, 2, 0) * 255)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    model_path, export = Path(args[0]), Path(args[1])
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    raw = '--raw' in sys.argv
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    desc = ModelLoader().load_from_file(str(model_path))
    model = desc.model.to(device).eval()
    scale = desc.scale
    meta = json.loads((export / 'frames.json').read_text())
    out = export / model_path.stem
    out.mkdir(parents=True, exist_ok=True)
    files = sorted((export / 'in').glob('f*.png'))
    if only:
        files = [f for f in files if f.stem in only]
    for n, f in enumerate(files):
        idx = int(f.stem[1:], 16)
        colors = np.array(meta[str(idx)]['colors'][1:15], np.float32)
        im = np.asarray(Image.open(f).convert('RGBA'))
        mask = im[..., 3] > 0
        rgb = np.pad(im[..., :3], ((PAD, PAD), (PAD, PAD), (0, 0)))
        m = np.pad(mask, PAD)
        big = run(model, spread(rgb, m).clip(0, 255), device)
        shape = run(model, np.repeat((m * 255).astype(np.float32)[..., None], 3, 2), device)[..., 0]
        c = PAD * scale
        big, shape = big[c:-c, c:-c], shape[c:-c, c:-c]
        inside = shape > 127
        # nearest palette colour (pens 1..14) for every pixel in the shape
        d = ((big[..., None, :] - colors[None, None]) ** 2).sum(-1)
        pen = d.argmin(-1).astype(np.uint8) + 1
        pen[~inside] = 0
        Image.fromarray(pen).save(out / f'{f.stem}-pens.png')
        col = np.zeros((*pen.shape, 4), np.uint8)
        col[..., :3] = np.concatenate([[[0, 0, 0]], colors, [[0, 0, 0]]])[pen].astype(np.uint8)
        col[..., 3] = (pen > 0) * 255
        Image.fromarray(col).save(out / f'{f.stem}.png')
        if raw:
            r = np.concatenate([big, shape[..., None]], 2).clip(0, 255).astype(np.uint8)
            Image.fromarray(r).save(out / f'{f.stem}-raw.png')
        if n % 100 == 0:
            print(f'{n}/{len(files)} {f.stem}', flush=True)
    print(f'{len(files)} frames x{scale} -> {out}')


main()
