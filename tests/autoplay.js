// shared autoplayer for tests: fights the nearest hostile enemy, otherwise paths right
window.autoplay = (() => {
  const keys = { KeyA: false, KeyD: false, KeyW: false, KeyS: false, KeyJ: false, KeyK: false };
  const set = (k, v) => { if (keys[k] !== v) { keys[k] = v; K(k, v); } };
  const path = (s, h) => {
    const c0 = (h.x - 0x1000) >> 3, r0 = (h.z - 0xf80) >> 3, maxc = ((-s.camx + 300) >> 3);
    const hg = (c, r) => (c < 0 || c > 255 || r < 0 || r > 63) ? 0 : s.height[c * 64 + r];
    const key = (c, r) => c * 64 + r, prev = new Map([[key(c0, r0), -1]]), q = [[c0, r0]];
    let best = null, bestc = c0;
    for (let i = 0; i < q.length && i < 6000; i++) {
      const [c, r] = q[i];
      if (c > bestc) { bestc = c; best = key(c, r); }
      for (const [dc, dr] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) {
        const nc = c + dc, nr = r + dr, nh = hg(nc, nr);
        if (nc > maxc || nh <= 0x20 || nh >= 0xd0 || hg(c, r) - nh > 8 || prev.has(key(nc, nr))) continue;
        prev.set(key(nc, nr), key(c, r)); q.push([nc, nr]);
      }
    }
    if (best === null) return null;
    let k = best;
    while (prev.get(k) !== -1 && prev.get(prev.get(k)) !== -1) k = prev.get(k);
    const nc = Math.floor(k / 64), nr = k % 64;
    return [nc - c0, nr - r0, hg(c0, r0) - hg(nc, nr) > 1];
  };
  return (t) => {
    const s = game.stage, h = game.heroes[0];
    if (!s || game.state !== 'play') return;
    const es = s.actors.filter(a => a.isEnemy && a.hostile && !a.dead && a.vulnerable);
    let e = null, bd = 1e9;
    for (const a of es) { const d = Math.abs(a.x - h.x) + 2 * Math.abs(a.z - h.z); if (d < bd) { bd = d; e = a; } }
    let L = false, R = false, U = false, D = false, A = false;
    if (e && bd < 400) {
      const dx = e.x - h.x, dz = e.z - h.z;
      if (dz > 3) D = true; else if (dz < -3) U = true;
      if (dx > 36) R = true; else if (dx < -36) L = true;
      else if (Math.abs(dx) < 14) { if (dx > 0) L = true; else R = true; }
      if (Math.abs(dz) <= 6 && Math.abs(dx) <= 46) { if ((dx > 0) !== (h.facing > 0)) { if (dx > 0) R = true; else L = true; } A = t % 10 < 3; }
    } else {
      const p = t % 20 === 0 ? (window._p = path(s, h)) : window._p;
      if (p) { R = p[0] > 0; L = p[0] < 0; D = p[1] > 0; U = p[1] < 0; window._jump = p[2]; } else R = true;
      // the path is cell by cell but the hero is wider: if stuck, sidestep for a moment
      const moved = Math.abs(h.x - (window._lx ?? 0)) + Math.abs(h.z - (window._lz ?? 0)) > 0.5;
      window._lx = h.x; window._lz = h.z;
      window._still = moved ? 0 : (window._still ?? 0) + 1;
      if (window._still > 30) {
        // stuck: alternate sidestepping with jumping forward (ledges and stairs need a jump)
        const k = Math.floor(window._still / 40) % 3;
        if (k === 2) { R = true; window._jump = true; } else { D = k === 0; U = k === 1; }
      }
    }
    set('KeyA', L); set('KeyD', R); set('KeyW', U); set('KeyS', D); set('KeyJ', A);
    set('KeyK', !e && window._jump && t % 30 < 3);
  };
})();
