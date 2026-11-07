// The rider's view: bars, tank, gloves, levers, instruments and rear-view mirrors. Drawn sharp, over the world.
(function () {
  const CL = window.CL, srgb = CL.World.srgb;

  function makeTach() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.minFilter = THREE.LinearFilter;
    const c = cv.getContext('2d');
    const angle = (rpm) => Math.PI * 0.82 + (rpm / 15000) * Math.PI * 1.36;
    let last = '';
    function draw(rpm, gear, kmh, limiter, slip) {
      const key = Math.round(rpm / 60) + '|' + gear + '|' + Math.round(kmh) + '|' + limiter + '|' + (slip ? 1 : 0);
      if (key === last) return;
      last = key;
      c.fillStyle = '#0b0a0a'; c.fillRect(0, 0, 512, 256);
      const cx = 150, cy = 136, r = 112;
      c.lineWidth = 14; c.strokeStyle = '#2b2725'; c.beginPath(); c.arc(cx, cy, r, angle(0), angle(15000)); c.stroke();
      c.strokeStyle = '#d9381e'; c.beginPath(); c.arc(cx, cy, r, angle(13500), angle(15000)); c.stroke();
      c.lineWidth = 14; c.strokeStyle = rpm > 12000 ? '#ff5a2a' : '#ffb347'; c.beginPath(); c.arc(cx, cy, r, angle(0), angle(Math.min(15000, rpm))); c.stroke();
      c.fillStyle = '#efe6d2'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '700 21px "Barlow Condensed", sans-serif';
      for (let k = 0; k <= 15; k += 3) {
        const a = angle(k * 1000);
        c.fillText(String(k), cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
      }
      const a = angle(rpm);
      c.strokeStyle = '#ff6a33'; c.lineWidth = 5; c.beginPath(); c.moveTo(cx - Math.cos(a) * 14, cy - Math.sin(a) * 14); c.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); c.stroke();
      c.fillStyle = '#1b1817'; c.beginPath(); c.arc(cx, cy, 14, 0, 6.3); c.fill();
      c.fillStyle = '#90857b'; c.font = '500 15px "Barlow Condensed", sans-serif'; c.fillText('x1000 r/min', cx, cy + 74);
      c.textAlign = 'left';
      c.fillStyle = limiter ? '#ff3b2f' : '#ffb347'; c.font = '800 118px "Barlow Condensed", Impact, sans-serif'; c.fillText(String(gear), 320, 86);
      c.fillStyle = '#90857b'; c.font = '500 18px "Barlow Condensed", sans-serif'; c.fillText('GEAR', 390, 58);
      c.fillStyle = '#f7efdf'; c.font = '800 66px "Barlow Condensed", Impact, sans-serif'; c.fillText(String(Math.round(kmh)), 320, 186);
      c.fillStyle = '#90857b'; c.font = '500 18px "Barlow Condensed", sans-serif'; c.fillText('km/h', 430, 200);
      if (slip) { c.fillStyle = '#ffb347'; c.font = '800 22px "Barlow Condensed", sans-serif'; c.fillText('TRACTION', 320, 232); }
      tex.needsUpdate = true;
    }
    return { tex, draw };
  }

  function cyl(r1, r2, len, mat, seg) { return new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg || 12), mat); }

  function build(mirrorTexture, liveryColor) {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xcfd4ef, 0x6b4a33, 0.9));
    const sun = new THREE.DirectionalLight(0xffc58a, 1.9); sun.position.set(-0.5, 1, -0.6); scene.add(sun);
    const rim = new THREE.DirectionalLight(0xff9d57, 0.7); rim.position.set(0.8, 0.2, -1); scene.add(rim);

    const metal = new THREE.MeshPhongMaterial({ color: 0x8d8a86, shininess: 90, specular: 0xffe2c4 });
    const black = new THREE.MeshPhongMaterial({ color: 0x141312, shininess: 32, specular: 0x4a4038 });
    const rubber = new THREE.MeshLambertMaterial({ color: 0x0d0c0c });
    const paint = new THREE.MeshPhongMaterial({ color: srgb(liveryColor).getHex(), shininess: 120, specular: 0xfff0dd });
    const glove = new THREE.MeshPhongMaterial({ color: 0x0c0b0c, shininess: 14, specular: 0x2a2420 });
    const gloveAcc = new THREE.MeshPhongMaterial({ color: srgb(liveryColor).getHex(), shininess: 50 });

    const bike = new THREE.Group(); scene.add(bike);
    bike.position.set(0, -0.38, -0.56);

    // Tank, with the rider looking down over it.
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), paint);
    tank.scale.set(0.9, 0.58, 1.25); tank.position.set(0, -0.2, 0.28); bike.add(tank);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.56), new THREE.MeshPhongMaterial({ color: 0xf2eadb, shininess: 90 }));
    stripe.position.set(0, -0.031, 0.26); bike.add(stripe);
    const cap = cyl(0.05, 0.05, 0.012, metal, 20); cap.position.set(0, -0.03, 0.42); bike.add(cap);

    // Steering group turns with the bars.
    const steer = new THREE.Group(); bike.add(steer); steer.position.set(0, 0, -0.08);
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.022, 0.1), black); yoke.position.set(0, 0.012, 0); steer.add(yoke);
    [-0.1, 0.1].forEach((x) => {
      const fork = cyl(0.026, 0.026, 0.16, metal); fork.position.set(x, 0.03, 0); steer.add(fork);
      const capF = cyl(0.016, 0.016, 0.012, new THREE.MeshPhongMaterial({ color: 0xc9992b, shininess: 90 })); capF.position.set(x, 0.114, 0); steer.add(capF);
    });
    const nut = cyl(0.022, 0.022, 0.014, metal, 8); nut.position.set(0, 0.03, 0); steer.add(nut);

    const levers = {};
    [-1, 1].forEach((side) => {
      const bar = cyl(0.0115, 0.0115, 0.38, metal); bar.rotation.z = Math.PI / 2 - side * 0.13; bar.position.set(side * 0.27, 0.052, 0.012); steer.add(bar);
      const grip = cyl(0.0185, 0.0165, 0.13, rubber, 12); grip.rotation.z = Math.PI / 2 - side * 0.13; grip.position.set(side * 0.43, 0.073, 0.012); steer.add(grip);
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), black); clamp.position.set(side * 0.1, 0.05, 0.005); steer.add(clamp);
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.036, 0.042), black); sw.position.set(side * 0.33, 0.06, 0.01); steer.add(sw);

      // Gloved hand: palm, four fingers, knuckle guard.
      const hand = new THREE.Group(); hand.position.set(side * 0.43, 0.085, 0.018); hand.scale.setScalar(0.86); steer.add(hand);
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 10), glove); palm.scale.set(1.15, 0.75, 1.05); palm.position.set(0, 0.008, 0.012); hand.add(palm);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.0098, 0.0098, 0.042, 8), glove);
        f.position.set((i - 1.5) * 0.0215, -0.002, -0.027); f.rotation.x = 1.2; hand.add(f);
      }
      const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.012, 0.024), gloveAcc); knuckle.position.set(0, 0.038, 0.002); knuckle.rotation.x = -0.35; hand.add(knuckle);
      const wrist = cyl(0.026, 0.032, 0.09, glove, 10); wrist.rotation.x = Math.PI / 2 - 0.55; wrist.position.set(side * 0.016, 0.022, 0.062); hand.add(wrist);

      // Lever, pivoting at the clamp.
      const pivot = new THREE.Group(); pivot.position.set(side * 0.35, 0.062, -0.03); steer.add(pivot);
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.006, 0.013), metal); lever.position.set(side * 0.075, 0, -0.018); lever.rotation.y = side * 0.14; pivot.add(lever);
      levers[side] = pivot;
    });

    // Instrument panel, tilted toward the rider.
    const tach = makeTach();
    const dash = new THREE.Group(); dash.position.set(0, 0.105, -0.17); dash.rotation.x = -0.72; dash.scale.setScalar(0.74); bike.add(dash);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), new THREE.MeshBasicMaterial({ map: tach.tex, toneMapped: false })); dash.add(face);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.05), black); housing.position.set(0, 0, -0.03); dash.add(housing);
    // A slim painted fairing edge around a dark nose, as seen from the saddle.
    const fairing = new THREE.Mesh(new THREE.SphereGeometry(0.36, 28, 12), paint);
    fairing.scale.set(0.98, 0.14, 0.62); fairing.position.set(0, -0.055, -0.33); bike.add(fairing);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 12), black);
    nose.scale.set(0.84, 0.16, 0.56); nose.position.set(0, -0.012, -0.3); bike.add(nose);

    // Tinted windscreen.
    const screenGeo = new THREE.PlaneGeometry(0.42, 0.13, 12, 3), p = screenGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, -Math.abs(x) * x * 0.3 * Math.sign(x) * Math.sign(x) + x * x * 0.8 - y * 0.25); p.setX(i, x * (1 - (y + 0.15) * 0.45)); }
    screenGeo.computeVertexNormals();
    const screen = new THREE.Mesh(screenGeo, new THREE.MeshPhongMaterial({ color: 0x1a1312, transparent: true, opacity: 0.2, shininess: 200, specular: 0xffd9b0, side: THREE.DoubleSide, depthWrite: false }));
    screen.position.set(0, 0.125, -0.44); screen.rotation.x = -0.1; bike.add(screen);

    // Rear-view mirrors show a real rear camera.
    const mirrorMats = [];
    [-1, 1].forEach((side) => {
      const m = new THREE.Group(); m.position.set(side * 0.46, 0.2, -0.46); bike.add(m);
      const stalk = cyl(0.007, 0.007, 0.17, black, 6); stalk.rotation.z = Math.PI / 2 + side * 0.25; stalk.position.set(-side * 0.09, -0.02, 0); m.add(stalk);
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), black); shell.scale.set(1.5, 0.82, 0.32); shell.position.z = -0.012; m.add(shell);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: mirrorTexture, toneMapped: false });
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.066, 20), mat); glass.scale.set(1.55, 0.82, 1); glass.position.z = 0.016; m.add(glass);
      mirrorMats.push(mat);
    });

    const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.05, 6);
    camera.position.set(0, 0, 0);

    return {
      scene, camera, tach, mirrorMats,
      setLivery(hex) { paint.color.set(srgb(hex).getHex()); gloveAcc.color.set(srgb(hex).getHex()); },
      update(b, inp, viewRoll, shake, dt) {
        const bikeRoll = b.phi - viewRoll;
        bike.rotation.z = -bikeRoll;
        bike.rotation.x = -0.02 + b.comp * 0.03;
        bike.position.y = -0.38 - Math.max(0, b.comp) * 0.012 + shake * 0.003;
        bike.position.x = shake * 0.0018;
        const steerA = Math.max(-0.42, Math.min(0.42, (b.yaw / Math.max(b.v, 3)) * 1.25 - (b.phi * 0.06) + (b.crashed ? 0.3 : 0)));
        steer.rotation.y = -steerA;
        levers[1].rotation.y = inp.front * 0.28;
        levers[-1].rotation.y = -(b.shiftT > 0 ? 0.22 : 0);
      },
    };
  }

  CL.Cockpit = { build };
})();
