// Sky, sun, ambient, fog, image-based lighting and the time-of-day arc that
// runs from sunrise (p = 0) to blue hour (p = 1).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { track, range, rng, clamp } from '../lib/util.js';

const deg = THREE.MathUtils.degToRad;

const KEYS = {
  elev:     [{ p: 0, v: 14 }, { p: 0.3, v: 38 }, { p: 0.55, v: 48 }, { p: 0.76, v: 26 }, { p: 0.87, v: 9 }, { p: 0.94, v: 2.2 }, { p: 1, v: -0.6 }],
  azim:     [{ p: 0, v: 28 }, { p: 0.5, v: 82 }, { p: 0.8, v: 142 }, { p: 1, v: 158 }],
  sun:      [{ p: 0, v: 3.4 }, { p: 0.4, v: 4.2 }, { p: 0.78, v: 3.8 }, { p: 0.88, v: 2.8 }, { p: 0.95, v: 0.9 }, { p: 1, v: 0.0 }],
  sunCol:   [{ p: 0, v: [1, 0.82, 0.66] }, { p: 0.3, v: [1, 0.95, 0.88] }, { p: 0.6, v: [1, 0.96, 0.9] }, { p: 0.8, v: [1, 0.8, 0.58] }, { p: 0.92, v: [1, 0.58, 0.32] }, { p: 1, v: [1, 0.45, 0.25] }],
  hemi:     [{ p: 0, v: 0.32 }, { p: 0.5, v: 0.36 }, { p: 0.85, v: 0.3 }, { p: 0.95, v: 0.32 }, { p: 1, v: 0.38 }],
  ibl:      [{ p: 0, v: 0.32 }, { p: 0.5, v: 0.34 }, { p: 0.85, v: 0.4 }, { p: 1, v: 0.7 }],
  hemiSky:  [{ p: 0, v: [0.62, 0.72, 0.9] }, { p: 0.5, v: [0.62, 0.74, 0.95] }, { p: 0.85, v: [0.75, 0.68, 0.7] }, { p: 1, v: [0.22, 0.3, 0.55] }],
  hemiGnd:  [{ p: 0, v: [0.42, 0.36, 0.3] }, { p: 0.85, v: [0.4, 0.3, 0.24] }, { p: 1, v: [0.12, 0.1, 0.12] }],
  exposure: [{ p: 0, v: 0.66 }, { p: 0.5, v: 0.58 }, { p: 0.82, v: 0.64 }, { p: 0.93, v: 0.82 }, { p: 1, v: 1.0 }],
  turb:     [{ p: 0, v: 6 }, { p: 0.5, v: 4 }, { p: 0.85, v: 8 }, { p: 1, v: 10 }],
  rayleigh: [{ p: 0, v: 1.6 }, { p: 0.5, v: 1.2 }, { p: 0.85, v: 2.2 }, { p: 1, v: 3.2 }],
  mieG:     [{ p: 0, v: 0.82 }, { p: 1, v: 0.9 }],
  fog:      [{ p: 0, v: [0.66, 0.68, 0.7] }, { p: 0.5, v: [0.66, 0.72, 0.8] }, { p: 0.82, v: [0.75, 0.66, 0.58] }, { p: 0.93, v: [0.45, 0.36, 0.36] }, { p: 1, v: [0.12, 0.13, 0.2] }],
  fogDens:  [{ p: 0, v: 0.0034 }, { p: 0.5, v: 0.0026 }, { p: 1, v: 0.0034 }],
  ridge:    [{ p: 0, v: [0.42, 0.47, 0.55] }, { p: 0.5, v: [0.45, 0.52, 0.62] }, { p: 0.85, v: [0.48, 0.42, 0.45] }, { p: 1, v: [0.07, 0.08, 0.13] }],
};

