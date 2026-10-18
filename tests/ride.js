eval(await (await fetch('/tests/autoplay.js')).text());
tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
const s = game.stage, h = game.heroes[0];
// fight until the first beast appears and is freed, then ride it
let beast = null, phase = 'fight', log = [];
for (let t = 0; t < 4000; t++) {
  h.hp = Math.max(h.hp, 30);
  beast = s.actors.find(a => a.constructor.name === 'Beast');
  if (beast && !beast.rider && !h.mount && phase === 'fight') phase = 'mount';
  if (phase === 'mount' && beast && !h.mount) {
    // walk to it
    const dx = beast.x - h.x, dz = beast.z - h.z;
    for (const [k, v] of [['KeyD', dx > 4], ['KeyA', dx < -4], ['KeyS', dz > 2], ['KeyW', dz < -2], ['KeyJ', false]]) K(k, v);
  } else if (phase === 'mount' && h.mount) { phase = 'ride'; await shot('ride-on'); log.push(['mounted', t]); }
  else if (phase === 'ride') {
    autoplay(t);
    if (t % 300 === 0) await shot('ride-' + t);
    if (!h.mount) { log.push(['off', t]); phase = 'fight'; }
  } else autoplay(t);
  advance(1);
  if (t % 500 === 0) log.push([t, phase, beast ? [beast.type, beast.state, !!beast.rider] : null, h.state]);
}
return log;
