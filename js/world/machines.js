// Plant on site: tracked excavator, articulated dump truck, flat-top tower crane, dust.
import * as THREE from 'three';
import { range, srange, smooth, clamp, lerp, track, rng } from '../lib/util.js';
import { latticeTexture, detailTexture } from '../lib/textures.js';
import { T } from '../timeline.js';
import { PIT } from './site.js';

const YELLOW = 0xd9a11e;

function follow(points, t) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    segs.push({ ax, az, bx, bz, len });
    total += len;
  }
  let d = clamp(t) * total;
  for (const s of segs) {
    if (d <= s.len || s === segs[segs.length - 1]) {
      const k = s.len > 0 ? clamp(d / s.len) : 0;
      return { x: lerp(s.ax, s.bx, k), z: lerp(s.az, s.bz, k), heading: Math.atan2(-(s.bz - s.az), s.bx - s.ax) };
    }
    d -= s.len;
  }
  return { x: points[0][0], z: points[0][1], heading: 0 };
}

const std = (color, rough = 0.55, metal = 0.25) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
};
const extrude = (pts, depth) => {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
};

// ---------------------------------------------------------------- excavator
function buildExcavator() {
  const paint = std(YELLOW, 0.45, 0.35);
  const dark = std(0x1b1c1e, 0.8, 0.3);
  const steel = std(0x3a3b3d, 0.45, 0.8);
  const chrome = std(0xd8d8d8, 0.15, 1);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1216, roughness: 0.05, metalness: 0.9 });

  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  for (const z of [-1.05, 1.05]) {
    mesh(new THREE.BoxGeometry(3.6, 0.82, 0.62), dark, chassis, 0, 0.41, z);
    for (const x of [-1.8, 1.8]) {
      const idler = mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.62, 18), dark, chassis, x, 0.41, z);
      idler.rotation.x = Math.PI / 2;
    }
    mesh(new THREE.BoxGeometry(3.0, 0.16, 0.66), steel, chassis, 0, 0.86, z);
  }
  mesh(new THREE.BoxGeometry(2.0, 0.45, 1.5), steel, chassis, 0, 0.9, 0);

  const house = new THREE.Group();
  house.position.y = 1.12;
  chassis.add(house);
  mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 24), steel, house, 0, 0.0, 0);
  mesh(new THREE.BoxGeometry(2.9, 1.0, 2.5), paint, house, -0.35, 0.6, 0);
  mesh(extrude([[0, 0], [0.9, 0], [0.9, 1.0], [0.15, 1.0], [0, 0.75]], 2.5), paint, house, -2.7, 0.1, 0);
  mesh(new THREE.BoxGeometry(1.5, 0.38, 1.4), paint, house, -1.0, 1.28, -0.45);
  mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), dark, house, -0.6, 1.6, -0.9); // exhaust
  // cab
  const cab = new THREE.Group();
  cab.position.set(0.55, 1.1, 0.68);
  house.add(cab);
  mesh(new THREE.BoxGeometry(1.0, 1.5, 0.95), glass, cab, 0, 0.75, 0);
  mesh(new THREE.BoxGeometry(1.06, 0.08, 1.0), paint, cab, 0, 1.52, 0);
  for (const [x, z] of [[0.49, 0.45], [0.49, -0.45], [-0.49, 0.45], [-0.49, -0.45]]) mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), paint, cab, x, 0.75, z);

  const boom = new THREE.Group();
  boom.position.set(1.0, 1.0, -0.2);
  house.add(boom);
  mesh(extrude([[0, 0.28], [2.9, 2.3], [5.7, 0.85], [5.7, 0.35], [2.9, 1.72], [0.05, -0.28]], 0.48), paint, boom);
  const cyl = mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.4, 10), chrome, boom, 4.1, 2.0, 0);
  cyl.rotation.z = 1.1;
  const barrel = mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 10), paint, boom, 3.4, 2.3, 0);
  barrel.rotation.z = 1.1;
  const boomCylA = mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.9, 10), paint, house, 1.15, 1.05, -0.62);
  const boomCylB = mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.9, 10), paint, house, 1.15, 1.05, 0.22);
  boomCylA.rotation.z = boomCylB.rotation.z = -0.9;

  const stick = new THREE.Group();
  stick.position.set(5.6, 0.6, 0);
  boom.add(stick);
  mesh(extrude([[-0.6, 0.25], [2.9, 0.15], [2.9, -0.15], [-0.6, -0.3]], 0.36), paint, stick);

  const bucket = new THREE.Group();
  bucket.position.set(2.85, 0, 0);
  stick.add(bucket);
  mesh(extrude([[0, 0.15], [0.25, -0.75], [0.95, -1.0], [1.15, -0.45], [0.75, 0.1]], 1.05), steel, bucket);
  for (let k = -2; k <= 2; k++) mesh(new THREE.BoxGeometry(0.22, 0.08, 0.1), dark, bucket, 1.22, -0.5, k * 0.22).rotation.z = 0.5;
  const dirt = mesh(new THREE.SphereGeometry(0.45, 10, 8), std(0x4a3626, 1, 0), bucket, 0.65, -0.35, 0);
  dirt.scale.set(1, 0.6, 1.2);

  return { root, chassis, house, boom, stick, bucket, dirt };
}

