// Entry point: renderer, post-processing, world assembly and the scroll-driven render loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createUI } from './ui.js';
import { createEnvironment } from './world/environment.js';
import { createCity } from './world/city.js';
import { createSite, PIT } from './world/site.js';
import { createBuilding, STOREYS } from './world/building.js';
import { createMachines } from './world/machines.js';
import { evaluateCamera } from './camera.js';
import { T } from './timeline.js';
import { damp, lerp, range, clamp } from './lib/util.js';

const ui = createUI();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

async function start() {
  ui.setLoad(0.08);
  if (!hasWebGL2()) { ui.noWebGL(); return; }
  // Fonts are used inside canvas textures (site hoarding), so wait briefly for them.
  if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, wait(2500)]);

  const mobile = ui.isMobile() || matchMedia('(pointer: coarse)').matches;
  const quality = {
    dpr: Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75),
    shadowSize: mobile ? 1024 : 2048,
    samples: mobile ? 2 : 4,
  };

  const canvas = document.getElementById('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (err) {
    console.warn('WebGL unavailable', err);
    ui.noWebGL();
    return;
  }
  renderer.setPixelRatio(quality.dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.4, 6000);

  ui.setLoad(0.2); await nextFrame();
  const env = createEnvironment(renderer, scene, { quality });
  scene.add(env.group);
  ui.setLoad(0.32); await nextFrame();
  const city = createCity({ quality });
  scene.add(city.group);
  ui.setLoad(0.5); await nextFrame();
  const site = createSite({ quality });
  scene.add(site.group);
  ui.setLoad(0.62); await nextFrame();
  const building = createBuilding({ quality });
  scene.add(building.group);
  ui.setLoad(0.72); await nextFrame();
  const machines = createMachines({ site, building });
  scene.add(machines.group);

  // post-processing: HDR scene → bloom → tone mapping + sRGB
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.samples });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(quality.dpr);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.2, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ------------------------------------------------------------ world update
  const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  if (!mobile && !ui.reduced) {
    window.addEventListener('pointermove', (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  function updateWorld(p, time, dt) {
    const state = env.update(p, time);
    city.update(p, state);
    site.update(p, state);
    building.update(p, state);
    machines.update(p, time, dt, state);
    bloom.strength = lerp(0.12, 0.42, state.night);
    bloom.threshold = lerp(0.95, 0.8, state.night);
    bloom.radius = lerp(0.4, 0.6, state.night);

    evaluateCamera(p, cam);
    // gentle handheld drift + pointer parallax, in camera space
    fwd.subVectors(cam.target, cam.pos).normalize();
    right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP).normalize();
    up.crossVectors(right, fwd).normalize();
    pointer.sx = damp(pointer.sx, pointer.x, 2.5, dt);
    pointer.sy = damp(pointer.sy, pointer.y, 2.5, dt);
    const drift = ui.reduced ? 0 : 1;
    const ox = (pointer.sx * 1.6 + Math.sin(time * 0.21) * 0.35) * drift;
    const oy = (-pointer.sy * 0.8 + Math.sin(time * 0.17 + 1.3) * 0.22) * drift;
    camera.position.copy(cam.pos).addScaledVector(right, ox).addScaledVector(up, oy);
    camera.position.y = Math.max(camera.position.y, 1.6);
    camera.lookAt(cam.target);
    // keyframes are composed for ~16:10; widen the lens on portrait screens so the building stays in frame
    const fov = Math.min(72, cam.fov * (1 + 0.45 * Math.max(0, 1.6 / camera.aspect - 1)));
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    return state;
  }

  function hudInfo(p) {
    const s = range(p, ...T.structure);
    let elevation;
    if (s > 0) elevation = building.topAt(p);
    else if (p < T.raft[0]) elevation = -PIT.depth * Math.min(1, range(p, ...T.dig) * 1.15);
    else elevation = lerp(-PIT.depth, 0, range(p, T.raft[0], T.structure[0]));
    return { p, elevation, storeys: Math.min(STOREYS, Math.floor(s * STOREYS + 1e-6)), totalStoreys: STOREYS };
  }

  // Compile every material up front so nothing hitches mid-scroll.
  ui.setLoad(0.82); await nextFrame();
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (err) { console.warn('Shader precompile skipped', err); }
  hidden.forEach((o) => { o.visible = false; });

  // optional deep link for reviewing a moment: ?p=0.42
  const qp = new URLSearchParams(location.search).get('p');
  if (qp !== null && !Number.isNaN(Number(qp))) {
    const target = clamp(Number(qp));
    await nextFrame();
    window.scrollTo(0, (document.getElementById('journey').getBoundingClientRect().top + window.scrollY) + target * (document.getElementById('journey').offsetHeight - window.innerHeight));
  }

  let p = ui.targetProgress();
  let time = 0, last = performance.now();
  updateWorld(p, time, 0);
  env.update(p, time, true);
  composer.render();
  ui.update(hudInfo(p));
  ui.setLoad(1);
  await wait(250);
  ui.ready();

  // ------------------------------------------------------------ resize
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
  }
  window.addEventListener('resize', resize);

  // adaptive resolution: drop pixel ratio once if the device struggles
  let slowFrames = 0, measured = 0, downgraded = false;

  // ------------------------------------------------------------ loop
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (document.hidden || !ui.journeyVisible()) return;
    time += dt;
    const target = ui.targetProgress();
    p = ui.reduced ? target : damp(p, target, 4.2, dt);
    if (Math.abs(p - target) < 1e-5) p = target;
    updateWorld(p, time, dt);
    composer.render();
    ui.update(hudInfo(p));

    if (!downgraded && measured < 240) {
      measured++;
      if (measured > 30 && dt > 1 / 32) slowFrames++;
      if (slowFrames > 60) {
        downgraded = true;
        quality.dpr = 1;
        renderer.setPixelRatio(1);
        composer.setPixelRatio(1);
        resize();
      }
    }
  }
  requestAnimationFrame(frame);

  // exposed for automated visual checks
  window.__bsg = { setProgress: (v) => { p = clamp(v); updateWorld(p, time, 0); env.update(p, time, true); composer.render(); }, renderer };
}

start().catch((err) => {
  console.error(err);
  ui.noWebGL();
});
