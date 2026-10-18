eval(await (await fetch('/tests/autoplay.js')).text());
tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
const area0 = game.area, log = [];
for (let t = 0; t < 12000; t++) {
  const s = game.stage, h = game.heroes[0];
  if (h) h.hp = 48;
  if (game.state === 'play' || game.state === 'camp') autoplay(t);
  advance(1);
  if (t % 1000 === 0) { log.push([t, game.state, game.area, s.progress.toString(16), s.stopIndex, s.spawnIndex, h.state, s.actors.filter(a => a.isEnemy && a.hostile).map(a => a.kind?.name ?? a.type).join(',')]); await shot(`area${area0}-${t / 1000}`); }
  if (game.area !== area0) { log.push(['next area', t]); break; }
}
return log;