// dig cycle: [house yaw, boom, stick, bucket] — machine stands on the bench and backs away from the face
const DIG = [
  { p: 0.0, v: [0, -0.05, -0.9, -0.6] },
  { p: 0.16, v: [0, -0.5, -1.0, -0.4] },
  { p: 0.34, v: [0, -0.4, -1.9, -1.7] },
  { p: 0.46, v: [-0.4, 0.4, -1.8, -2.0] },
  { p: 0.62, v: [-1.57, 0.7, -1.75, -2.0] },
  { p: 0.72, v: [-1.57, 0.7, -1.6, -0.2] },
  { p: 0.84, v: [-0.5, 0.3, -1.2, -0.5] },
  { p: 1.0, v: [0, -0.05, -0.9, -0.6] },
];
const REST = [0, -0.25, -2.2, -2.0];

// ---------------------------------------------------------------- dump truck
function buildTruck() {
  const root = new THREE.Group();
  const paint = std(0xe8e4dc, 0.4, 0.3);
  const accent = std(0xc9a15f, 0.4, 0.6);
  const dark = std(0x18191b, 0.85, 0.2);
  const bed = std(0x3d3f42, 0.6, 0.6);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1216, roughness: 0.05, metalness: 0.9 });
  mesh(new THREE.BoxGeometry(8.2, 0.5, 1.4), dark, root, 0, 1.0, 0);
  mesh(new THREE.BoxGeometry(2.2, 2.3, 2.5), paint, root, 3.0, 2.15, 0);
  mesh(new THREE.BoxGeometry(0.08, 0.9, 2.2), glass, root, 4.11, 2.65, 0);
  mesh(new THREE.BoxGeometry(2.24, 0.1, 2.54), accent, root, 3.0, 1.2, 0);
  const bedG = new THREE.Group();
  bedG.position.set(-1.2, 1.3, 0);
  root.add(bedG);
  mesh(new THREE.BoxGeometry(5.6, 0.15, 2.5), bed, bedG, 0, 0.08, 0);
  mesh(new THREE.BoxGeometry(5.6, 1.4, 0.1), bed, bedG, 0, 0.8, 1.2);
  mesh(new THREE.BoxGeometry(5.6, 1.4, 0.1), bed, bedG, 0, 0.8, -1.2);
  mesh(new THREE.BoxGeometry(0.1, 1.6, 2.5), bed, bedG, 2.75, 0.9, 0);
  mesh(new THREE.BoxGeometry(0.1, 1.2, 2.5), bed, bedG, -2.75, 0.7, 0);
  const load = mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x4f3a29, 1, 0), bedG, 0, 0.15, 0);
  load.scale.set(2.5, 1.1, 1.1);
  for (const x of [3.0, -0.6, -2.4]) for (const z of [-1.1, 1.1]) {
    const w = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 18), dark, root, x, 0.55, z);
    w.rotation.x = Math.PI / 2;
  }
  return { root, load };
}

