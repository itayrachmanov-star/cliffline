// Cars in lanes, moving both ways along the road. Logic is separate from drawing so it can be tested.
(function (root) {
  const CL = root.CL || (root.CL = {});
  const LANE = 1.9;
  const SPACING = { low: 340, medium: 170 };

  function spawn(track, density, seed) {
    const r = (CL.Track || require('./track.js')).rng(seed + 31), gap = SPACING[density];
    const cars = [];
    if (!gap) return cars;
    for (let s = 240; s < track.finish - 60; s += gap * (0.7 + r() * 0.6)) {
      const same = r() < 0.5;
      cars.push({ s, dir: same ? 1 : -1, d: same ? LANE : -LANE, v: same ? 17 + r() * 8 : 18 + r() * 9, color: Math.floor(r() * 6), kind: r() < 0.25 ? 'van' : 'car', passed: false });
    }
    return cars;
  }

  // Keeps following cars behind slower ones, and returns contact or near-miss events.
  function step(track, cars, bike, dt) {
    const events = [];
    for (const c of cars) {
      let v = c.v;
      for (const o of cars) {
        if (o === c || o.dir !== c.dir) continue;
        const gap = (o.s - c.s) * c.dir;
        if (gap > 0 && gap < 26) v = Math.min(v, o.v * 0.92);
      }
      c.cur = v;
      c.s += c.dir * v * dt;
      if (c.s < 4) { c.s = track.finish - 20; c.passed = false; } else if (c.s > track.finish - 4) { c.s = 20; c.passed = false; }
      if (bike.crashed) continue;
      const ds = c.s - bike.s, dd = bike.d - c.d, halfLen = c.kind === 'van' ? 3 : 2.5;
      if (Math.abs(ds) < halfLen + 0.8 && Math.abs(dd) < 1.15) { events.push({ type: 'carHit', car: c }); continue; }
      if (!c.passed && ds < -halfLen) {
        c.passed = true;
        if (Math.abs(dd) < 2.2) events.push({ type: 'nearMiss', car: c, oncoming: c.dir < 0 });
      }
      if (ds > 40) c.passed = false;
    }
    return events;
  }

  CL.Traffic = { spawn, step, LANE };
  if (typeof module !== 'undefined') module.exports = CL.Traffic;
})(typeof window !== 'undefined' ? window : globalThis);
