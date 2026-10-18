// Screenshots of each rung's VS screen and a moment of its fight (?demo).
// usage: npx tsx tools/play.ts tests/ladder-shots.js 'http://localhost:5191/?demo'
while (!game.fighters.length || game.state === 'loading') await sleep(50);
for (let r = 0; r < game.rungs.length; r++) {
  await game.startFight(r);
  advance(40);
  await shot(`rung-${r}-vs`);
  while (game.state !== 'fight') advance(1);
  advance(420);
  await shot(`rung-${r}-fight`);
}
