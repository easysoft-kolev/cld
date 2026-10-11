// The residential building: raft + basement, monolithic RC frame rising floor by floor,
// stone-and-glass facade with staggered balconies, penthouse, and interiors that light up at dusk.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { range, srange, clamp, lerp, rng } from '../lib/util.js';
import { detailTexture, netTexture } from '../lib/textures.js';
import { T } from '../timeline.js';
import { FOOT, PIT } from './site.js';

export const LV = [0, 4.2, 7.35, 10.5, 13.65, 16.8, 19.95, 23.1, 26.25, 29.65];
export const STOREYS = LV.length - 1; // 9 (ground + 7 typical + penthouse)
const SLAB = 0.3;
const PH = { x0: -9, x1: 9, z0: -10.5, z1: 0.5 };
const CORE = { x0: -2.5, x1: 2.5, z0: -7, z1: -1 };
const RAFT_TOP = -PIT.depth + 0.8;
const BAY = 2.6;

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

export function createBuilding({ quality }) {
  const group = new THREE.Group();
  const r = rng(101);

  const concreteTex = detailTexture({ seed: 50, cells: 8, base: 0.86, amp: 0.16, speckle: 0.08, repeat: [5, 5] });
  const concrete = () => new THREE.MeshStandardMaterial({ color: 0xa9a297, map: concreteTex, roughness: 0.94, envMapIntensity: 0.6 });
  const columnMat = concrete();
  const coreMat = concrete();
  const wallMat = concrete();
  const membraneMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.55, metalness: 0.1 });
  const rebarMat = new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.6, metalness: 0.55 });
  const plyMat = new THREE.MeshStandardMaterial({ color: 0xc98c43, roughness: 0.8 });
  const stoneTex = detailTexture({ seed: 61, cells: 5, base: 0.9, amp: 0.08, repeat: [2, 2] });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe2d8c6, map: stoneTex, roughness: 0.62, envMapIntensity: 0.7 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.38, metalness: 0.85 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x3c4a52, metalness: 0.7, roughness: 0.03, transparent: true, opacity: 0.92, envMapIntensity: 2.6,
    clearcoat: 1, clearcoatRoughness: 0.02,
  });
  const railGlassMat = new THREE.MeshPhysicalMaterial({ color: 0xd8ecf2, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.2 });
  const shadowing = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // ------------------------------------------------------------ foundations
  const fw = FOOT.x1 - FOOT.x0, fd = FOOT.z1 - FOOT.z0, fcx = (FOOT.x0 + FOOT.x1) / 2, fcz = (FOOT.z0 + FOOT.z1) / 2;
  const rebarGeoX = new THREE.CylinderGeometry(0.028, 0.028, fw + 0.6, 5).rotateZ(Math.PI / 2);
  const rebarGeoZ = new THREE.CylinderGeometry(0.028, 0.028, fd + 0.6, 5).rotateX(Math.PI / 2);
  const zs = [], xs = [];
  for (let z = FOOT.z0 - 0.25; z <= FOOT.z1 + 0.25; z += 0.4) zs.push(z);
  for (let x = FOOT.x0 - 0.25; x <= FOOT.x1 + 0.25; x += 0.4) xs.push(x);
  const rebarX = new THREE.InstancedMesh(rebarGeoX, rebarMat, zs.length);
  const rebarZ = new THREE.InstancedMesh(rebarGeoZ, rebarMat, xs.length);
  const m4 = new THREE.Matrix4();
  zs.forEach((z, i) => rebarX.setMatrixAt(i, m4.makeTranslation(fcx, -PIT.depth + 0.38, z)));
  xs.forEach((x, i) => rebarZ.setMatrixAt(i, m4.makeTranslation(x, -PIT.depth + 0.44, fcz)));
  group.add(rebarX, rebarZ);

  const raftMat = concrete();
  const raft = shadowing(new THREE.Mesh(new THREE.BoxGeometry(fw + 1, 0.8, fd + 1), raftMat));
  raft.position.set(fcx, -PIT.depth + 0.4, fcz);
  group.add(raft);

  const basement = new THREE.Group();
  const bwH = -SLAB - RAFT_TOP;
  const walls = mergeGeometries([
    box(fw, bwH, 0.3, fcx, bwH / 2, FOOT.z1 - 0.15),
    box(fw, bwH, 0.3, fcx, bwH / 2, FOOT.z0 + 0.15),
    box(0.3, bwH, fd - 0.6, FOOT.x0 + 0.15, bwH / 2, fcz),
    box(0.3, bwH, fd - 0.6, FOOT.x1 - 0.15, bwH / 2, fcz),
  ]);
  const wallMesh = shadowing(new THREE.Mesh(walls, wallMat));
  const membrane = new THREE.Mesh(mergeGeometries([
    box(fw + 0.08, bwH, 0.03, fcx, bwH / 2, FOOT.z1 + 0.015),
    box(fw + 0.08, bwH, 0.03, fcx, bwH / 2, FOOT.z0 - 0.015),
    box(0.03, bwH, fd, FOOT.x0 - 0.015, bwH / 2, fcz),
    box(0.03, bwH, fd, FOOT.x1 + 0.015, bwH / 2, fcz),
  ]), membraneMat);
  basement.add(wallMesh, membrane);
  basement.position.y = RAFT_TOP;
  group.add(basement);

  // ------------------------------------------------------------ frame
  const gridX = [-12.5, -6.25, 0, 6.25, 12.5], gridZ = [-11.5, -4, 3.5];
  const columns = [];
  const addCols = (level, y0, y1, filter) => {
    for (const x of gridX) for (const z of gridZ) {
      if (x > CORE.x0 && x < CORE.x1 && z > CORE.z0 && z < CORE.z1) continue;
      if (filter && !filter(x, z)) continue;
      columns.push({ level, x, z, y0, y1 });
    }
  };
  addCols(-1, RAFT_TOP, -SLAB);
  for (let i = 0; i < STOREYS - 1; i++) addCols(i, LV[i], LV[i + 1] - SLAB);
  const inPH = (x, z) => x > PH.x0 && x < PH.x1 && z > PH.z0 && z < PH.z1;
  addCols(STOREYS - 1, LV[8], LV[9] - SLAB, inPH);
  for (const [x, z] of [[PH.x0 + 0.4, PH.z0 + 0.4], [PH.x1 - 0.4, PH.z0 + 0.4], [PH.x0 + 0.4, PH.z1 - 0.4], [PH.x1 - 0.4, PH.z1 - 0.4]]) columns.push({ level: 8, x, z, y0: LV[8], y1: LV[9] - SLAB });
  const colGeo = new THREE.BoxGeometry(0.5, 1, 0.5).translate(0, 0.5, 0);
  const colMesh = shadowing(new THREE.InstancedMesh(colGeo, columnMat, columns.length));
  group.add(colMesh);

  const cores = [];
  for (let i = 0; i < STOREYS; i++) {
    const top = i === STOREYS - 1 ? LV[9] + 1.6 : LV[i + 1];
    const c = shadowing(new THREE.Mesh(new THREE.BoxGeometry(CORE.x1 - CORE.x0, 1, CORE.z1 - CORE.z0).translate(0, 0.5, 0), coreMat));
    c.position.set((CORE.x0 + CORE.x1) / 2, LV[i], (CORE.z0 + CORE.z1) / 2);
    c.userData.h = top - LV[i];
    group.add(c);
    cores.push(c);
  }

  // slabs: index 0 is the ground slab (top at 0), index i+1 is the slab on top of storey i
  const slabs = [];
  const slabRect = (k) => (k === STOREYS ? { x0: PH.x0 - 1.4, x1: PH.x1 + 1.4, z0: PH.z0 - 1.4, z1: PH.z1 + 1.4 } : FOOT);
  for (let k = 0; k <= STOREYS; k++) {
    const rc = slabRect(k);
    const w = rc.x1 - rc.x0, d = rc.z1 - rc.z0;
    const mat = concrete();
    const s = shadowing(new THREE.Mesh(new THREE.BoxGeometry(w, k === STOREYS ? 0.38 : SLAB, d), mat));
    s.userData = { x0: rc.x0, w, mat };
    s.position.set(rc.x0 + w / 2, LV[k] - SLAB / 2, (rc.z0 + rc.z1) / 2);
    const ply = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.05, d - 0.1), plyMat);
    ply.position.set(rc.x0 + w / 2, LV[k] - SLAB - 0.03, (rc.z0 + rc.z1) / 2);
    s.userData.ply = ply;
    group.add(s, ply);
    slabs.push(s);
  }

  // edge protection on the working deck
  const netTex = netTexture();
  netTex.repeat.set(30, 1.2);
  const netMat = new THREE.MeshStandardMaterial({ color: 0xf0c53a, map: netTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
  const net = new THREE.Group();
  const netH = 1.2;
  for (const [w, x, z, ry] of [[fw, fcx, FOOT.z1 + 0.05, 0], [fw, fcx, FOOT.z0 - 0.05, 0], [fd, FOOT.x0 - 0.05, fcz, Math.PI / 2], [fd, FOOT.x1 + 0.05, fcz, Math.PI / 2]]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(w, netH), netMat);
    pl.position.set(x, netH / 2, z);
    pl.rotation.y = ry;
    net.add(pl);
  }
  group.add(net);

  // ------------------------------------------------------------ envelope
  const faceGroups = []; // {group, level, order}
  const emitters = [];   // world-space interior light cards
  const sides = (rc) => [
    { o: [rc.x0, rc.z1], ry: 0, L: rc.x1 - rc.x0, side: 'S' },
    { o: [rc.x1, rc.z1], ry: Math.PI / 2, L: rc.z1 - rc.z0, side: 'E' },
    { o: [rc.x1, rc.z0], ry: Math.PI, L: rc.x1 - rc.x0, side: 'N' },
    { o: [rc.x0, rc.z0], ry: -Math.PI / 2, L: rc.z1 - rc.z0, side: 'W' },
  ];

  function buildFace(level, f, rc, kind) {
    const H = LV[level + 1] - LV[level];
    const parts = { stone: [], glass: [], metal: [], rail: [] };
    const { L } = f;
    const bandExt = f.side === 'S' || f.side === 'N' ? 0.16 : 0;
    const glassTop = H - SLAB - 0.04;

    if (kind === 'ground') {
      // lobby: recessed storefront glazing between stone-clad piers, entrance canopy on the street side
      parts.glass.push(box(L, glassTop, 0.04, L / 2, glassTop / 2, -0.9));
      for (let x = 0.4; x <= L - 0.39; x += 1.3) parts.metal.push(box(0.07, glassTop, 0.14, x, glassTop / 2, -0.85));
      const n = Math.round(L / 5.2);
      for (let k = 0; k <= n; k++) {
        const x = clamp(k * (L / n), 0.35, L - 0.35);
        parts.stone.push(box(0.7, H - SLAB, 0.7, x, (H - SLAB) / 2, -0.25));
      }
      parts.stone.push(box(L + bandExt * 2, 0.55, 0.3, L / 2, H - SLAB - 0.15, 0.0));
      if (f.side === 'S') {
        parts.stone.push(box(9, 0.32, 3.4, L / 2, 3.55, 1.5));
        parts.metal.push(box(9.04, 0.06, 3.44, L / 2, 3.37, 1.5));
      }
      for (let x = BAY / 2; x < L; x += BAY) emitters.push({ level, f, x, z: -2.6, y0: 0.15, y1: glassTop - 0.1, lobby: true });
    } else if (kind === 'typical') {
      parts.stone.push(box(L + bandExt * 2, 0.5, 0.18, L / 2, -0.09, 0.03));
      parts.glass.push(box(L, glassTop - 0.16, 0.04, L / 2, 0.16 + (glassTop - 0.16) / 2, -0.14));
      for (let x = 1.3; x < L - 0.1; x += 1.3) parts.metal.push(box(0.06, glassTop - 0.16, 0.16, x, 0.16 + (glassTop - 0.16) / 2, -0.08));
      const n = Math.round(L / 5.2);
      for (let k = 0; k <= n; k++) {
        const x = clamp(k * (L / n), 0.2, L - 0.2);
        parts.stone.push(box(k === 0 || k === n ? 0.4 : 0.32, glassTop, 0.5, x, glassTop / 2, 0.12));
      }
      if (f.side === 'S') {
        for (let b = 0; b < n; b++) {
          if ((b + level) % 2) continue;
          const cx = (b + 0.5) * (L / n), bw = L / n - 0.5;
          parts.stone.push(box(bw, 0.2, 1.75, cx, 0.06, 1.0));
          parts.rail.push(box(bw - 0.06, 1.0, 0.025, cx, 0.66, 1.85));
          parts.rail.push(box(0.025, 1.0, 1.6, cx - bw / 2 + 0.03, 0.66, 1.05));
          parts.rail.push(box(0.025, 1.0, 1.6, cx + bw / 2 - 0.03, 0.66, 1.05));
          parts.metal.push(box(bw, 0.05, 0.06, cx, 1.18, 1.85));
        }
      }
      for (let x = BAY / 2; x < L; x += BAY) emitters.push({ level, f, x, z: -1.6, y0: 0.2, y1: glassTop - 0.15 });
    } else if (kind === 'roof') {
      // main-roof terrace edge: slab band + glass balustrade
      parts.stone.push(box(L + bandExt * 2, 0.62, 0.18, L / 2, -0.03, 0.03));
      parts.rail.push(box(L, 1.05, 0.03, L / 2, 0.8, -0.05));
      parts.metal.push(box(L, 0.05, 0.07, L / 2, 1.33, -0.05));
    } else if (kind === 'penthouse') {
      parts.glass.push(box(L, glassTop, 0.04, L / 2, glassTop / 2, -0.1));
      for (let x = 1.5; x < L - 0.1; x += 1.5) parts.metal.push(box(0.05, glassTop, 0.12, x, glassTop / 2, -0.05));
      parts.metal.push(box(0.14, glassTop, 0.14, 0.07, glassTop / 2, -0.05));
      for (let x = BAY / 2; x < L; x += BAY) emitters.push({ level, f, x, z: -1.8, y0: 0.15, y1: glassTop - 0.1 });
    }

    const g = new THREE.Group();
    g.position.set(f.o[0], LV[level], f.o[1]);
    g.rotation.y = f.ry;
    const add = (list, mat, cast = true) => {
      if (!list.length) return;
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = cast; mesh.receiveShadow = true;
      g.add(mesh);
    };
    add(parts.stone, stoneMat);
    add(parts.metal, metalMat);
    add(parts.glass, glassMat, false);
    add(parts.rail, railGlassMat, false);
    group.add(g);
    return g;
  }

  for (let level = 0; level < STOREYS; level++) {
    const kind = level === 0 ? 'ground' : level === STOREYS - 1 ? 'penthouse' : 'typical';
    sides(FOOT).forEach((f, order) => {
      if (kind === 'penthouse') faceGroups.push({ group: buildFace(level, f, FOOT, 'roof'), level, order });
      else faceGroups.push({ group: buildFace(level, f, FOOT, kind), level, order });
    });
    if (kind === 'penthouse') sides(PH).forEach((f, order) => faceGroups.push({ group: buildFace(level, f, PH, 'penthouse'), level, order }));
  }

  // rooftop plant
  const plant = new THREE.Group();
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.5, metalness: 0.6 });
  for (const [x, z, w, d] of [[-5.5, -7.5, 3.2, 2], [5.5, -7.5, 3.2, 2], [5.5, -3.5, 2, 1.6]]) {
    const u = shadowing(new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), plantMat));
    u.position.set(x, LV[9] + 0.7, z);
    plant.add(u);
  }
  const pvMat = new THREE.MeshStandardMaterial({ color: 0x141b2a, roughness: 0.15, metalness: 0.6 });
  for (let k = 0; k < 4; k++) {
    const pv = shadowing(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 3.4), pvMat));
    pv.position.set(-7 + k * 2, LV[9] + 0.55, -1.5);
    pv.rotation.x = -0.25;
    plant.add(pv);
  }
  group.add(plant);

  // interior light cards (one instanced mesh for the whole building)
  const cardGeo = new THREE.PlaneGeometry(1, 1);
  const cardMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const cards = new THREE.InstancedMesh(cardGeo, cardMat, emitters.length);
  const col = new THREE.Color();
  emitters.forEach((e, i) => {
    const roll = r();
    if (e.lobby) col.setRGB(1, 0.78, 0.52).multiplyScalar(1.3);
    else if (roll < 0.22) col.setRGB(0.03, 0.03, 0.035);
    else if (roll < 0.34) col.setRGB(0.75, 0.82, 1).multiplyScalar(0.55 + r() * 0.3);
    else col.setRGB(1, 0.72 + r() * 0.1, 0.42 + r() * 0.12).multiplyScalar(0.55 + r() * 0.5);
    cards.setColorAt(i, col);
    // world transform: face origin + local offset, facing outward
    const o = new THREE.Object3D();
    o.position.set(e.f.o[0], LV[e.level], e.f.o[1]);
    o.rotation.y = e.f.ry;
    o.updateMatrix();
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(e.x, (e.y0 + e.y1) / 2, e.z), new THREE.Quaternion(), new THREE.Vector3(BAY - 0.15, e.y1 - e.y0, 1),
    );
    e.matrix = o.matrix.clone().multiply(local);
  });
  cards.instanceColor.needsUpdate = true;
  group.add(cards);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  // ------------------------------------------------------------ update
  const fresh = new THREE.Color(0x67625b), cured = new THREE.Color(0xa9a297);
  const lastLevelLit = new Array(STOREYS).fill(-1);

  function update(p, env) {
    // foundations
    const rb = range(p, ...T.rebar);
    const showRebar = p > T.rebar[0] && p < T.raft[1] + 0.01;
    rebarX.visible = rebarZ.visible = showRebar;
    rebarX.count = Math.max(0, Math.round(zs.length * clamp(rb * 2)));
    rebarZ.count = Math.max(0, Math.round(xs.length * clamp(rb * 2 - 1)));

    const rf = range(p, ...T.raft);
    raft.visible = rf > 0;
    raft.scale.x = Math.max(0.001, rf);
    raft.position.x = FOOT.x0 - 0.5 + (fw + 1) * raft.scale.x / 2;
    raftMat.color.copy(fresh).lerp(cured, range(p, T.raft[1], T.basement[1]));

    const bw = srange(p, T.basement[0], T.basement[1] - 0.008);
    basement.visible = bw > 0;
    wallMesh.scale.y = Math.max(0.001, bw);
    membrane.visible = p > T.basement[1] - 0.01;
    wallMat.color.copy(fresh).lerp(cured, range(p, T.basement[1], 0.43));

    // frame
    const s = range(p, ...T.structure);
    const levelT = (lvl) => (lvl < 0 ? range(p, T.basement[0], T.basement[1]) : clamp(s * STOREYS - lvl));
    columns.forEach((c, i) => {
      const t = srange(levelT(c.level), 0, 0.5);
      if (t <= 0) { colMesh.setMatrixAt(i, zero); return; }
      m4.makeScale(1, (c.y1 - c.y0) * t, 1).setPosition(c.x, c.y0, c.z);
      colMesh.setMatrixAt(i, m4);
    });
    colMesh.instanceMatrix.needsUpdate = true;
    columnMat.color.copy(fresh).lerp(cured, clamp(s * 1.6));

    cores.forEach((c, i) => {
      const t = srange(levelT(i), 0, 0.42);
      c.visible = t > 0;
      c.scale.y = Math.max(0.001, c.userData.h * t);
    });
    coreMat.color.copy(fresh).lerp(cured, clamp(s * 1.6));

    slabs.forEach((sl, k) => {
      // ground slab is poured as part of the foundation stage
      const t = k === 0 ? range(p, T.backfill[0] + 0.005, T.backfill[1]) : range(levelT(k - 1), 0.5, 1);
      sl.visible = t > 0;
      sl.scale.x = Math.max(0.001, t);
      sl.position.x = sl.userData.x0 + sl.userData.w * sl.scale.x / 2;
      const age = k === 0 ? range(p, T.backfill[1], 0.45) : clamp((s * STOREYS - k) / 1.5);
      sl.userData.mat.color.copy(fresh).lerp(cured, age);
      const ply = sl.userData.ply;
      const lt = k === 0 ? 0 : levelT(k - 1);
      ply.visible = k > 0 && lt > 0.42 && s * STOREYS < k + 1.2 && s < 1;
    });

    const working = Math.min(STOREYS - 1, Math.floor(s * STOREYS));
    net.visible = s > 0 && s < 1 && p < 0.66;
    net.position.y = LV[working];

    // envelope
    const e = range(p, ...T.envelope);
    const levelF = (lvl) => clamp((e * (STOREYS + 1.5) - lvl) / 1.5);
    faceGroups.forEach((fg) => {
      const t = srange(levelF(fg.level), fg.order * 0.15, fg.order * 0.15 + 0.55);
      fg.group.visible = t > 0;
      fg.group.scale.y = Math.max(0.001, t);
    });
    plant.visible = levelF(STOREYS - 1) > 0.6;

    // interiors appear once a storey is glazed; they glow after sunset
    let dirty = false;
    for (let lvl = 0; lvl < STOREYS; lvl++) {
      const lit = levelF(lvl) > 0.7 ? 1 : 0;
      if (lit !== lastLevelLit[lvl]) { lastLevelLit[lvl] = lit; dirty = true; }
    }
    if (dirty) {
      emitters.forEach((em, i) => cards.setMatrixAt(i, lastLevelLit[em.level] ? em.matrix : zero));
      cards.instanceMatrix.needsUpdate = true;
    }
    const lights = srange(p, ...T.lights);
    cardMat.color.setScalar(lerp(0.075, 2.1, lights));
    glassMat.opacity = lerp(0.9, 0.5, lights);
    glassMat.envMapIntensity = lerp(2.6, 1.4, lights);
  }

  return { group, update, topAt, deckAt };

  /** Elevation of the deck the crane is currently landing material on. */
  function deckAt(p) {
    const s = range(p, ...T.structure);
    if (s <= 0) return p < T.backfill[1] ? RAFT_TOP : 0;
    return LV[Math.min(STOREYS, Math.floor(s * STOREYS))];
  }

  /** Highest built elevation for the crane to work above. */
  function topAt(p) {
    const s = range(p, ...T.structure);
    const k = clamp(s * STOREYS, 0, STOREYS);
    const i = Math.floor(k);
    return i >= STOREYS ? LV[STOREYS] : lerp(LV[i], LV[i + 1], k - i);
  }
}
