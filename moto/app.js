// Main loop: rendering pipeline, touch input, ride flow and HUD.
(function () {
  const CL = window.CL, T = CL.Track, Ph = CL.Physics, C = CL.Career, W = CL.World, $ = (id) => document.getElementById(id);
  const DT = 1 / 120, calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const QUALITY = [
    { pr: 1.6, far: 1000, mirror: 2, msaa: true },
    { pr: 1.25, far: 850, mirror: 3, msaa: true },
    { pr: 1, far: 700, mirror: 4, msaa: false },
    { pr: 0.8, far: 560, mirror: 0, msaa: false },
  ];

  let career = C.Store.loadLocal();
  let renderer, camera, mirrorCam, rt, mirrorRT, comp, cockpit, world = null, track = null, bike = null;
  let qLevel = 0, frameN = 0, fpsT = 0, fpsN = 0, fps = 60, lowStreak = 0;
  let mode = 'menu', stage = null, runT = 0, countdown = 0, paused = false, cars = [], carMeshes = [];
  let acc = 0, lastT = 0, time = 0, run = null, sectorI = 0, sectorStart = 0, sectorTimes = [], bestSectors = null, ideal = 0;
  let hudTick = 0, toastT = 0, hintStage = 0, fade = 0, lastKmh = -1;
  const inp = { lean: 0, throttle: 0, front: 0, rear: 0, up: false, down: false };
  const raw = { lean: 0 }, keys = {};

  // ---- Renderer and post-processing ----
  const COMP_FRAG = `
    varying vec2 vUv; uniform sampler2D tex; uniform float blur; uniform vec2 sunUv; uniform float sunVis; uniform float dip;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
    void main(){
      vec2 c=vec2(0.5,0.56), d=vUv-c; float r=length(d);
      vec3 col=texture2D(tex,vUv).rgb;
      if(blur>0.001){ float a=blur*smoothstep(0.12,0.72,r);
        for(int i=1;i<6;i++){ col+=texture2D(tex,vUv-d*a*float(i)*0.028).rgb; }
        col/=6.0; }
      float sd=distance(vec2(vUv.x*1.78,vUv.y),vec2(sunUv.x*1.78,sunUv.y));
      col+=vec3(1.0,0.62,0.32)*sunVis*(0.26*exp(-sd*5.0)+0.05*exp(-sd*1.6));
      col*=0.98;
      col=aces(col*1.02);
      float l=dot(col,vec3(0.3,0.59,0.11)); col=mix(vec3(l),col,1.1);
      col*=mix(vec3(0.98,0.98,1.05),vec3(1.05,1.0,0.94),smoothstep(0.1,0.8,l));
      col=pow(col,vec3(1.0/2.2));
      vec2 q=(vUv-0.5)*vec2(1.0,0.86); float v=smoothstep(0.42,0.82,length(q));
      col*=1.0-v*0.72;
      col*=1.0-dip;
      gl_FragColor=vec4(col,1.0);
    }`;

  // Phones differ in what they can render to. Test the real GPU first, because a bad choice means a black screen.
  let rtSupport = null;
  function probeRT() {
    if (rtSupport) return rtSupport;
    rtSupport = { hdr: false, msaa: false };
    const gl = renderer.getContext();
    if (!renderer.capabilities.isWebGL2) return rtSupport;
    const fb = gl.createFramebuffer(), rb = gl.createRenderbuffer();
    const ok = (fn) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      fn();
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      const good = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      return good;
    };
    const canFloat = renderer.extensions.get('EXT_color_buffer_float') || renderer.extensions.get('EXT_color_buffer_half_float');
    rtSupport.hdr = !!canFloat && ok(() => gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA16F, 8, 8));
    const fmt = rtSupport.hdr ? gl.RGBA16F : gl.RGBA8;
    rtSupport.msaa = ok(() => gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, fmt, 8, 8));
    gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(rb);
    return rtSupport;
  }
  function makeRT(w, h) {
    const sup = probeRT();
    const opts = { type: sup.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
    if (sup.msaa && QUALITY[qLevel].msaa && THREE.WebGLMultisampleRenderTarget) {
      const m = new THREE.WebGLMultisampleRenderTarget(w, h, opts); m.samples = 4; return m;
    }
    return new THREE.WebGLRenderTarget(w, h, opts);
  }

  function initRenderer() {
    const cv = $('game');
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause(); });
    cv.addEventListener('webglcontextrestored', () => location.reload());
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.autoClear = false;
    camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.25, 12000);
    camera.rotation.order = 'YXZ';
    mirrorCam = new THREE.PerspectiveCamera(30, 2, 1, 12000);
    mirrorCam.rotation.order = 'YXZ';
    mirrorRT = new THREE.WebGLRenderTarget(320, 160, { minFilter: THREE.LinearFilter });
    mirrorRT.texture.wrapS = THREE.RepeatWrapping; mirrorRT.texture.repeat.x = -1;
    comp = {
      scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      u: { tex: { value: null }, blur: { value: 0 }, sunUv: { value: new THREE.Vector2() }, sunVis: { value: 0 }, dip: { value: 0 } },
    };
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const m = new THREE.Mesh(tri, new THREE.ShaderMaterial({
      uniforms: comp.u, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0);}',
      fragmentShader: COMP_FRAG,
    }));
    m.frustumCulled = false; comp.scene.add(m);
    cockpit = CL.Cockpit.build(mirrorRT.texture, liveryColor());
    resize();
    window.addEventListener('resize', resize);
  }
  const liveryColor = () => (C.LIVERIES.find((l) => l.id === career.settings.livery) || C.LIVERIES[0]).color;

  function resize() {
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight), pr = Math.min(devicePixelRatio || 1, QUALITY[qLevel].pr);
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
    camera.aspect = cockpit.camera.aspect = w / h;
    camera.updateProjectionMatrix(); cockpit.camera.updateProjectionMatrix();
    if (rt) rt.dispose();
    rt = makeRT(Math.floor(w * pr), Math.floor(h * pr));
    comp.u.tex.value = rt.texture;
    const portrait = h > w;
    $('rotate').hidden = !portrait;
  }

  // ---- Cars ----
  const CAR_COLORS = ['#e9e4d8', '#2c3e50', '#8e2b25', '#1f1f22', '#7d8b8f', '#c2a14d'].map((c) => W.srgb(c));
  let carGeo = null;
  function makeCar(c) {
    if (!carGeo) carGeo = { body: new THREE.BoxGeometry(1.82, 0.62, 4.3), van: new THREE.BoxGeometry(1.95, 1.75, 5.2), cabin: new THREE.BoxGeometry(1.6, 0.58, 2.1), wheel: new THREE.CylinderGeometry(0.33, 0.33, 0.26, 10), light: new THREE.BoxGeometry(0.4, 0.14, 0.06) };
    const g = new THREE.Group(), paint = new THREE.MeshPhongMaterial({ color: CAR_COLORS[c.color], shininess: 90, specular: 0x9a7a5a });
    const van = c.kind === 'van';
    const body = new THREE.Mesh(van ? carGeo.van : carGeo.body, paint); body.position.y = van ? 1.2 : 0.62; g.add(body);
    if (!van) {
      const cab = new THREE.Mesh(carGeo.cabin, new THREE.MeshPhongMaterial({ color: 0x151518, shininess: 140, specular: 0xffc58a })); cab.position.set(0, 1.2, 0.15); g.add(cab);
    } else {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.6, 0.1), new THREE.MeshPhongMaterial({ color: 0x151518, shininess: 140 })); glass.position.set(0, 1.55, -2.58); g.add(glass);
    }
    const wheel = new THREE.MeshLambertMaterial({ color: 0x0f0f10 });
    [[-0.93, 1.35], [0.93, 1.35], [-0.93, -1.35], [0.93, -1.35]].forEach(([x, z]) => { const w = new THREE.Mesh(carGeo.wheel, wheel); w.rotation.z = Math.PI / 2; w.position.set(x, 0.33, z); g.add(w); });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.25, 0.12) }), head = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.3, 3) });
    const z = van ? 2.62 : 2.17;
    [-0.62, 0.62].forEach((x) => {
      const t = new THREE.Mesh(carGeo.light, tail); t.position.set(x, 0.74, z); g.add(t);
      const h = new THREE.Mesh(carGeo.light, head); h.position.set(x, 0.7, -z); g.add(h);
    });
    g.visible = false;
    return g;
  }
  function clearCars() { carMeshes.forEach((m) => world && world.scene.remove(m)); carMeshes = []; }
  function layoutCars() {
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], g = carMeshes[i], gap = Math.abs(c.s - bike.s);
      g.visible = gap < QUALITY[qLevel].far * 0.7;
      if (!g.visible) continue;
      const p = T.worldAt(track, c.s, c.d);
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = -p.h + (c.dir < 0 ? Math.PI : 0);
    }
  }

  // ---- Loading a road ----
  function loadStage(def) {
    if (world) { clearCars(); world.dispose(); }
    track = T.buildTrack(def);
    world = W.build(track, renderer);
    ideal = track.idealTime;
    bike = Ph.createBike(track);
    run = null;
  }
  const tuneNow = () => C.tuneOf(career);

  function startRide(def) {
    CL.Audio.init(); CL.Audio.setEnabled(career.settings.sound);
    stage = def;
    showOnly(null);
    $('loading').hidden = false;
    setTimeout(() => {
      loadStage(def);
      const density = career.settings.traffic;
      cars = CL.Traffic.spawn(track, density, def.seed);
      carMeshes = cars.map((c) => { const m = makeCar(c); world.scene.add(m); return m; });
      mode = 'count'; countdown = 3.4; runT = 0; sectorI = 0; sectorStart = 0; sectorTimes = []; paused = false; acc = 0; hintStage = career.totals.runs < 2 ? 1 : 0;
      const rec = career.stages[def.id];
      bestSectors = rec && rec.sectors ? rec.sectors : null;
      run = { stage: def.id, stageName: def.name, finished: false, time: 0, sectors: [], idealTime: ideal, meters: 0, crashes: 0, topKmh: 0, maxLean: 0, nearMisses: 0, shifts: 0, seconds: 0, assist: career.settings.assist, traffic: density, daily: def.id === 'daily', dayKey: C.dayKey() };
      $('hudStage').textContent = def.name;
      $('hud').hidden = false; $('controls').hidden = false; $('loading').hidden = true;
      $('split').textContent = ''; $('timer').textContent = '0:00.00';
      setHint(hintStage ? 'Hold THROTTLE with your right thumb when the lights go out' : '');
      requestWake();
    }, 30);
  }

  function endRide(finished) {
    mode = 'menu';
    run.finished = finished;
    run.time = runT; run.sectors = sectorTimes; run.meters = Math.round(Math.min(bike.s, track.length));
    const prevBest = bestSectors;
    const res = C.recordRun(career, run);
    C.Store.save(career);
    return { res, prevBest };
  }

  function finish() {
    const { res, prevBest } = endRide(true);
    CL.Audio.sfx.finish(); CL.Audio.update(bike, 0, false);
    CL.UI.result(run, res, C.medalTimes(ideal), prevBest);
    $('rNext').hidden = !(stage.id !== 'daily' && CL.UI.nextAvailable(stage));
    clearCues(); $('hud').hidden = true; $('controls').hidden = true; setHint('');
    showOnly('result');
    mode = 'attract'; bike = Ph.createBike(track); cars = []; clearCars();
  }

  function clearCues() { ['toast', 'brakeCue', 'tc', 'lights'].forEach((id) => ($(id).hidden = true)); toastT = 0; }

  function toMenu(attractStage) {
    clearCues();
    showOnly('menu');
    $('hud').hidden = true; $('controls').hidden = true; setHint('');
    CL.Audio.update(bike || { rpm: 0, v: 0, usageF: 0, usageR: 0 }, 0, false);
    if (mode === 'count' || mode === 'ride') { if (run && bike.s > 150) { endRide(false); } }
    if (!world || attractStage !== false) { loadStage(attractStage || C.STAGES[0]); }
    mode = 'attract'; paused = false; cars = []; bike = Ph.createBike(track);
    cockpit.setLivery(liveryColor());
    CL.UI.render();
  }

  function showOnly(id) { ['menu', 'result', 'pauseMenu'].forEach((s) => ($(s).hidden = s !== id)); }
  function setHint(t) { $('hint').textContent = t; $('hint').hidden = !t; }
  function toast(t, ms) { $('toast').textContent = t; $('toast').hidden = false; toastT = ms || 1.4; }

  // ---- Touch input ----
  function capture(el, e) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* the pointer already ended */ } }
  function bindControls() {
    const pad = $('leanPad'), knob = $('leanKnob');
    let padId = null;
    const setPad = (x) => {
      const r = pad.getBoundingClientRect();
      let v = ((x - r.left) / r.width) * 2 - 1;
      v = Math.max(-1, Math.min(1, v));
      raw.lean = Math.abs(v) < 0.04 ? 0 : v;
      knob.style.transform = 'translateX(' + raw.lean * (r.width / 2 - 26) + 'px)';
    };
    pad.addEventListener('pointerdown', (e) => { padId = e.pointerId; capture(pad, e); setPad(e.clientX); e.preventDefault(); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) setPad(e.clientX); });
    const padUp = (e) => { if (e.pointerId === padId) { padId = null; raw.lean = 0; knob.style.transform = ''; } };
    pad.addEventListener('pointerup', padUp); pad.addEventListener('pointercancel', padUp);

    // Rolling a thumb sideways moves it from throttle to brake, like a real hand on the controls.
    const panel = $('pedals'), cols = [...panel.querySelectorAll('.ped')];
    const held = new Map();
    const paintPedals = () => { cols.forEach((c) => c.querySelector('i').style.transform = 'scaleY(' + inp[c.dataset.ctl] + ')'); };
    const applyPedals = () => {
      inp.throttle = keys.throttle || 0; inp.front = keys.front || 0; inp.rear = keys.rear || 0;
      held.forEach((h) => { inp[h.ctl] = Math.max(inp[h.ctl], h.v); });
      paintPedals();
    };
    const movePed = (e) => {
      const rr = panel.getBoundingClientRect();
      let col = cols[0], best = 1e9;
      cols.forEach((c) => { const b = c.getBoundingClientRect(), dx = Math.abs(e.clientX - (b.left + b.width / 2)); if (dx < best) { best = dx; col = c; } });
      const b = col.getBoundingClientRect();
      const v = Math.max(0.25, Math.min(1, (b.bottom - e.clientY) / b.height));
      held.set(e.pointerId, { ctl: col.dataset.ctl, v: rr ? v : 0 });
      applyPedals();
    };
    panel.addEventListener('pointerdown', (e) => { capture(panel, e); movePed(e); e.preventDefault(); });
    panel.addEventListener('pointermove', (e) => { if (held.has(e.pointerId)) movePed(e); });
    const pedUp = (e) => { held.delete(e.pointerId); applyPedals(); };
    panel.addEventListener('pointerup', pedUp); panel.addEventListener('pointercancel', pedUp);
    CL._applyPedals = applyPedals;

    $('shiftUp').addEventListener('pointerdown', (e) => { inp.up = true; e.preventDefault(); });
    $('shiftDown').addEventListener('pointerdown', (e) => { inp.down = true; e.preventDefault(); });
    $('pauseBtn').onclick = pause;
    $('resumeBtn').onclick = () => { paused = false; lastT = performance.now(); $('hint').hidden = !$('hint').textContent; showOnly(null); $('controls').hidden = false; $('hud').hidden = false; };
    $('restartBtn').onclick = () => { endRide(false); startRide(stage); };
    $('quitBtn').onclick = () => { toMenu(C.STAGES[0]); };

    const map = { ArrowUp: 'throttle', ArrowDown: 'front', Space: 'rear' };
    window.addEventListener('keydown', (e) => {
      if (map[e.code]) { keys[map[e.code]] = 1; applyPedals(); e.preventDefault(); }
      if (e.code === 'ArrowLeft') keys.left = 1;
      if (e.code === 'ArrowRight') keys.right = 1;
      if (e.code === 'KeyE' && !e.repeat) inp.up = true;
      if (e.code === 'KeyQ' && !e.repeat) inp.down = true;
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.code]) { keys[map[e.code]] = 0; applyPedals(); }
      if (e.code === 'ArrowLeft') keys.left = 0;
      if (e.code === 'ArrowRight') keys.right = 0;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  }
  function pause() { if ((mode !== 'ride' && mode !== 'count') || paused) return; paused = true; CL.Audio.update(bike, 0, false); $('hint').hidden = true; showOnly('pauseMenu'); $('controls').hidden = true; }
  let wake = null;
  async function requestWake() { try { if (!wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => (wake = null)); } } catch (e) { wake = null; } }

  // ---- Simulation ----
  function attractInput() {
    const look = T.sample(track, bike.s + Math.max(4, bike.v * 0.5)), want = look.ideal * 0.82;
    return { lean: 0, throttle: bike.v < want ? 0.9 : 0, front: bike.v > want + 1 ? Math.min(1, (bike.v - want) / 6) : 0, rear: 0, up: false, down: false };
  }
  function simStep() {
    const riding = mode === 'ride';
    let input = inp;
    if (mode === 'attract') input = attractInput();
    else if (mode === 'count') input = { lean: 0, throttle: 0, front: 1, rear: 0 };
    if (mode !== 'attract') {
      const target = keys.left ? -1 : keys.right ? 1 : raw.lean;
      inp.lean += (target - inp.lean) * Math.min(1, DT * 14);
    }
    const opts = mode === 'attract' ? { assist: 'full', autoShift: true } : { assist: career.settings.assist, autoShift: career.settings.autoShift };
    if ((inp.up || inp.down) && riding) bike.shiftCool = 1.6;
    Ph.step(bike, input, track, DT, tuneNow(), opts);
    inp.up = inp.down = false;
    if (mode === 'attract' && bike.s >= track.finish - 5) bike = Ph.createBike(track);
    if (!riding) { bike.events.length = 0; return; }
    runT += DT; run.seconds += DT;
    const kmh = bike.v * 3.6, leanDeg = (Math.abs(bike.phi) * 180) / Math.PI;
    if (kmh > run.topKmh) run.topKmh = kmh;
    if (!bike.crashed && leanDeg > run.maxLean) run.maxLean = leanDeg;
    for (const e of bike.events) handleEvent(e);
    bike.events.length = 0;
    if (cars.length) for (const e of CL.Traffic.step(track, cars, bike, DT)) {
      if (e.type === 'carHit') Ph.startCrash(bike, 'car');
      else if (e.type === 'nearMiss') { run.nearMisses++; CL.Audio.sfx.miss(); toast('Near miss'); }
    }
    while (sectorI < track.sectors.length && bike.s >= track.sectors[sectorI]) {
      const t = runT - sectorStart; sectorTimes.push(t); sectorStart = runT;
      const b = bestSectors && bestSectors[sectorI], d = b ? t - b : null;
      sectorI++;
      if (sectorI < track.sectors.length) {
        CL.Audio.sfx.sector();
        const el = $('split');
        el.textContent = 'S' + sectorI + ' ' + CL.UI.fmtTime(t) + (d !== null ? ' ' + (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2) : '');
        el.className = d === null ? '' : d <= 0 ? 'up' : 'down';
      } else return finish();
    }
  }
  const CRASH_TIPS = {
    lowside: 'Low-side: you braked or accelerated too hard while leaned',
    rearslide: 'Rear tire let go: ease the throttle while leaned',
    guardrail: 'Hit the guardrail: brake earlier for tight corners',
    wall: 'Hit the rock wall: brake earlier for tight corners',
    car: 'Hit a car: stay in your lane through blind corners',
  };
  function handleEvent(e) {
    if (e.type === 'shift') { run.shifts++; CL.Audio.sfx.shift(); }
    else if (e.type === 'crash') { run.crashes++; CL.Audio.sfx.crash(); toast(CRASH_TIPS[e.cause] || 'Crashed', 2.4); }
    else if (e.type === 'scrape') CL.Audio.sfx.scrape();
    else if (e.type === 'respawn') fade = 1;
  }

  function hints() {
    if (!hintStage) return;
    if (hintStage === 1 && mode === 'ride' && bike.v > 8) { hintStage = 2; setHint('Slide your left thumb to lean through corners'); }
    if (hintStage === 2 && (Math.abs(inp.lean) > 0.1 || bike.s > 350)) { hintStage = 3; setHint('Roll your right thumb to BRAKE before yellow arrows'); }
    if (hintStage === 3 && bike.s > 800) { hintStage = 0; setHint(''); }
  }

  // ---- Frame ----
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
    lastT = now; time += dt; frameN++;
    if (!world) return;
    if (!paused && $('rotate').hidden) {
      if (mode === 'count') {
        const before = Math.ceil(countdown);
        countdown -= dt;
        const after = Math.ceil(countdown);
        if (after !== before && after > 0 && after <= 3) CL.Audio.sfx.beep();
        const show = countdown > 0 ? after : 0;
        $('lights').hidden = countdown <= 0;
        if (countdown > 0) $('lights').dataset.n = String(Math.min(3, show));
        if (countdown <= 0) { mode = 'ride'; CL.Audio.sfx.go(); }
      }
      acc += dt;
      let n = 0;
      while (acc >= DT && n++ < 8) { simStep(); acc -= DT; if (mode === 'attract' && !run) continue; }
      if (n >= 8) acc = 0;
      if (mode === 'ride' || mode === 'count') { CL.Audio.update(bike, inp.throttle, true); updateHud(dt); hints(); }
    }
    if (cars.length && carMeshes.length) layoutCars();
    draw(dt);
    trackFps(dt);
  }

  function updateHud(dt) {
    const kmh = bike.v * 3.6;
    $('rpmFill').style.transform = 'scaleX(' + Math.min(1, bike.rpm / 15000) + ')';
    $('rpmFill').classList.toggle('red', bike.rpm > 12800);
    hudTick -= dt;
    if (hudTick <= 0) {
      hudTick = 0.07;
      $('timer').textContent = CL.UI.fmtTime(runT);
      if (Math.round(kmh) !== lastKmh) { lastKmh = Math.round(kmh); $('speed').textContent = lastKmh; }
      $('gear').textContent = bike.gear;
      const look = T.sample(track, bike.s + Math.max(30, bike.v * 1.4));
      const need = career.settings.assist !== 'off' && !bike.crashed && bike.v > look.ideal + 5 + (career.settings.assist === 'light' ? 3 : 0);
      $('brakeCue').hidden = !need;
      $('tc').hidden = !(bike.v > 4 && (bike.wobble > 0.15 || bike.usageF > 0.96 || bike.usageR > 0.98));
      $('progress').style.transform = 'scaleX(' + Math.min(1, bike.s / track.finish) + ')';
    }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').hidden = true; }
  }

  const sunV = new THREE.Vector3();
  function draw(dt) {
    const b = bike, roll = b.phi * 0.5, kmh = b.v * 3.6;
    const vib = Math.max(0, kmh - 90) / 200, shakeAmt = calm ? 0 : vib * vib;
    const r = (x) => (Math.sin(time * x) + Math.sin(time * x * 1.7 + 1.3)) * 0.5;
    const cosH = Math.cos(b.h), sinH = Math.sin(b.h), side = Math.sin(b.phi) * 0.55;
    camera.position.set(b.x + cosH * side, b.y + 1.06 - Math.abs(b.phi) * 0.14 - (b.crashed ? Math.min(0.75, b.crashT) : 0) + r(61) * 0.006 * shakeAmt, b.z + sinH * side);
    camera.rotation.set(Math.atan(b.grade) * 0.85 - 0.015 - b.comp * 0.05 + r(47) * 0.004 * shakeAmt, -b.h - b.phi * 0.17 + r(53) * 0.003 * shakeAmt, -roll + r(71) * 0.003 * shakeAmt);
    camera.fov = 62 + Math.min(14, Math.max(0, kmh - 60) * 0.06);
    camera.updateProjectionMatrix();
    const q = QUALITY[qLevel];
    world.update(camera, b.s, time, q.far);

    if (q.mirror && frameN % q.mirror === 0) {
      mirrorCam.position.copy(camera.position);
      mirrorCam.rotation.set(0.02, -b.h + Math.PI, 0);
      world.update(camera, Math.max(0, b.s - 400), time, 500);
      renderer.setRenderTarget(mirrorRT); renderer.clear(); renderer.render(world.scene, mirrorCam);
      world.update(camera, b.s, time, q.far);
    }
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(world.scene, camera);

    sunV.copy(camera.position).addScaledVector(W.SUN_DIR, 1000).project(camera);
    comp.u.sunUv.value.set(sunV.x * 0.5 + 0.5, sunV.y * 0.5 + 0.5);
    comp.u.sunVis.value = sunV.z < 1 && Math.abs(sunV.x) < 1.6 && Math.abs(sunV.y) < 1.6 ? 1 : 0;
    comp.u.blur.value = calm ? 0 : Math.min(1, Math.max(0, (kmh - 150) / 130));
    if (fade > 0) fade = Math.max(0, fade - dt * 1.6);
    comp.u.dip.value = Math.max(fade, b.crashed ? Math.max(0, (b.crashT - 1.5) / 0.8) : 0);
    renderer.setRenderTarget(null); renderer.clear();
    renderer.render(comp.scene, comp.cam);
    renderer.clearDepth();
    if (!(b.crashed && b.crashT > 0.25)) {
      cockpit.update(b, inp, roll, shakeAmt * r(83), dt);
      if (frameN % 3 === 0) cockpit.tach.draw(b.rpm, b.gear, kmh, b.limiter, b.wobble > 0.15);
      renderer.render(cockpit.scene, cockpit.camera);
    }
  }

  function trackFps(dt) {
    fpsT += dt; fpsN++;
    if (fpsT < 1.5) return;
    fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
    lowStreak = fps < 50 ? lowStreak + 1 : 0;
    if (lowStreak >= 2 && qLevel < QUALITY.length - 1 && !document.hidden) { qLevel++; lowStreak = 0; resize(); }
  }

  // ---- Boot ----
  function boot() {
    if (!window.THREE) { $('loading').textContent = 'The 3D engine could not load. Check your connection and reopen the game.'; $('loading').hidden = false; return; }
    try { initRenderer(); } catch (e) { $('loading').textContent = 'This device could not start 3D graphics. Close other apps and reopen the game.'; $('loading').hidden = false; return; }
    bindControls();
    CL.UI.init(career, { ride: startRide, menu: () => toMenu(C.STAGES[0]), currentStage: () => stage, livery: () => cockpit.setLivery(liveryColor()) });
    loadStage(C.STAGES[0]);
    mode = 'attract';
    showOnly('menu');
    $('loading').hidden = true;
    requestAnimationFrame((t) => { lastT = t; frame(t); });
    C.Store.connect(career).then((c) => { career = c; CL.UI.setCareer(c); cockpit.setLivery(liveryColor()); CL.UI.render(); });
    window.CLDebug = {
      get bike() { return bike; }, get mode() { return mode; }, get fps() { return fps; }, get q() { return qLevel; }, get career() { return career; }, get track() { return track; }, inp,
      setAttractS(s) { const p = T.worldAt(track, s, 1.8); Object.assign(bike, { x: p.x, z: p.z, y: p.y, h: p.h, s, d: 1.8, v: 42, gear: 4 }); },
      ride(id) { startRide(C.STAGES.find((x) => x.id === id) || C.STAGES[0]); },
      info() { return renderer.info.render; },
      advance(seconds) { if (mode === 'count') { countdown = 0; mode = 'ride'; $('lights').hidden = true; } const n = Math.round(seconds / DT); for (let i = 0; i < n && mode === 'ride'; i++) simStep(); updateHud(1); if (carMeshes.length) layoutCars(); draw(0.016); return mode; },
    };
  }
  boot();
})();
