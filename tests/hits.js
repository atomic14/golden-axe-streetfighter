// Hit testing and the dragons: sweep a soldier around the hero to map where the first swing
// lands, then let each kind of dragon (with a rider) attack a hero standing still.
const { Enemy, KINDS, spawnActor } = mods;
tap('Enter'); advance(20); tap('Enter');
while (game.state !== 'play') await sleep(50);
advance(400);
const s = game.stage, h = game.heroes[0];
const out = {};

// 1. where does each move land? (rows: move and depth offset, columns: x offset from the hero,
// who faces right; '#' = the soldier was hit). The jump attack's active step only reaches a
// standing soldier from within about 43px of the ground, as in the original.
s.spawnIndex = 9999;
const xs = [];
for (let dx = -72; dx <= 72; dx += 6) xs.push(dx);
const moves = {
  swing: () => { h.setState('attack'); h.playMove(h.anims.attacks[0]); },
  back: () => { h.facing = -1; h.setState('back'); h.playMove(h.anims.back); },
  dash: () => h.dashAttack(),
  // attacking on the way up, at the top and on the way down
  jumpup: async () => { h.jump(false); advance(16); K('KeyJ', true); advance(1); K('KeyJ', false); },
  jumptop: async () => { h.jump(false); advance(30); K('KeyJ', true); advance(1); K('KeyJ', false); },
  jumpdown: async () => { h.jump(false); advance(46); K('KeyJ', true); advance(1); K('KeyJ', false); },
};
const grid = ['           ' + xs.map((x) => (x === 0 ? '0' : x % 24 === 0 ? '|' : ' ')).join('')];
for (const [name, start] of Object.entries(moves)) {
  for (const dz of [0, 6, 7]) {
    let row = '';
    for (const dx of xs) {
      s.actors = [h];
      h.setState('stand', h.anims.idle);
      h.facing = 1; h.combo = 0; h.comboTimer = 0; h.vx = h.vy = 0; h.x = 0x1000 - s.camx + 150; h.y = h.ground;
      const e = new Enemy(s, KINDS.heninger, h.x + dx, h.z + dz, 0x1a);
      e.entering = false; e.cooldown = 999; e.y = e.ground;
      e.update = () => {};
      s.actors.push(e);
      await start();
      for (let t = 0; t < 70; t++) advance(1);
      row += e.hp < 16 ? '#' : '.';
    }
    grid.push(`${name.padEnd(7)} ${String(dz).padStart(2)} ${row}`);
  }
}
out.sweep = grid;

// 2. the dragons
for (const [name, init] of [['red', 0x306aa], ['blue', 0x2f60a], ['chicken', 0x2c264]]) {
  s.actors = [h];
  h.hp = 48; h.setState('stand', h.anims.idle); h.facing = 1; h.y = h.ground; h.invuln = 0;
  const b = spawnActor(s, init, h.x + 110, h.z, 0);
  b.y = b.ground;
  s.actors.push(b);
  const log = [], seen = new Set();
  let shots = 0;
  for (let t = 0; t < 900; t++) {
    h.hp = Math.max(h.hp, 40);
    if (h.state === 'stand') h.facing = 1;
    const before = h.hp;
    advance(1);
    for (const a of s.actors) {
      if (a === b || a === h) continue;
      const k = `${a.constructor.name} pal ${a.pal.toString(16)} anim ${a.anim.addr.toString(16)} frame ${a.anim.frame.toString(16)}`;
      if (!seen.has(k)) { seen.add(k); log.push([t, k]); }
      if (shots < 2 && a.constructor.name !== 'Enemy' && a.anim.index === 1) { await shot(`dragon-${name}-${shots++}`); }
    }
    if (h.hp < before) log.push([t, `hero hit for ${before - h.hp}, beast at ${Math.round(b.x - h.x)} dz ${b.z - h.z}`]);
  }
  out[name] = log.slice(0, 16);
}
return out;
