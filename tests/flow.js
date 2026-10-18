eval(await (await fetch('/tests/autoplay.js')).text());
tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
const seen = [];
let last = '';
for (let t = 0; t < 14000; t++) {
  const h = game.heroes[0];
  if (h) h.hp = 48;
  if (['play', 'camp'].includes(game.state)) autoplay(t);
  advance(1);
  const k = game.state + ':' + game.area;
  if (k !== last) { seen.push([t, k]); last = k; }
  if (game.state === 'loading') await sleep(100);
  if (game.area === 1 && game.state === 'play' && seen.length > 6) break;
}
return seen;
