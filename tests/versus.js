// The computer plays the player's side up the arcade ladder (?demo), continuing when it loses.
// Logs each round: the fight, who won and how, damage by move and side, and what the brains spent
// their time on; then each rung's record. Screenshots with &shots.
// usage: npx tsx tools/play.ts tests/versus.js 'http://localhost:5191/?demo&ladders=2'
//        npx tsx tools/play.ts tests/versus.js 'http://localhost:5191/?demo&rung=3&fights=10'
const q = new URLSearchParams(location.search);
const LADDERS = Number(q.get('ladders') ?? 1);
// fights=n: stop after n fights (with &rung=r, to measure one rung)
const FIGHTS = Number(q.get('fights') ?? 1e9);
const SHOTS = q.has('shots');
while (!game.fighters.length || game.state === 'loading') await sleep(50);
const rounds = [], fights = [];
let cur = null, prevState = '', shotN = 0, ladders = 0;
const nameOf = (f) => f.def ? f.def.name.split(' ')[0] : f.title;
const moveOf = (f) => (f.state === 'attack' && f.combo !== undefined ? `combo${f.combo}` : f.state === 'air' ? 'jumpAttack' : f.state);
// damage is put down to what the other fighter was doing when it landed
let hpPrev = [0, 0];
const tally = () => {
  game.fighters.forEach((f, i) => {
    const d = hpPrev[i] - f.hp;
    if (d > 0 && cur) {
      const k = `p${2 - i}:${moveOf(f.foe)}`;
      cur.moves[k] = (cur.moves[k] ?? 0) + d;
      cur.dealt[1 - i] += d;
    }
    hpPrev[i] = f.hp;
  });
};
for (let t = 0; t < 400000 && ladders < LADDERS && fights.length < FIGHTS; t++) {
  advance(1);
  while (game.state === 'loading') await sleep(20);
  tally();
  const s = game.state;
  if (s !== prevState) {
    if (s === 'fight') cur = { rung: game.rung, round: game.round, fighters: game.fighters.map(nameOf), moves: {}, dealt: [0, 0], doing: [{}, {}], t0: t };
    if (s === 'ko' && cur) {
      cur.result = game.koText + ' ' + (game.winner < 0 ? 'draw' : cur.fighters[game.winner]);
      cur.secs = Math.round((t - cur.t0) / 60);
      cur.hp = game.fighters.map((f) => f.hp);
      rounds.push(cur);
      cur = null;
    }
    if (s === 'over') fights.push({ rung: game.rung, vs: game.fighters.map(nameOf).join('-'), won: game.won, wins: game.wins.join(':') });
    if (s === 'ending') { ladders++; game.endEnding(); }
    prevState = s;
  }
  if (s === 'fight' && cur) {
    game.fighters.forEach((f, i) => {
      if (f.brain && t % 10 === 0) cur.doing[i][f.brain.doing] = (cur.doing[i][f.brain.doing] ?? 0) + 1;
    });
    if (SHOTS && t % 300 === 0) await shot(`vs-${String(shotN++).padStart(3, '0')}`);
  }
}
return { rounds, fights };