export function createEnvironment(renderer, scene, { quality }) {
  const group = new THREE.Group();

  const sky = new Sky();
  sky.scale.setScalar(4000);
  sky.material.uniforms.mieCoefficient.value = 0.004;
  group.add(sky);

  // Separate sky used only to bake the environment map.
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(50);
  envScene.add(envSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  let lastEnvP = -1, lastEnvTime = -1;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  const S = quality.shadowSize;
  sun.shadow.mapSize.set(S, S);
  const sc = sun.shadow.camera;
  sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  sun.target.position.set(0, 0, -4);
  group.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd0ff, 0x6b5a48, 0.8);
  group.add(hemi);

  scene.fog = new THREE.FogExp2(0xaab0b6, 0.003);

  // Distant ridges for depth (two parallax layers), unaffected by fog so we can tint them as haze.
  const ridges = [
    makeRidge(950, 70, 190, 5, 0.55),
    makeRidge(1400, 120, 300, 9, 0.35),
  ];
  ridges.forEach((r) => group.add(r.mesh));

  const sunDir = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const state = { night: 0, sunDir, sunIntensity: 0 };

  function update(p, time, force = false) {
    const elev = deg(track(KEYS.elev, p));
    const azim = deg(track(KEYS.azim, p));
    sunDir.set(Math.cos(azim) * Math.cos(elev), Math.sin(elev), Math.sin(azim) * Math.cos(elev));

    for (const s of [sky, envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(sunDir);
      u.turbidity.value = track(KEYS.turb, p);
      u.rayleigh.value = track(KEYS.rayleigh, p);
      u.mieDirectionalG.value = track(KEYS.mieG, p);
    }

    sun.position.copy(sunDir).multiplyScalar(160).add(sun.target.position);
    const si = track(KEYS.sun, p);
    sun.intensity = si;
    sun.color.setRGB(...track(KEYS.sunCol, p));

    hemi.intensity = track(KEYS.hemi, p);
    hemi.color.setRGB(...track(KEYS.hemiSky, p));
    hemi.groundColor.setRGB(...track(KEYS.hemiGnd, p));

    scene.environmentIntensity = track(KEYS.ibl, p);
    renderer.toneMappingExposure = track(KEYS.exposure, p);
    scene.fog.color.setRGB(...track(KEYS.fog, p));
    scene.fog.density = track(KEYS.fogDens, p);

    const ridgeCol = track(KEYS.ridge, p);
    ridges.forEach((r) => {
      tmpC.setRGB(...ridgeCol).lerp(scene.fog.color, r.haze);
      r.mesh.material.color.copy(tmpC);
    });

    state.night = range(p, 0.86, 0.985);
    state.sunIntensity = si;

    // Re-bake the reflections only when the light has changed noticeably.
    if (force || (Math.abs(p - lastEnvP) > 0.012 && time - lastEnvTime > 0.25)) {
      const next = pmrem.fromScene(envScene, 0, 0.1, 200);
      scene.environment = next.texture;
      if (envRT) envRT.dispose();
      envRT = next;
      lastEnvP = p;
      lastEnvTime = time;
    }
    return state;
  }

  return { group, update, sun, state };
}

function makeRidge(radius, minH, maxH, seed, haze) {
  const r = rng(seed);
  const waves = Array.from({ length: 7 }, (_, i) => ({ f: 2 + i * 2.7 + r() * 2, a: 1 / (1 + i * 0.9), ph: r() * Math.PI * 2 }));
  const a0 = deg(185), a1 = deg(355), seg = 220;
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    let h = 0, n = 0;
    for (const w of waves) { h += Math.abs(Math.sin(a * w.f + w.ph)) * w.a; n += w.a; }
    h = h / n;
    // taper towards the ends so the range sits naturally
    const edge = clamp(Math.min(i, seg - i) / 30);
    const y = (minH + (maxH - minH) * h) * (0.35 + 0.65 * edge);
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -20, z, x, y, z);
    if (i < seg) {
      const b = i * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ color: 0x8090a0, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = -1;
  return { mesh, haze };
}