// ---------------------------------------------------------------- tower crane
function buildCrane() {
  const root = new THREE.Group();
  const base = latticeTexture();
  const latticeMat = (rx, ry) => {
    const t = base.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ color: YELLOW, map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 });
  };
  const paint = std(YELLOW, 0.45, 0.4);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9f9a92, map: detailTexture({ seed: 71, base: 0.85, amp: 0.15 }), roughness: 0.9 });
  const dark = std(0x1d1e20, 0.6, 0.5);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1216, roughness: 0.05, metalness: 0.9 });
  const redLight = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2a1a, emissiveIntensity: 0 });

  const pad = mesh(new THREE.BoxGeometry(5, 1.2, 5), concrete, root, 0, -0.45, 0);

  const mastMat = latticeMat(1, 1);
  const mast = mesh(new THREE.BoxGeometry(1.7, 1, 1.7).translate(0, 0.5, 0), mastMat, root);

  const top = new THREE.Group();
  root.add(top);
  mesh(new THREE.BoxGeometry(2.3, 0.9, 2.3), paint, top, 0, 0.45, 0);
  mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.35, 20), dark, top, 0, 1.05, 0);
  const cab = new THREE.Group();
  cab.position.set(0.9, 1.3, 1.55);
  top.add(cab);
  mesh(new THREE.BoxGeometry(1.7, 2.0, 1.25), paint, cab, 0, 1.0, 0);
  mesh(new THREE.BoxGeometry(1.2, 1.3, 1.28), glass, cab, 0.3, 1.1, 0);

  const jib = new THREE.Group();
  jib.position.y = 1.25;
  top.add(jib);
  const JIB = 42;
  mesh(new THREE.BoxGeometry(JIB, 1.6, 1.4).translate(JIB / 2, 0.8, 0), latticeMat(JIB / 1.6, 1), jib);
  mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), redLight, jib, JIB - 0.2, 1.8, 0);

  const cjib = new THREE.Group();
  cjib.position.y = 1.25;
  top.add(cjib);
  mesh(new THREE.BoxGeometry(13, 1.0, 1.8).translate(-6.5, 0.5, 0), latticeMat(13 / 1.0, 1), cjib);
  mesh(new THREE.BoxGeometry(13, 0.12, 2.0).translate(-6.5, 0.02, 0), std(0x6b6d70, 0.8, 0.5), cjib);
  for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(0.62, 2.3, 2.0), concrete, cjib, -12.4 + k * 0.66, -0.6, 0);
  mesh(new THREE.BoxGeometry(1.8, 1.2, 1.4), dark, cjib, -4.5, 0.7, 0); // hoist winch
  mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), redLight, top, 0, 3.2, 0);
  mesh(new THREE.BoxGeometry(0.3, 2.0, 0.3), paint, top, 0, 2.2, 0);

  const trolley = mesh(new THREE.BoxGeometry(1.3, 0.35, 1.3), dark, top, 10, 1.05, 0);
  const cableMat = std(0x111111, 0.6, 0.6);
  const cable = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, -0.5, 0), cableMat, top, 10, 1.0, 0);
  const hook = new THREE.Group();
  top.add(hook);
  mesh(new THREE.BoxGeometry(0.55, 0.8, 0.35), paint, hook, 0, -0.4, 0);
  mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 16, Math.PI * 1.4), dark, hook, 0, -0.95, 0);

  const load = new THREE.Group();
  hook.add(load);
  const slingMat = std(0x2c2c2c, 0.7, 0.2);
  for (const [x, z] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) {
    const len = Math.hypot(x, 2.0, z);
    const s = mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 4), slingMat, load, x / 2, -2.0, z / 2);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-x, 2.0, -z).normalize());
  }
  const panelA = mesh(new THREE.BoxGeometry(2.4, 0.5, 1.2), std(0xb9b2a4, 0.9, 0), load, 0, -3.25, 0);
  const panelB = mesh(new THREE.BoxGeometry(2.6, 0.12, 1.3), std(0x9a7b55, 0.9, 0), load, 0, -3.56, 0);

  return { root, pad, mast, mastMat, top, jib, cjib, trolley, cable, hook, load, redLight, panels: [panelA, panelB] };
}

