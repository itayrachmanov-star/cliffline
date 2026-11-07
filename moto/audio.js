// Engine, wind and tire sounds, all synthesized so nothing has to download.
(function () {
  const CL = window.CL;
  let ctx = null, master, eng1, eng2, engGain, engFilter, windGain, windFilter, tireGain, enabled = true;

  function noiseBuffer() {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function loopNoise(type, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { g, f };
  }
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
      eng1 = ctx.createOscillator(); eng1.type = 'sawtooth';
      eng2 = ctx.createOscillator(); eng2.type = 'square'; eng2.detune.value = 9;
      const g2 = ctx.createGain(); g2.gain.value = 0.42;
      engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.Q.value = 2.4; engFilter.frequency.value = 800;
      engGain = ctx.createGain(); engGain.gain.value = 0;
      eng1.connect(engFilter); eng2.connect(g2); g2.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
      eng1.start(); eng2.start();
      const w = loopNoise('bandpass', 700, 0.6); windGain = w.g; windFilter = w.f;
      tireGain = loopNoise('bandpass', 2300, 5).g;
    } catch (e) { ctx = null; }
  }
  function blip(freq, dur, type, vol, to) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
  }
  function update(b, throttle, active) {
    if (!ctx) return;
    const t = ctx.currentTime, on = active && enabled;
    const f = (b.rpm / 60) * 2;
    eng1.frequency.setTargetAtTime(f, t, 0.012);
    eng2.frequency.setTargetAtTime(f / 2, t, 0.012);
    engFilter.frequency.setTargetAtTime(500 + throttle * 2400 + b.rpm * 0.14, t, 0.03);
    const cut = b.limiter || b.shiftT > 0 ? 0.25 : 1;
    engGain.gain.setTargetAtTime(on && !b.crashed ? (0.05 + throttle * 0.1) * cut : 0, t, 0.02);
    const kmh = b.v * 3.6;
    windGain.gain.setTargetAtTime(on ? Math.min(0.42, Math.pow(kmh / 280, 2) * 0.42) : 0, t, 0.1);
    windFilter.frequency.setTargetAtTime(400 + kmh * 6, t, 0.1);
    const scrub = Math.max(0, Math.max(b.usageF, b.usageR) - 0.92) * 1.2 + (b.crashed && b.v > 2 ? 0.25 : 0);
    tireGain.gain.setTargetAtTime(on ? Math.min(0.32, scrub) : 0, t, 0.03);
  }
  const sfx = {
    shift: () => blip(150, 0.07, 'square', 0.1, 70),
    crash: () => { blip(160, 0.6, 'sawtooth', 0.3, 40); blip(900, 0.35, 'square', 0.1, 120); },
    scrape: () => blip(1700, 0.2, 'sawtooth', 0.1, 900),
    beep: () => blip(660, 0.14, 'square', 0.1),
    go: () => blip(1320, 0.35, 'square', 0.12),
    sector: () => blip(880, 0.16, 'triangle', 0.2, 1100),
    miss: () => blip(800, 0.25, 'sawtooth', 0.07, 280),
    finish: () => [0, 130, 260].forEach((d, i) => setTimeout(() => blip([660, 880, 1100][i], 0.3, 'triangle', 0.2), d)),
  };
  CL.Audio = { init, update, sfx, setEnabled(v) { enabled = v; if (!v && ctx) update({ rpm: 1500, v: 0, usageF: 0, usageR: 0 }, 0, false); } };
})();
