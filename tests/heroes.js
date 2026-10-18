// Every hero's moves, played through the keyboard against a soldier: the combo, grab / knees /
// throw, back attack, dash attack, jump attack, each level of magic and riding a beast. For
// each move: what the hero's animation did, what happened to the soldier and the damage done;
// screenshots of each move go to work/shots/hero-<name>-<move>.png.
// usage: npx tsx tools/play.ts tests/heroes.js
const { Enemy, KINDS, spawnActor } = mods;
const hold = (k, n) => { K(k, true); advance(n); K(k, false); };
const out = {};
for (const idx of [0, 1, 2]) {
  // start a game as this hero
  game.go('title');
  game.heroes = [];
  advance(5);
  tap('Enter'); advance(20);
  game.choice = idx;
  tap('Enter');
  while (game.state !== 'play') await sleep(50);
  advance(60);
  const s = game.stage, h = game.heroes[0], name = h.def.name.split(' ')[0].toLowerCase();
  s.spawnIndex = 9999;
  const res = {};
  out[name] = res;
  const sx = (x) => Math.round(x - 0x1000 + s.camx + 8);
  const fresh = (dx, dz = 0, kind = 'heninger') => {
    s.actors = [h];
    h.setState('stand', h.anims.idle); h.combo = 0; h.comboTimer = 0; h.vx = h.vy = 0; h.invuln = 0; h.hp = 48;
    h.x = 0x1000 - s.camx + 140; h.z = s.floorZ(h.x, 0x1070); h.y = h.ground; h.facing = 1;
    const e = new Enemy(s, KINDS[kind], h.x + dx, h.z + dz, 0x1a);
    e.entering = false; e.y = e.ground; e.cooldown = 9999; e.update0 = e.update;
    // the soldier only reacts (no walking or attacking)
    e.update = function () { if (this.updateCommon()) return; this.anim.tick(); };
    s.actors.push(e);
    return e;
  };
  // play a move: run `press`, then watch for `ticks`, recording animations and snapping frames
  const watch = async (move, e, press, ticks, snaps = [10, 30]) => {
    const hp0 = e.hp, anims = new Set(), states = new Set(), es = new Set();
    await press();
    for (let t = 0; t < ticks; t++) {
      advance(1);
      anims.add(h.anim.addr.toString(16)); states.add(h.state); es.add(e.state);
      if (snaps.includes(t)) { game.paused = true; advance(1); await shot(`hero-${name}-${move}-${t}`); game.paused = false; }
    }
    res[move] = { hero: [...states].join(' '), scripts: [...anims].join(' '), enemy: [...es].join(' '), damage: hp0 - e.hp, enemyAt: `${sx(e.x) - sx(h.x)},${Math.round(e.y - e.ground)}` };
  };

  // the combo: four presses at swinging distance
  let e = fresh(30);
  await watch('combo', e, async () => {}, 0);
  for (let i = 0; i < 4; i++) { hold('KeyJ', 2); for (let t = 0; t < 14; t++) advance(1); }
  await watch('combo', e, async () => {}, 60, [0]);
  res.combo.damage = 16 - e.hp;

  // grab (attack right up close), knees, then the throw
  e = fresh(14);
  await watch('grab', e, async () => { hold('KeyJ', 2); }, 20, [10]);
  await watch('throw', e, async () => { for (let i = 0; i < 3; i++) { hold('KeyJ', 2); advance(20); } }, 90, [5, 25, 45, 60, 75]);
  res.throw.damage = 16 - e.hp;

  // back attack: attack and jump together, soldier behind
  e = fresh(idx === 2 ? -70 : -30); // Gilius's back attack is a long leap
  await watch('back', e, async () => { K('KeyJ', true); K('KeyK', true); advance(2); K('KeyJ', false); K('KeyK', false); }, 50, [8, 20]);

  // dash attack: double-tap right to run, then attack
  e = fresh(110);
  await watch('dash', e, async () => { hold('KeyD', 2); advance(3); K('KeyD', true); advance(14); hold('KeyJ', 2); K('KeyD', false); }, 50, [4, 14]);

  // jump attack: jump, attack on the way down
  e = fresh(36);
  await watch('jump', e, async () => { hold('KeyK', 2); advance(44); hold('KeyJ', 2); }, 50, [2, 8]);

  // magic at every level, three soldiers around
  res.magic = [];
  for (let lv = 1; lv <= h.def.magicLevels; lv++) {
    e = fresh(60);
    const e2 = new Enemy(s, KINDS.heninger, h.x - 70, h.z, 0x1a), e3 = new Enemy(s, KINDS.heninger, h.x + 100, h.z + 10, 0x1a);
    for (const x of [e2, e3]) { x.entering = false; x.y = x.ground; x.update = e.update; s.actors.push(x); }
    h.potions = lv;
    const fx0 = s.actors.length;
    hold('KeyL', 2);
    let peak = 0, shotTaken = false;
    for (let t = 0; t < 400 && h.state === 'magic' || t < 10; t++) {
      advance(1);
      const fx = s.actors.find((a) => a.constructor.name === 'MagicEffect');
      if (fx) peak = Math.max(peak, fx.ticks[fx.tick]?.length ?? 0);
      if (fx && !shotTaken && fx.tick === fx.peak - 2) { shotTaken = true; game.paused = true; advance(1); await shot(`hero-${name}-magic${lv}`); game.paused = false; }
    }
    res.magic.push({ level: lv, potionsLeft: h.potions, state: h.state, effectSprites: peak, damage: [e, e2, e3].map((x) => 16 - x.hp).join('/') });
  }

  // riding: walk onto a chicken leg, attack a soldier in reach
  e = fresh(80);
  const b = spawnActor(s, 0x2c264, h.x + 30, h.z, 0);
  b.y = b.ground; b.setRider(null); s.actors.push(b);
  K('KeyD', true); for (let t = 0; t < 40 && !h.mount; t++) advance(1); K('KeyD', false);
  advance(20);
  await watch('ride', e, async () => { if (h.mount) { h.facing = b.facing = 1; } hold('KeyJ', 2); }, 60, [0, 20]);
  res.ride.mounted = !!h.mount;
  res.ride.beastScripts = b.anim.addr.toString(16);
  if (h.mount) { hold('KeyK', 2); advance(60); }
}
return out;
