// The computer partner (and, with ?auto, the computer as player 1 too) playing on its own.
// Logs, per hero: lives lost, pit falls, damage taken and dealt, items picked up, what the brain
// spent its time doing, and when each area was cleared. Stops after `LIMIT` ticks or area 3.
// usage: npx tsx tools/play.ts tests/partner.js 'http://localhost:5180/?cpu&auto'
const TRACE = new URLSearchParams(location.search).has('trace');
const STOP = Number(new URLSearchParams(location.search).get('stop') ?? 3);
const LIMIT = Number(new URLSearchParams(location.search).get('limit') ?? 30000);
// hero=n: play as hero n (0 Ax, 1 Tyris, 2 Gilius)
tap('Enter'); advance(20);
if (new URLSearchParams(location.search).has('hero')) game.choice = Number(new URLSearchParams(location.search).get('hero'));
tap('Enter');
while (game.state !== 'play') await sleep(50);
const stats = game.heroes.map((h) => ({ hero: h.def.name.split(' ')[0], cpu: h.cpu, lost: 0, pits: 0, taken: 0, dealt: 0, items: 0, doing: {} }));
const wrap = (h, i) => {
  const st = stats[i];
  const pit = h.fallInPit.bind(h);
  h.fallInPit = () => { if (h.state !== 'respawn') st.pits++; pit(); };
  const lose = h.loseLife.bind(h);
  h.loseLife = () => { st.lost++; lose(); };
  st.hitBy = {};
  const take = h.takeHit.bind(h);
  h.takeHit = (from, dmg, knock) => {
    const r = take(from, dmg, knock);
    if (r) { const k = from.constructor.name + (from.kind?.name ? ':' + from.kind.name : ''); st.hitBy[k] = (st.hitBy[k] ?? 0) + dmg; }
    return r;
  };
  const direct = h.takeHitDirect.bind(h);
  h.takeHitDirect = (from, dmg, dir) => { const k = 'off-mount:' + from.constructor.name; st.hitBy[k] = (st.hitBy[k] ?? 0) + dmg; direct(from, dmg, dir); };
  const potions = h.potions;
  st._p = potions;
};
game.heroes.forEach(wrap);
const events = [];
let last = game.state + game.area, hpPrev = game.heroes.map((h) => h.hp);
const enemyHp = new Map();
let lastProg = 0, stallAt = 0;
// walk=N: a person holds right for N ticks, then stands still and lets the partner fight
const WALK = Number(new URLSearchParams(location.search).get('walk') ?? 0);
if (WALK) K('KeyD', true);
for (let t = 0; t < LIMIT; t++) {
  if (WALK && t === WALK) K('KeyD', false);
  advance(1);
  const s = game.stage;
  if (game.state === 'continue') { events.push([t, 'continue']); tap('Enter'); }
  const k = game.state + game.area;
  if (k !== last) { events.push([t, `${game.state}:${game.area}`]); last = k; }
  while (game.state === 'loading') await sleep(20);
  if (game.area >= STOP) break;
  game.heroes.forEach((h, i) => {
    const st = stats[i];
    if (h.hp < hpPrev[i] && h.state !== 'respawn') st.taken += hpPrev[i] - h.hp;
    if (h.hp > hpPrev[i] && h.hp - hpPrev[i] === 16) st.items++;
    if (h.potions > st._p) st.items++;
    st._p = h.potions;
    hpPrev[i] = h.hp;
    if (h.brain && t % 10 === 0) st.doing[h.brain.doing] = (st.doing[h.brain.doing] ?? 0) + 1;
  });
  if (s && game.state === 'play') {
    for (const a of s.actors) {
      if (!a.isEnemy) continue;
      const p = enemyHp.get(a);
      if (p !== undefined && a.hp < p && a.lastHitBy) {
        const i = game.heroes.indexOf(a.lastHitBy);
        if (i >= 0) stats[i].dealt += p - a.hp;
      }
      enemyHp.set(a, a.hp);
    }
  }
  // progress stalled for 20s: say what is on the stage
  if (s && game.state === 'play') {
    if (s.progress !== lastProg) { lastProg = s.progress; stallAt = t; }
    else if (t - stallAt === 1200) {
      const sx = (x) => Math.round(x - 0x1000 + s.camx + 8);
      events.push([t, 'stalled', s.progress.toString(16), s.actors.map((a) => `${a.constructor.name}${a.kind ? ':' + a.kind.name : ''} ${a.state} @${sx(a.x)},${Math.round(a.z).toString(16)} y${Math.round(a.y).toString(16)}/${a.ground.toString(16)}${a.isEnemy && a.hostile && !a.dead ? ' HOSTILE' : ''}${a.entering ? ' entering' : ''}`)]);
    }
  }
  if (TRACE && t % 300 === 0 && s) {
    events.push([t, game.state, s.progress.toString(16), game.heroes.map((h) => {
      const b = h.brain, tg = b?.target, sx = (x) => Math.round(x - 0x1000 + s.camx + 8);
      return `${h.def.name[0]} ${h.state} @${sx(h.x)},${h.z.toString(16)} hp${h.hp} ${b?.doing ?? ''}${tg ? ` tgt ${tg.constructor.name} @${sx(tg.x)},${tg.z.toString(16)} ${tg.state}` : ''}`;
    }).join(' | ')]);
  }
  if (t % 2000 === 0) await sleep(0);
  if (t === 1200) await shot('partner-1200');
}
stats.forEach((s) => delete s._p);
return { events, stats };
