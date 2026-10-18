eval(await (await fetch('/tests/autoplay.js')).text());
tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
const log = [];
const N = window.N ?? 9000;
for (let t = 0; t < N; t++) {
  const s = game.stage, h = game.heroes[0];
  if (game.state === 'play') { h.hp = Math.max(h.hp, 20); autoplay(t); }
  advance(1);
  if (t % 600 === 0) { await shot('fight' + String(t / 600).padStart(2, '0')); log.push([t, game.state, game.area, s.progress.toString(16), s.stopIndex, s.spawnIndex, h.state, h.hp]); }
}
const s = game.stage;
return [log, s.actors.filter(a => a.isEnemy).map(a => [a.constructor.name, a.kind?.name, a.state, a.x.toString(16), a.z.toString(16), a.x - 0x1000 + s.camx + 8, a.hp])];