// ---------------------------------------------------------------- dust
function buildDust(count = 220) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), alpha = new Float32Array(count), size = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0.62, 0.52, 0.42) }, uScale: { value: 600 } },
    vertexShader: `
      attribute float aAlpha; attribute float aSize; varying float vA;
      uniform float uScale;
      void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA;
      void main(){ vec2 c = gl_PointCoord - .5; float d = length(c); float a = smoothstep(.5, .0, d) * vA; if (a < .003) discard; gl_FragColor = vec4(uColor, a);
      #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const parts = Array.from({ length: count }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, s: 1 }));
  const r = rng(5);
  let cursor = 0;
  function emit(at, n, spread = 0.6) {
    for (let k = 0; k < n; k++) {
      const i = cursor = (cursor + 1) % count;
      const p = parts[i];
      p.life = p.max = 2.2 + r() * 2.2;
      p.vx = (r() - 0.5) * spread; p.vy = 0.25 + r() * 0.5; p.vz = (r() - 0.5) * spread;
      p.s = 1.2 + r() * 1.6;
      pos[i * 3] = at.x + (r() - 0.5) * 0.8; pos[i * 3 + 1] = at.y + r() * 0.3; pos[i * 3 + 2] = at.z + (r() - 0.5) * 0.8;
    }
  }
  function step(dt) {
    for (let i = 0; i < count; i++) {
      const p = parts[i];
      if (p.life <= 0) { alpha[i] = 0; continue; }
      p.life -= dt;
      const k = 1 - p.life / p.max;
      pos[i * 3] += (p.vx + 0.25) * dt; pos[i * 3 + 1] += p.vy * dt * (1 - k); pos[i * 3 + 2] += p.vz * dt;
      alpha[i] = Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.28;
      size[i] = p.s * (1 + k * 2.5);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }
  return { points, emit, step, mat };
}

// ================================================================= controller
export function createMachines({ site, building }) {
  const group = new THREE.Group();
  const ex = buildExcavator();
  const truck = buildTruck();
  const crane = buildCrane();
  const dust = buildDust();
  group.add(ex.root, truck.root, crane.root, dust.points);

  const CRANE = { x: -21.5, z: -6 };
  crane.root.position.set(CRANE.x, 0, CRANE.z);

  const tmp = new THREE.Vector3();
  // must match the dig front in site.js depthAt()
  const FRONT0 = PIT.x0 - PIT.slope - 4, FRONT1 = PIT.x1 + PIT.slope + 1;
  const EX_Z = -3, TRUCK_Z = -9;
  const PARK = [-25, 9.5];

  // Vehicles follow scroll-driven paths; heading is damped so they turn instead of snapping.
  function place(obj, x, z, heading, p, dt, length = 3.6) {
    if (obj.heading === undefined || dt <= 0) obj.heading = heading;
    else {
      const d = Math.atan2(Math.sin(heading - obj.heading), Math.cos(heading - obj.heading));
      obj.heading += d * (1 - Math.exp(-7 * dt));
    }
    const h = obj.heading;
    const fx = Math.cos(h), fz = -Math.sin(h);
    const yf = site.heightAt(x + fx * length / 2, z + fz * length / 2, p);
    const yb = site.heightAt(x - fx * length / 2, z - fz * length / 2, p);
    const y = site.heightAt(x, z, p);
    obj.root.position.set(x, Math.max(y, (yf + yb) / 2), z);
    obj.root.rotation.set(0, h, Math.atan2(yf - yb, length));
  }

  let lastCycle = -1, truckFill = 0;

  function update(p, time, dt, env) {
    // ---------------- excavator
    const dig = range(p, ...T.dig);
    const front = lerp(FRONT0, FRONT1, dig);
    const exX = front + 2.5;
    let pose = REST, digging = false;
    const exVisible = p >= 0.085 && p <= 0.83;
    if (!exVisible) ex.heading = undefined;
    else if (p < T.dig[0]) {
      const k = srange(p, 0.085, 0.125);
      const f = follow([[42, 32], [15, 32], [15, 22], [FRONT0 + 2.5, EX_Z]], k);
      place(ex, f.x, f.z, k >= 0.98 ? Math.PI : f.heading, p, dt);
    } else if (p <= T.dig[1]) {
      place(ex, exX, EX_Z, Math.PI, p, dt);
      digging = true;
    } else if (p < 0.78) {
      // wait for the truck to clear, then drive round the pit to the parking bay
      const k = srange(p, 0.295, 0.335);
      const f = follow([[FRONT1 + 2.5, EX_Z], [22.5, 12], [-20, 12.5], [PARK[0], PARK[1]]], k);
      place(ex, f.x, f.z, k >= 0.98 ? -Math.PI / 2 : f.heading, p, dt);
    } else {
      const k = srange(p, 0.78, 0.83);
      const f = follow([[PARK[0], PARK[1]], [-10, 12.5], [13, 20], [15, 24], [15, 32], [140, 32]], k);
      place(ex, f.x, f.z, f.heading, p, dt);
    }
    ex.root.visible = exVisible;

    if (digging) {
      const phase = (time * 0.11) % 1;
      pose = track(DIG, phase, smooth);
      const cycle = Math.floor(time * 0.11);
      ex.dirt.visible = phase > 0.3 && phase < 0.72;
      if (phase > 0.16 && phase < 0.34 && Math.random() < dt * 22) {
        ex.bucket.getWorldPosition(tmp);
        dust.emit(tmp, 2);
      }
      if (phase > 0.7 && phase < 0.8 && Math.random() < dt * 30) {
        ex.bucket.getWorldPosition(tmp);
        dust.emit(tmp, 2, 1.0);
      }
      if (cycle !== lastCycle) { lastCycle = cycle; truckFill = (truckFill + 1) % 6; }
    } else ex.dirt.visible = false;
    ex.house.rotation.y = pose[0];
    ex.boom.rotation.z = pose[1];
    ex.stick.rotation.z = pose[2];
    ex.bucket.rotation.z = pose[3];

    // ---------------- dump truck (loads beside the excavator, on undisturbed ground)
    const tv = p > 0.11 && p < 0.295;
    if (!tv) truck.heading = undefined;
    else {
      if (p < T.dig[0]) {
        const k = srange(p, 0.11, T.dig[0]);
        const f = follow([[70, 32], [15, 32], [15, 21], [-24, 21], [-25, TRUCK_Z], [FRONT0 + 2.5 + 1.2, TRUCK_Z]], k);
        place(truck, f.x, f.z, k >= 0.98 ? 0 : f.heading, p, dt, 7);
      } else if (p <= T.dig[1]) {
        place(truck, exX + 1.2, TRUCK_Z, 0, p, dt, 7);
      } else {
        const k = srange(p, T.dig[1], 0.295);
        const f = follow([[FRONT1 + 3.7, TRUCK_Z], [25, -9], [25, 12], [17, 19], [15, 24], [15, 32], [-160, 32]], k);
        place(truck, f.x, f.z, f.heading, p, dt, 7);
      }
      truck.load.scale.y = 0.2 + truckFill / 5;
      truck.load.visible = p > T.dig[0];
    }
    truck.root.visible = tv;

    // ---------------- tower crane
    const top = building.topAt(p);
    const hTarget = Math.max(36, top + 12);
    const up = srange(p, T.craneUp[0], T.craneUp[1] - 0.02);
    const fold = srange(p, T.craneDown[0], T.craneDown[0] + 0.03);
    const down = srange(p, T.craneDown[0] + 0.03, T.craneDown[1]);
    const H = Math.max(0.5, hTarget * up * (1 - down) + (down > 0 ? 3 * (1 - down) : 0));
    const craneVis = p > T.craneUp[0] && p < T.craneGone[0];
    crane.root.visible = p > T.craneUp[0] - 0.005 && p < T.craneGone[1];
    crane.pad.visible = crane.root.visible;
    crane.mast.visible = crane.top.visible = craneVis;
    crane.mast.scale.y = H;
    crane.mastMat.map.repeat.set(1, H / 1.7);
    crane.top.position.y = H;
    const jibK = srange(p, T.craneUp[1] - 0.02, T.craneUp[1]) * (1 - fold);
    crane.jib.scale.x = Math.max(0.001, jibK);
    crane.cjib.scale.x = Math.max(0.001, jibK);
    const working = jibK > 0.99;
    crane.trolley.visible = crane.cable.visible = crane.hook.visible = working;
    crane.redLight.emissiveIntensity = 2 + env.night * 10;

    if (working) {
      const deck = building.deckAt(p);
      const pick = new THREE.Vector2(-24 - CRANE.x, 2.6 - CRANE.z);
      const cycleT = time / 19;
      const cycleIdx = Math.floor(cycleT);
      const phase = cycleT - cycleIdx;
      const dropX = cycleIdx % 2 ? -9.4 : 9.4;
      const drop = new THREE.Vector2(dropX - CRANE.x, (cycleIdx % 4 < 2 ? -8 : -1) - CRANE.z);
      const angP = Math.atan2(-pick.y, pick.x), angD0 = Math.atan2(-drop.y, drop.x);
      let dA = angD0 - angP;
      dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      const angD = angP + dA;
      const rP = pick.length(), rD = drop.length();
      // hook block top sits 3.62 m above the underside of the load
      const pickY = 1.2 + 3.62, dropY = deck + 0.06 + 3.62, travel = Math.min(H - 1.2, Math.max(pickY, Math.max(top, deck) + 3.62) + 4.5);
      const K = [
        { p: 0, v: [angP, rP, travel, 0] },
        { p: 0.1, v: [angP, rP, pickY, 0] },
        { p: 0.17, v: [angP, rP, pickY, 1] },
        { p: 0.3, v: [angP, rP, travel, 1] },
        { p: 0.55, v: [angD, rD, travel, 1] },
        { p: 0.68, v: [angD, rD, dropY, 1] },
        { p: 0.74, v: [angD, rD, dropY, 0] },
        { p: 0.85, v: [angD, rD, travel, 0] },
        { p: 1, v: [angP, rP, travel, 0] },
      ];
      const [ang, rad, hookY, carry] = track(K, phase, smooth);
      crane.top.rotation.y = ang;
      crane.trolley.position.x = rad;
      crane.cable.position.x = rad;
      const len = Math.max(0.5, H + 1.0 - hookY);  // trolley underside is ~1.0 above the mast top
      crane.cable.scale.y = len;
      crane.hook.position.set(rad, hookY - H, 0);
      crane.hook.rotation.y = Math.sin(time * 0.6) * 0.15;
      crane.load.visible = carry > 0.5;
    } else {
      crane.top.rotation.y = lerp(crane.top.rotation.y, -0.6, 0.02);
    }

    dust.step(dt);
    dust.mat.uniforms.uColor.value.setRGB(0.62, 0.52, 0.42).multiplyScalar(0.4 + 0.6 * (1 - env.night));
  }

  return { group, update, dust };
}
