// The 3D coast: road, terrain, sea, sky, roadside objects and the golden-hour lighting.
(function () {
  const CL = window.CL, T = CL.Track, CHUNK = 40; // sections per chunk: 160 m of road
  const SUN_DIR = new THREE.Vector3(-0.62, 0.13, -0.77).normalize();
  const srgb = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  function noise2(x, z) {
    const f = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    return (f(ix, iz) * (1 - u) + f(ix + 1, iz) * u) * (1 - v) + (f(ix, iz + 1) * (1 - u) + f(ix + 1, iz + 1) * u) * v;
  }
  const fbm = (x, z) => noise2(x, z) * 0.55 + noise2(x * 2.3, z * 2.3) * 0.3 + noise2(x * 5.1, z * 5.1) * 0.15;

  function asphaltTexture(renderer) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = '#4a4744'; x.fillRect(0, 0, 512, 1024);
    const img = x.getImageData(0, 0, 512, 1024), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 44 + (Math.random() < 0.02 ? 34 : 0);
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    x.globalAlpha = 0.16; x.fillStyle = '#1d1b1a'; // worn wheel tracks
    [150, 205, 307, 362].forEach((p) => x.fillRect(p - 15, 0, 30, 1024));
    x.globalAlpha = 0.14; x.strokeStyle = '#1a1817'; x.lineWidth = 2;
    for (let i = 0; i < 9; i++) { x.beginPath(); let a = Math.random() * 512, b = Math.random() * 1024; x.moveTo(a, b); for (let k = 0; k < 5; k++) { a += (Math.random() - 0.5) * 50; b += 36; x.lineTo(a, b); } x.stroke(); }
    x.globalAlpha = 0.95; x.fillStyle = '#e8e3d4';
    x.fillRect(24, 0, 7, 1024); x.fillRect(481, 0, 7, 1024);
    x.fillStyle = '#e5c56a'; x.fillRect(252, 0, 8, 430); x.fillRect(252, 600, 8, 300);
    const t = new THREE.CanvasTexture(c);
    t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  function grainTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'), img = x.createImageData(256, 256), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const px = (i / 4) % 256, py = Math.floor(i / 4 / 256);
      const v = 150 + (fbm(px * 0.06, py * 0.06) - 0.5) * 120 + (Math.random() - 0.5) * 70;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }

  function buildRoad(track, from, to, mat) {
    const cols = [-1, -0.97, 0, 0.97, 1], hw = track.halfRoad;
    const pos = [], uv = [], col = [], idx = [];
    for (let i = from; i <= to; i++) {
      const h = track.H[i], tint = 0.9 + 0.2 * noise2(i * 0.05, 3.3);
      for (const c of cols) {
        pos.push(track.X[i] + Math.cos(h) * c * hw, track.Y[i] + 0.04 + (1 - c * c) * 0.05, track.Z[i] + Math.sin(h) * c * hw);
        uv.push((c + 1) / 2, (i * track.step) / 14);
        col.push(tint, tint, tint);
      }
    }
    quads(idx, to - from, cols.length);
    return mesh(pos, idx, mat, { uv, col });
  }
  function quads(idx, rows, cols) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + cols;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  function mesh(pos, idx, mat, extra) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (extra.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(extra.uv, 2));
    if (extra.col) g.setAttribute('color', new THREE.Float32BufferAttribute(extra.col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  // Terrain cross-section: mountain rising on the right, cliff falling to the sea on the left.
  const MOUNTAIN = [4.5, 5.6, 6.8, 8, 11, 16, 24, 36, 54, 82, 122, 180, 260];
  const CLIFF = [-4.5, -5.9, -7, -10, -15, -23, -35, -52, -78, -115, -165, -240, -330];
  const GRASS = srgb('#6d7040'), DRY = srgb('#8d8150'), ROCK = srgb('#6f5e52'), ROCK2 = srgb('#463a35'), SAND = srgb('#bda581'), SCRUB = srgb('#3f4e2b');

  // Height of the mountainside at a distance from the road: a cut bank first, then the open slope.
  function mountainY(y0, a, x, z) {
    const n = fbm(x * 0.009, z * 0.009), n2 = fbm(x * 0.05, z * 0.05);
    const bank = Math.max(0, Math.min(1, (a - 6.2) / 2.2)) * (1.5 + n2 * 2.2);
    const open = Math.pow(Math.max(0, a - 7.5), 1.08) * (0.26 + n * 0.42);
    return y0 - 0.06 - Math.max(0, 5 - a) * 0.02 + bank + open + (a > 9 ? (n2 - 0.5) * Math.min(5, a * 0.14) : 0);
  }

  function innerLimit(track, i) {
    let k = 0;
    for (let j = Math.max(0, i - 12); j <= Math.min(track.n - 1, i + 12); j++) k = Math.max(k, Math.abs(track.K[j]));
    return k > 1e-4 ? 0.82 / k : 1e4;
  }
  function buildSide(track, from, to, offsets, mat) {
    const pos = [], col = [], uv = [], idx = [], c = new THREE.Color();
    const mountain = offsets[0] > 0;
    for (let i = from; i <= to; i++) {
      const h = track.H[i], y0 = track.Y[i], lim = innerLimit(track, i);
      const inner = mountain ? track.K[i] > 0 : track.K[i] < 0;
      for (let o = 0; o < offsets.length; o++) {
        let d = offsets[o];
        if (inner) d = Math.sign(d) * Math.min(Math.abs(d), Math.max(Math.abs(offsets[0]) + o * 0.5, lim));
        const x = track.X[i] + Math.cos(h) * d, z = track.Z[i] + Math.sin(h) * d, a = Math.abs(d);
        const n = fbm(x * 0.012, z * 0.012), n2 = fbm(x * 0.05, z * 0.05), n3 = noise2(x * 0.3, z * 0.3);
        let y;
        if (mountain) {
          y = mountainY(y0, a, x, z);
          if (a < 8.2) c.copy(ROCK2).lerp(ROCK, n3); // cut rock bank beside the road
          else if (n2 > 0.56) c.copy(ROCK).lerp(ROCK2, n3);
          else c.copy(DRY).lerp(GRASS, n).lerp(SCRUB, Math.min(1, n2 * 1.3));
        } else {
          const t = Math.min(1, (a - 5) / 240);
          y = o < 2 ? y0 - 0.06 - Math.max(0, a - 5.7) * 0.15 : y0 * (1 - Math.pow(t, 0.62)) - 4 * t + (n2 - 0.5) * Math.min(14, a * 0.25) - Math.min(a, 8) * 0.25;
          if (y < 3) c.copy(SAND); else if (n2 > 0.46) c.copy(ROCK).lerp(ROCK2, n3); else c.copy(DRY).lerp(SCRUB, n);
        }
        pos.push(x, y, z);
        uv.push(x * 0.07, (z + y) * 0.07);
        const shade = 0.78 + n2 * 0.38;
        col.push(c.r * shade, c.g * shade, c.b * shade);
      }
    }
    quads(idx, to - from, offsets.length);
    if (!mountain) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } }
    return mesh(pos, idx, mat, { col, uv });
  }

  function buildRail(track, from, to, mat) {
    const pos = [], idx = [], rows = [[0.5], [0.62], [0.74], [0.82]];
    for (let i = from; i <= to; i++) {
      const h = track.H[i], d = track.railLeft - 0.05;
      const x = track.X[i] + Math.cos(h) * d, z = track.Z[i] + Math.sin(h) * d;
      const wave = [0, 0.06, 0, 0.05];
      rows.forEach((r, n) => pos.push(x + Math.cos(h) * wave[n], track.Y[i] + r[0], z + Math.sin(h) * wave[n]));
    }
    quads(idx, to - from, rows.length);
    const m = mesh(pos, idx, mat, {});
    return m;
  }

  function instanced(geo, mat, count, place) {
    const m = new THREE.InstancedMesh(geo, mat, count), o = new THREE.Object3D();
    for (let i = 0; i < count; i++) { place(o, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); }
    m.frustumCulled = false; m.instanceMatrix.needsUpdate = true;
    return m;
  }

  function roadsideObjects(track, group, r) {
    const trees = [], cypress = [], rocks = [];
    for (let s = 20; s < track.length; s += 4) {
      const i = Math.floor(s / track.step), side = r();
      const lim = innerLimit(track, i);
      if (side < 0.62) {
        const d = 11 + Math.pow(r(), 1.5) * 90;
        if (track.K[i] > 0 && d > lim * 0.8) continue;
        const p = T.worldAt(track, s, d);
        (r() < 0.28 ? cypress : trees).push({ x: p.x, y: mountainY(track.Y[i], d, p.x, p.z) - 0.4, z: p.z, s: 0.55 + r() * 0.75, a: r() * 6.28 });
      } else if (side < 0.72) {
        const p = T.worldAt(track, s, 7.6 + r() * 3);
        rocks.push({ x: p.x, y: track.Y[i] + 0.2, z: p.z, s: 0.5 + r() * 1.4, a: r() * 6.28 });
      }
    }
    const pineMat = new THREE.MeshLambertMaterial({ color: srgb('#44552a'), flatShading: true });
    const cone = new THREE.ConeGeometry(2.4, 7, 7, 1); cone.translate(0, 5, 0);
    const umbrella = new THREE.SphereGeometry(3.4, 7, 4); umbrella.scale(1, 0.45, 1); umbrella.translate(0, 6.2, 0);
    const trunkG = new THREE.CylinderGeometry(0.2, 0.34, 5.4, 5); trunkG.translate(0, 2.7, 0);
    const trunkM = new THREE.MeshLambertMaterial({ color: srgb('#4a3628') });
    const cyp = new THREE.ConeGeometry(0.95, 9.5, 6, 1); cyp.translate(0, 5.2, 0);
    const placeTree = (list) => (o, i) => { const t = list[i]; o.position.set(t.x, t.y, t.z); o.scale.setScalar(t.s); o.rotation.y = t.a; };
    group.add(instanced(umbrella, pineMat, trees.length, placeTree(trees)));
    group.add(instanced(trunkG, trunkM, trees.length, placeTree(trees)));
    group.add(instanced(cyp, new THREE.MeshLambertMaterial({ color: srgb('#2f4426'), flatShading: true }), cypress.length, placeTree(cypress)));
    const rockG = new THREE.DodecahedronGeometry(1, 0);
    group.add(instanced(rockG, new THREE.MeshLambertMaterial({ color: srgb('#7a6355'), flatShading: true }), rocks.length, placeTree(rocks)));

    // Guardrail posts along the sea side.
    const count = Math.floor(track.length / 4);
    const post = new THREE.BoxGeometry(0.1, 0.9, 0.1); post.translate(0, 0.45, 0);
    group.add(instanced(post, new THREE.MeshLambertMaterial({ color: srgb('#6c6a66') }), count, (o, n) => {
      const s = n * 4, p = T.worldAt(track, s, track.railLeft + 0.05);
      o.position.set(p.x, p.y, p.z); o.rotation.y = -p.h;
    }));

    // Chevron boards warn of tight corners, on the outside of the bend.
    const chev = [];
    for (let s = 40; s < track.length - 20; s += 22) {
      const q = T.sample(track, s);
      if (Math.abs(q.k) > 1 / 125) chev.push({ s, d: q.k > 0 ? track.railLeft + 0.2 : track.wallRight - 0.3, dir: Math.sign(q.k), h: q.h });
    }
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const cx = cv.getContext('2d'); cx.fillStyle = '#16120f'; cx.fillRect(0, 0, 128, 128); cx.fillStyle = '#ffc93c';
    cx.beginPath(); cx.moveTo(30, 14); cx.lineTo(70, 14); cx.lineTo(104, 64); cx.lineTo(70, 114); cx.lineTo(30, 114); cx.lineTo(64, 64); cx.closePath(); cx.fill();
    const chevTex = new THREE.CanvasTexture(cv); chevTex.encoding = THREE.sRGBEncoding;
    const board = new THREE.PlaneGeometry(1.15, 1.15); board.translate(0, 1.35, 0);
    const mkChev = (list, flip) => instanced(board, new THREE.MeshBasicMaterial({ map: chevTex, side: THREE.DoubleSide }), list.length, (o, i) => {
      const c = list[i], p = T.worldAt(track, c.s, c.d);
      o.position.set(p.x, p.y, p.z); o.rotation.set(0, -p.h, 0); o.scale.set(flip ? -1 : 1, 1, 1);
    });
    group.add(mkChev(chev.filter((c) => c.dir > 0), false));
    group.add(mkChev(chev.filter((c) => c.dir < 0), true));
  }

  function gate(track, s, label, color) {
    const g = new THREE.Group(), p = T.sample(track, s);
    g.position.set(p.x, p.y, p.z); g.rotation.y = -p.h;
    const mat = new THREE.MeshLambertMaterial({ color: srgb('#2a2523') });
    [-5.2, 5.2].forEach((x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 6, 0.28), mat); m.position.set(x, 3, 0); g.add(m); });
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 96;
    const c = cv.getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, 1024, 96); c.fillStyle = '#14100e';
    c.font = '800 italic 66px "Barlow Condensed", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 512, 50);
    const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(10.8, 1.05), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    b.position.set(0, 5.6, 0); g.add(b);
    return g;
  }

  // Sky and sea are shaders, so they cost almost nothing and have no seams.
  const SKY_FRAG = `
    varying vec3 vDir; uniform vec3 sunDir;
    float n(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float sn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(n(i),n(i+vec2(1,0)),f.x),mix(n(i+vec2(0,1)),n(i+vec2(1,1)),f.x),f.y);}
    void main(){ vec3 d=normalize(vDir); float h=max(d.y,0.0);
      vec3 hor=vec3(1.05,0.46,0.2), mid=vec3(0.46,0.27,0.36), top=vec3(0.06,0.12,0.32);
      vec3 c=mix(hor,mid,smoothstep(0.0,0.14,h)); c=mix(c,top,smoothstep(0.08,0.5,h));
      float s=max(dot(d,sunDir),0.0);
      c+=vec3(1.2,0.55,0.2)*pow(s,10.0)*0.55+vec3(2.4,1.3,0.6)*pow(s,140.0)+vec3(14.0,10.0,6.5)*smoothstep(0.9988,0.9994,s);
      vec2 uv=d.xz/(d.y+0.12)*vec2(0.9,2.6);
      float cl=sn(uv)*0.55+sn(uv*2.1+3.0)*0.3+sn(uv*4.3)*0.15; cl=smoothstep(0.52,0.78,cl)*smoothstep(0.02,0.14,d.y);
      vec3 ccol=mix(vec3(0.72,0.32,0.28),vec3(1.5,0.8,0.48),pow(s,3.0));
      c=mix(c,ccol,cl*0.72);
      if(d.y<0.0) c=hor;
      gl_FragColor=vec4(c,1.0); }`;
  const SEA_FRAG = `
    varying vec3 vW; uniform vec3 sunDir; uniform vec3 camPos; uniform float time;
    void main(){ vec3 v=normalize(camPos-vW); float dist=length(camPos-vW); vec2 p=vW.xz;
      float a=sin(p.x*.09+time*.7)+sin(p.y*.13-time*.9)+sin((p.x+p.y)*.31+time*1.3)*.5+sin((p.x-p.y)*.71-time*1.9)*.25;
      float b=cos(p.x*.09+time*.7)*.09+cos((p.x+p.y)*.31+time*1.3)*.155+cos((p.x-p.y)*.71-time*1.9)*.18;
      float e=cos(p.y*.13-time*.9)*.13+cos((p.x+p.y)*.31+time*1.3)*.155-cos((p.x-p.y)*.71-time*1.9)*.18;
      float damp=1.0/(1.0+dist*.012); vec3 n=normalize(vec3(-b*.32*damp,1.0,-e*.32*damp));
      float fres=pow(1.0-max(dot(n,v),0.0),4.0);
      vec3 deep=vec3(0.008,0.05,0.085), shal=vec3(0.015,0.13,0.16), sky=vec3(0.72,0.36,0.24);
      vec3 c=mix(deep,shal,clamp(a*.07+.35,0.,1.)); c=mix(c,sky,min(fres,0.55)*.75);
      vec3 r=reflect(-v,n); float g=pow(max(dot(r,sunDir),0.),260.0)*9.0+pow(max(dot(r,sunDir),0.),32.0)*.5;
      c+=vec3(2.6,1.55,.75)*g;
      vec3 hor=vec3(1.05,.46,.2); c=mix(c,hor,1.0-exp(-dist*.00024));
      gl_FragColor=vec4(c,1.0); }`;

  function skyAndSea(scene) {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sunDir: { value: SUN_DIR } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: SKY_FRAG,
    }));
    sky.renderOrder = -2; sky.frustumCulled = false; scene.add(sky);
    const seaU = { sunDir: { value: SUN_DIR }, camPos: { value: new THREE.Vector3() }, time: { value: 0 } };
    const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1); geo.rotateX(-Math.PI / 2);
    const sea = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: seaU, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}',
      fragmentShader: SEA_FRAG,
    }));
    sea.frustumCulled = false; scene.add(sea);
    return { sky, sea, seaU };
  }

  // Distant ridgelines and sea stacks give the horizon depth.
  function farRange(scene) {
    const make = (dist, height, colorHex, phase) => {
      const pos = [], col = [], idx = [], c = srgb(colorHex), N = 180;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2, sx = Math.sin(a), cz = -Math.cos(a);
        // ridges stand inland (positive x); the sea side stays open to the horizon
        const land = Math.max(0, Math.min(1, (sx + 0.55) * 1.6));
        const h = height * land * (0.35 + fbm(i * 0.12 + phase, phase) * 0.95);
        pos.push(sx * dist, -20, cz * dist, sx * dist, h, cz * dist);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      quads(idx, N, 2);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    return [make(6200, 1200, '#a15a48', 1.3), make(4300, 820, '#623c3a', 7.7)];
  }

  function seaStacks(track, group, r) {
    const geo = new THREE.DodecahedronGeometry(1, 1), mat = new THREE.MeshLambertMaterial({ color: srgb('#4a3a35'), flatShading: true });
    const list = [];
    for (let i = 0; i < 26; i++) {
      const s = r() * track.length, d = -(320 + r() * 900), p = T.worldAt(track, s, d), w = 14 + r() * 40;
      list.push({ x: p.x, z: p.z, w, h: w * (0.8 + r() * 1.5), a: r() * 6 });
    }
    group.add(instanced(geo, mat, list.length, (o, i) => { const t = list[i]; o.position.set(t.x, 0, t.z); o.scale.set(t.w, t.h, t.w * 0.8); o.rotation.y = t.a; }));
  }

  function build(track, renderer) {
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(srgb('#d9824e').getHex(), 0.00105);
    scene.add(new THREE.HemisphereLight(srgb('#a9b4d8').getHex(), srgb('#7a5238').getHex(), 0.85));
    const sun = new THREE.DirectionalLight(srgb('#ffbe82').getHex(), 1.75);
    sun.position.copy(SUN_DIR).multiplyScalar(100); scene.add(sun);

    const env = skyAndSea(scene);
    const far = farRange(scene);
    const roadMat = new THREE.MeshPhongMaterial({ map: asphaltTexture(renderer), vertexColors: true, shininess: 26, specular: srgb('#57412e') });
    const landMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: grainTexture() });
    const railMat = new THREE.MeshPhongMaterial({ color: srgb('#b9b6b0'), shininess: 60, specular: srgb('#a08070'), side: THREE.DoubleSide });

    const chunks = [], r = T.rng(track.def.seed + 7);
    for (let from = 0; from < track.n - 1; from += CHUNK) {
      const to = Math.min(track.n - 1, from + CHUNK), g = new THREE.Group();
      g.add(buildRoad(track, from, to, roadMat));
      g.add(buildSide(track, from, to, MOUNTAIN, landMat));
      g.add(buildSide(track, from, to, CLIFF, landMat));
      g.add(buildRail(track, from, to, railMat));
      g.userData.s0 = from * track.step; g.userData.s1 = to * track.step;
      scene.add(g); chunks.push(g);
    }
    const props = new THREE.Group(); scene.add(props);
    roadsideObjects(track, props, r);
    seaStacks(track, props, r);
    const gates = [];
    track.sectors.forEach((s, i) => {
      const last = i === track.sectors.length - 1;
      const g = gate(track, last ? track.finish : s, last ? 'FINISH' : 'SECTOR ' + (i + 1), last ? '#ffb347' : '#efe6d2');
      scene.add(g); gates.push(g);
    });
    const start = gate(track, 14, 'START', '#ffb347'); scene.add(start);

    return {
      scene, env, far, sunDir: SUN_DIR, gates,
      update(camera, s, time, drawFar) {
        const lo = s - 120, hi = s + drawFar;
        for (const c of chunks) c.visible = c.userData.s1 > lo && c.userData.s0 < hi;
        env.sky.position.copy(camera.position);
        env.sea.position.set(camera.position.x, 0, camera.position.z);
        env.seaU.camPos.value.copy(camera.position); env.seaU.time.value = time;
        far.forEach((m) => m.position.set(camera.position.x, 0, camera.position.z));
      },
      dispose() {
        scene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        });
      },
    };
  }

  CL.World = { build, SUN_DIR, srgb };
})();
