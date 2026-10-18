tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
advance(400);
const h = game.heroes[0];
h.potions = h.def.magicLevels;
tap('KeyL');
for (let i = 0; i < 12; i++) { advance(20); await shot('magic' + String(i).padStart(2, '0')); }
return [h.state, game.stage.actors.filter(a => a.isEnemy).map(a => [a.kind?.name, a.hp, a.state])];
