// The heads-up display: stage number and magic pots at the top, health bars, lives and the
// portrait at the bottom, laid out like the original's text layer.
import { ctx, drawSprite, drawText, fillRect } from '../gfx';
import type { Hero } from './hero';
import type { Stage } from './stage';

export function drawHud(stage: Stage, heroes: Hero[]) {
  drawText(`STAGE ${stage.shown}`, 16, 16, '#f80');
  heroes.forEach((h, i) => {
    const x0 = 56 + i * 144;
    // magic: one jar per potion, out of the hero's maximum level
    drawText('MAGIC', 104 + i * 96, 2, '#f44');
    for (let k = 0; k < h.def.magicLevels; k++) {
      const x = 104 + i * 96 + k * 8, y = 11;
      fillRect(x, y, 7, 10, k < h.potions ? '#36f' : '#a00');
      if (k < h.potions) fillRect(x + 2, y + 1, 3, 3, '#9cf');
    }
    // health: three bars of 16
    for (let b = 0; b < 3; b++) {
      const v = Math.max(0, Math.min(16, h.hp - b * 16));
      fillRect(x0 + b * 24, 205, 22, 8, '#002');
      if (v > 0) fillRect(x0 + b * 24 + 1, 206, Math.round((20 * v) / 16), 6, '#22f');
    }
    drawText(String(Math.max(0, h.lives)), x0 + 76, 205, '#ff0');
    if (h.cpu && heroes.some((o) => !o.cpu)) drawText('CPU', x0, 195, '#8af');
    // the portrait at half size, as the original shows it
    ctx.save();
    ctx.translate(x0 + 98, 214);
    ctx.scale(0.5, 0.5);
    drawSprite(h.def.face, h.def.pal, 0, 0, false);
    ctx.restore();
  });
}
