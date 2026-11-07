// Two-wheel physics: lean-driven turning, weight transfer, a tire friction budget, and a 6-speed gearbox.
(function (root) {
  const CL = root.CL || (root.CL = {});
  const T = CL.Track || (typeof require !== 'undefined' ? require('./track.js') : null);
  const G = 9.81, MASS = 265, WHEELBASE = 1.42, CG_H = 0.62, WHEEL_R = 0.31;
  const MAX_LEAN = (52 * Math.PI) / 180, IDLE = 1600, REDLINE = 13500;
  const RATIOS = [2.62, 2.0, 1.65, 1.4, 1.22, 1.1], DRIVE = 1.6 * 2.6;
  const TORQUE = [[0, 42], [3000, 58], [6000, 82], [9000, 104], [11000, 116], [12800, 106], [13500, 88], [15000, 40]];
  const ASSISTS = {
    full: { ff: 1, steer: 0.5, correct: 1.25, abs: true, tc: true, xp: 1 },
    light: { ff: 0.65, steer: 0.8, correct: 0.35, abs: true, tc: true, xp: 1.25 },
    off: { ff: 0, steer: 1, correct: 0, abs: false, tc: false, xp: 1.6 },
  };

  function torqueAt(rpm) {
    for (let i = 1; i < TORQUE.length; i++) {
      if (rpm <= TORQUE[i][0]) {
        const a = TORQUE[i - 1], b = TORQUE[i], u = (rpm - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * u;
      }
    }
    return 30;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  function createBike(track, startS, startD) {
    const p = T.worldAt(track, startS || 0, startD === undefined ? 1.8 : startD);
    return {
      x: p.x, y: p.y, z: p.z, h: p.h, v: 0, phi: 0, phiRate: 0, rpm: IDLE, gear: 1, shiftT: 0, shiftCool: 0,
      s: startS || 0, d: startD === undefined ? 1.8 : startD, load: 0.5, comp: 0, compV: 0, slipF: 0, slipR: 0, wobble: 0,
      crashed: false, crashT: 0, crashSide: 1, crashes: 0, limiter: 0, limitT: 0, usageF: 0, usageR: 0, ax: 0, grade: 0,
      offRoad: false, scrape: 0, yaw: 0, wheelie: 0, events: [],
    };
  }

  function shift(b, dir) {
    const next = b.gear + dir;
    if (next < 1 || next > 6 || b.shiftT > 0) return false;
    b.gear = next; b.shiftT = 0.09; b.shiftCool = 0.45;
    b.events.push({ type: 'shift', dir });
    return true;
  }

  function startCrash(b, cause) {
    b.crashed = true; b.crashT = 0; b.crashes++;
    b.crashSide = b.phi >= 0 ? 1 : -1;
    b.phiRate = 0; b.slipF = b.slipR = 0;
    b.events.push({ type: 'crash', cause });
  }

  function respawn(b, track) {
    const s = clamp(b.s, 0, track.finish - 5), p = T.worldAt(track, s, 1.8);
    Object.assign(b, { x: p.x, z: p.z, y: p.y, h: p.h, d: 1.8, s, v: 9, phi: 0, phiRate: 0, gear: 1, rpm: 3500, crashed: false, crashT: 0, comp: 0, compV: 0, load: 0.5, wobble: 0, usageF: 0, usageR: 0, ax: 0 });
    b.events.push({ type: 'respawn' });
  }

  function stepCrash(b, track, dt) {
    b.crashT += dt;
    b.v = Math.max(0, b.v - 7.5 * dt);
    b.phi += (b.crashSide * 1.45 - b.phi) * Math.min(1, 7 * dt);
    b.x += Math.sin(b.h) * b.v * dt; b.z -= Math.cos(b.h) * b.v * dt;
    const pr = T.project(track, b.x, b.z, b.s);
    b.s = pr.s; b.d = pr.d;
    const road = T.sample(track, b.s);
    b.y = road.y; b.grade = road.grade; b.rpm += (IDLE - b.rpm) * Math.min(1, 3 * dt);
    if (b.crashT > 2.3) respawn(b, track);
  }

  // inp: lean -1..1, throttle/front/rear 0..1, up/down one-shot gear requests.
  // tune: upgrade multipliers. opts: { assist: 'full'|'light'|'off', autoShift: bool }.
  function step(b, inp, track, dt, tune, opts) {
    if (b.crashed) return stepCrash(b, track, dt);
    const a = ASSISTS[opts.assist] || ASSISTS.full;
    if (inp.up) shift(b, 1);
    if (inp.down) shift(b, -1);
    b.shiftT = Math.max(0, b.shiftT - dt); b.shiftCool = Math.max(0, b.shiftCool - dt);
    if (opts.autoShift && b.shiftCool <= 0 && b.shiftT <= 0) {
      if (b.rpm > 12900 && b.gear < 6) shift(b, 1);
      else if (b.gear > 1 && b.v / WHEEL_R * RATIOS[b.gear - 2] * DRIVE * 9.549 < 11200 && (b.rpm < 7000 || inp.front + inp.rear > 0.2)) shift(b, -1);
    }

    // Lean: the rider asks for a roll angle, and the bike's gyroscopic inertia resists it at speed.
    const road = T.sample(track, b.s), ahead = T.sample(track, b.s + Math.max(6, b.v * 0.4));
    const sp = Math.max(b.v, 0.1);
    let target = inp.lean * MAX_LEAN * a.steer;
    target += Math.atan((sp * sp * ahead.k) / G) * a.ff;
    if (a.correct) {
      // Aim back at the lane, unless the rider is steering somewhere on purpose.
      const free = Math.abs(inp.lean) > 0.05 ? 0 : 1;
      const toLane = clamp(((1.8 - b.d) / (sp * 0.9 + 9)) * free, -0.3, 0.3);
      target += clamp(angleDiff(ahead.h + toLane, b.h) * Math.min(3, sp / 9), -0.5, 0.5) * a.correct;
    }
    if (a.abs) { const safe = Math.atan(1.24 * tune.grip * (Math.abs(b.d) > track.halfRoad - 0.3 ? 0.72 : 0.93)); target = clamp(target, -safe, safe); }
    target = clamp(target, -MAX_LEAN, MAX_LEAN) * clamp(sp / 5, 0.1, 1);
    const w = (5.6 - 2.9 * Math.min(1, sp / 75)) * tune.lean;
    b.phiRate += (w * w * (target - b.phi) - 2 * 0.92 * w * b.phiRate) * dt;
    b.phi = clamp(b.phi + b.phiRate * dt, -MAX_LEAN, MAX_LEAN);

    const yaw = clamp((G * Math.tan(b.phi)) / Math.max(sp, 3.5), -sp / 4.5, sp / 4.5);
    const aLat = sp * yaw;

    // Engine and gearbox.
    const total = RATIOS[b.gear - 1] * DRIVE;
    let wheelRpm = (b.v / WHEEL_R) * total * 9.549;
    if (b.gear === 1) wheelRpm = Math.max(wheelRpm, 2600 + inp.throttle * 5200 * clamp(1 - b.v / 14, 0, 1));
    let rpm = Math.max(IDLE, wheelRpm);
    let throttle = inp.throttle;
    b.limitT -= dt;
    if (rpm >= REDLINE) {
      throttle = 0;
      b.limiter = 1; rpm = REDLINE + Math.sin(performance_now(b) * 90) * 170;
      if (b.limitT <= 0) { b.limitT = 0.5; b.events.push({ type: 'limiter' }); }
    } else b.limiter = 0;
    b.rpm += (rpm - b.rpm) * Math.min(1, 18 * dt);
    let drive = b.shiftT > 0 ? 0 : (torqueAt(b.rpm) * tune.power * total * throttle) / WHEEL_R / MASS;
    const engineBrake = throttle < 0.05 && b.v > 2 && inp.front < 0.3 ? (b.rpm / REDLINE) * 2.4 : 0;

    // Tires share a limited friction budget between turning, braking and driving.
    const surface = Math.abs(b.d) > track.halfRoad ? 0.8 : 1;
    b.offRoad = surface < 1;
    const mu = 1.24 * tune.grip * surface;
    const load = b.load, capF = mu * G * Math.max(0.04, load), capR = mu * G * Math.max(0.04, 1 - load);
    // Past about 1.1 g the rear wheel lifts, so that is the real limit of hard braking.
    let brakeF = Math.min(inp.front * 1.42 * G, 10.4) * tune.brake, brakeR = inp.rear * 0.62 * G;
    const latF = Math.abs(aLat) * load, latR = Math.abs(aLat) * (1 - load);
    if (a.abs) {
      brakeF = Math.min(brakeF, Math.sqrt(Math.max(0, capF * capF * 0.94 - latF * latF)));
      brakeR = Math.min(brakeR, Math.sqrt(Math.max(0, capR * capR * 0.94 - latR * latR)));
    }
    if (a.tc) drive = Math.min(drive, Math.sqrt(Math.max(0, capR * capR * 0.95 - latR * latR)) * Math.max(0, 1 - brakeR / capR));
    const rearX = Math.abs(drive - brakeR);
    b.usageF = Math.hypot(brakeF, latF) / capF;
    b.usageR = Math.hypot(rearX, latR) / capR;
    if (b.usageF > 1) brakeF = Math.min(brakeF, capF * 0.78); // a locked front tire brakes less
    if (b.usageR > 1) { brakeR = Math.min(brakeR, capR * 0.7); drive = Math.min(drive, capR * 0.7); }
    b.slipF = b.usageF > 1 ? b.slipF + (b.usageF - 0.8) * dt * 3.4 : Math.max(0, b.slipF - dt * 2.2);
    // Spinning the rear upright is harmless. It only gets dangerous while leaned over.
    b.slipR = b.usageR > 1 && Math.abs(b.phi) > 0.2 ? b.slipR + (b.usageR - 0.85) * dt * 1.6 : Math.max(0, b.slipR - dt * 1.5);
    b.wobble = Math.min(1, b.slipR * 1.4 + b.slipF * 0.8);
    if (b.slipF > 0.34) return startCrash(b, 'lowside');
    if (b.slipR > 1.05) return startCrash(b, 'rearslide');

    // Longitudinal motion and weight transfer. Load is lagged by the suspension.
    if (load < 0.06) drive *= 0.4; // front wheel in the air: wheelie control
    const drag = (0.5 * 1.2 * 0.46 * b.v * b.v) / MASS + 0.22 + (surface < 1 ? 3.4 : 0);
    const ax = drive - brakeF - brakeR - engineBrake - drag - G * road.grade;
    b.ax = ax;
    const targetLoad = clamp(0.5 - (ax * CG_H) / (G * WHEELBASE), 0, 1);
    b.load += (targetLoad - b.load) * Math.min(1, 9 * dt);
    b.wheelie = Math.max(0, (0.08 - b.load) * 5);
    b.compV += ((clamp(-ax / 13, -0.75, 1) - b.comp) * 110 - b.compV * 14) * dt;
    b.comp += b.compV * dt;
    b.v = Math.max(0, b.v + ax * dt);
    b.yaw = yaw;

    const wob = b.wobble ? Math.sin(b.s * 0.9) * b.wobble * 0.5 : 0;
    b.h += (yaw + wob) * dt;
    b.x += Math.sin(b.h) * b.v * dt;
    b.z -= Math.cos(b.h) * b.v * dt;
    const pr = T.project(track, b.x, b.z, b.s);
    b.s = pr.s; b.d = pr.d;
    const here = T.sample(track, b.s);
    b.y = here.y; b.grade = here.grade;

    // Guardrail on the sea side, rock wall on the mountain side.
    b.scrape = Math.max(0, b.scrape - dt);
    const hit = b.d < track.railLeft ? -1 : b.d > track.wallRight ? 1 : 0;
    if (hit) {
      const into = Math.sin(angleDiff(b.h, here.h)) * hit * b.v;
      if (into > 8.5) return startCrash(b, hit < 0 ? 'guardrail' : 'wall');
      const edge = hit < 0 ? track.railLeft : track.wallRight;
      b.x += Math.cos(here.h) * (edge - b.d); b.z += Math.sin(here.h) * (edge - b.d); b.d = edge;
      b.h -= angleDiff(b.h, here.h) * Math.min(1, 7 * dt);
      b.v *= 1 - 0.7 * dt;
      if (b.scrape <= 0) { b.scrape = 0.4; b.events.push({ type: 'scrape' }); }
    }
  }
  function performance_now(b) { return b.s * 0.15; }

  CL.Physics = { createBike, step, shift, respawn, startCrash, torqueAt, ASSISTS, RATIOS, DRIVE, WHEEL_R, MAX_LEAN, REDLINE };
  if (typeof module !== 'undefined') module.exports = CL.Physics;
})(typeof window !== 'undefined' ? window : globalThis);
