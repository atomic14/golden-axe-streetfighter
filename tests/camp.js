eval(await (await fetch('/tests/autoplay.js')).text());
tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
// jump to the end of area 0
const s = game.stage;
for (let t = 0; t < 9000 && game.state !== 'camp'; t++) {
  game.heroes[0].hp = 48;
  autoplay(t);
  advance(1);
}
for (let i = 0; i < 8; i++) { await shot('camp' + i); for (let t = 0; t < 60; t++) { autoplay(t); advance(1); } }
const h = game.heroes[0]; return [game.state, game.area, h.state, h.x.toString(16), h.z.toString(16), h.y.toString(16), !!h.mount, game.stage.camx, game.stage.actors.map(a => [a.constructor.name, a.kind?.name ?? a.type, a.state, a.x.toString(16), a.z.toString(16), a.y.toString(16), a.hp])];
