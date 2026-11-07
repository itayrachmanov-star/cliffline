// Procedural coastal road: a centerline with heading, curvature and elevation. No drawing code here.
// Heading h: forward = (sin h, 0, -cos h), right = (cos h, 0, sin h). Positive d is right of center.
// The sea is always on the left of the road, the mountain on the right.
(function (root) {
  const CL = root.CL || (root.CL = {});
  const STEP = 4, G = 9.81, LEAN_FOR_PAR = (46 * Math.PI) / 180;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function curvatureProfile(def, r, n) {
    const K = new Float32Array(n);
    let i = Math.floor(60 / STEP), heading = 0, target = 0, side = r() < 0.5 ? 1 : -1;
    while (i < n) {
      let len;
      if (r() < def.straights) {
        target = 0;
        len = 70 + r() * 200;
      } else {
        const rad = def.rMin + Math.pow(r(), 1.4) * (def.rMax - def.rMin);
        const sweep = (0.5 + r() * 1.5);
        // Steer back toward the main direction, so the road never loops over itself.
        if (heading > 0.9) side = -1;
        else if (heading < -0.9) side = 1;
        else side = r() < 0.75 ? -side : side;
        target = side / rad;
        len = Math.max(45, sweep * rad);
        const maxTurn = 1.45 - side * heading;
        if (len / rad > maxTurn) len = Math.max(30, maxTurn * rad);
      }
      const end = Math.min(n, i + Math.ceil(len / STEP));
      for (; i < end; i++) {
        const prev = i > 0 ? K[i - 1] : 0;
        K[i] = prev + (target - prev) * Math.min(1, STEP / 32);
        heading += K[i] * STEP;
      }
    }
    return K;
  }

  function buildTrack(def) {
    const r = rng(def.seed), n = Math.ceil(def.length / STEP) + 1;
    const K = curvatureProfile(def, r, n);
    const X = new Float32Array(n), Z = new Float32Array(n), H = new Float32Array(n), Y = new Float32Array(n);
    const p1 = r() * 6.28, p2 = r() * 6.28, p3 = r() * 6.28;
    for (let i = 1; i < n; i++) {
      H[i] = H[i - 1] + K[i - 1] * STEP;
      X[i] = X[i - 1] + Math.sin(H[i]) * STEP;
      Z[i] = Z[i - 1] - Math.cos(H[i]) * STEP;
    }
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      Y[i] = 62 + 24 * Math.sin(s / 410 + p1) + 9 * Math.sin(s / 170 + p2) + 2.5 * Math.sin(s / 71 + p3);
    }
    const track = { def, n, step: STEP, length: (n - 1) * STEP, K, X, Z, H, Y, halfRoad: 4.6, railLeft: -5.5, wallRight: 6.6 };
    track.sectors = [];
    const count = def.sectors || 3;
    for (let i = 1; i <= count; i++) track.sectors.push((track.length - 20) * (i / count));
    track.finish = track.length - 20;
    computeIdeal(track);
    return track;
  }

  // Fastest sensible speed at every point: limited by corners, braking and acceleration.
  function computeIdeal(t) {
    const V = new Float32Array(t.n), top = 78, brake = 8, step = t.step;
    for (let i = 0; i < t.n; i++) {
      const k = Math.abs(t.K[i]);
      V[i] = k > 1e-4 ? Math.min(top, Math.sqrt((G * Math.tan(LEAN_FOR_PAR)) / k)) : top;
    }
    for (let i = t.n - 2; i >= 0; i--) V[i] = Math.min(V[i], Math.sqrt(V[i + 1] * V[i + 1] + 2 * brake * step));
    V[0] = 0;
    let time = 0;
    for (let i = 1; i < t.n; i++) {
      const a = Math.min(8.5, 300 / Math.max(V[i - 1], 1));
      V[i] = Math.min(V[i], Math.sqrt(V[i - 1] * V[i - 1] + 2 * a * step));
      time += step / Math.max(1.5, (V[i] + V[i - 1]) / 2);
    }
    t.ideal = V;
    t.idealTime = time;
  }

  function sample(t, s) {
    const f = Math.max(0, Math.min(t.n - 1.001, s / t.step)), i = Math.floor(f), u = f - i;
    return {
      x: t.X[i] + (t.X[i + 1] - t.X[i]) * u,
      z: t.Z[i] + (t.Z[i + 1] - t.Z[i]) * u,
      y: t.Y[i] + (t.Y[i + 1] - t.Y[i]) * u,
      h: t.H[i] + (t.H[i + 1] - t.H[i]) * u,
      k: t.K[i] + (t.K[i + 1] - t.K[i]) * u,
      grade: (t.Y[i + 1] - t.Y[i]) / t.step,
      ideal: t.ideal[i] + (t.ideal[i + 1] - t.ideal[i]) * u,
    };
  }

  function worldAt(t, s, d) {
    const p = sample(t, s);
    p.x += Math.cos(p.h) * d;
    p.z += Math.sin(p.h) * d;
    return p;
  }

  // Finds the road position nearest a world point, searching around the last known position.
  function project(t, x, z, hint) {
    const c = Math.round(hint / t.step), from = Math.max(0, c - 8), to = Math.min(t.n - 1, c + 12);
    let best = from, bd = Infinity;
    for (let i = from; i <= to; i++) {
      const dx = x - t.X[i], dz = z - t.Z[i], e = dx * dx + dz * dz;
      if (e < bd) { bd = e; best = i; }
    }
    const h = t.H[best], dx = x - t.X[best], dz = z - t.Z[best];
    const along = dx * Math.sin(h) - dz * Math.cos(h), d = dx * Math.cos(h) + dz * Math.sin(h);
    return { s: Math.max(0, Math.min(t.length, best * t.step + along)), d };
  }

  CL.Track = { rng, buildTrack, sample, worldAt, project, STEP };
  if (typeof module !== 'undefined') module.exports = CL.Track;
})(typeof window !== 'undefined' ? window : globalThis);
