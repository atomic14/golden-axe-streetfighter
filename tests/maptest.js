tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
game.startMap();
await sleep(300);
for (const t of [10, 40, 120]) { while (game.t < t) advance(1); await shot('map-' + t); }
return game.state;
