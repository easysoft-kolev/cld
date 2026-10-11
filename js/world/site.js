// The plot itself: terrain that is stripped, excavated and backfilled, site hoarding,
// survey stakes, site offices, spoil heap, material laydown and final landscaping.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { range, srange, smooth, clamp, lerp, rng } from '../lib/util.js';
import { detailTexture, hoardingTexture, paverTexture } from '../lib/textures.js';
import { T } from '../timeline.js';
import { PLOT } from './city.js';
import { createTrees, leafTint } from './trees.js';

export const FOOT = { x0: -13, x1: 13, z0: -12, z1: 4 };
export const PIT = { x0: -15, x1: 15, z0: -14, z1: 6, slope: 2.6, depth: 4.5 };
const FENCE = { x0: -28, x1: 28, z0: -23, z1: 23, gate: [10, 20], h: 2.4 };

const COL = {
  grass: [0.13, 0.16, 0.07],
  site: [0.3, 0.235, 0.17],
  clay: [0.4, 0.27, 0.17],
  deep: [0.26, 0.18, 0.12],
  lawn: [0.12, 0.19, 0.06],
};

export function createSite({ quality }) {
  const group = new THREE.Group();
  const r = rng(77);

  // ---------- terrain
  const SEG_X = (PLOT.x1 - PLOT.x0) * 2, SEG_Z = (PLOT.z1 - PLOT.z0) * 2; // 0.5 m grid
  const geo = new THREE.PlaneGeometry(PLOT.x1 - PLOT.x0, PLOT.z1 - PLOT.z0, SEG_X, SEG_Z);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 24, uv.getY(i) * 20);
  const baseX = new Float32Array(pos.count), baseZ = new Float32Array(pos.count), vari = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    baseX[i] = x; baseZ[i] = z;
    vari[i] = 0.93 + 0.07 * Math.sin(x * 0.37 + Math.sin(z * 0.21) * 2) * Math.sin(z * 0.29 + 1.3) + 0.03 * Math.sin(x * 1.7 + z * 1.3);
  }
  const terrainTex = detailTexture({ seed: 15, cells: 16, octaves: 4, base: 0.86, amp: 0.13, speckle: 0.03, repeat: [1, 1] });
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: terrainTex, roughness: 1 }));
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  group.add(terrain);

  const inFoot = (x, z) => x > FOOT.x0 + 1e-3 && x < FOOT.x1 - 1e-3 && z > FOOT.z0 + 1e-3 && z < FOOT.z1 - 1e-3;
  const terrainState = { dig: -1, back: -1, strip: -1, land: -1 };

  /** Excavation depth (positive, metres) at a point for the given dig/backfill progress. */
  function depthAt(x, z, dig, back) {
    const dx = Math.max(PIT.x0 - x, 0, x - PIT.x1);
    const dz = Math.max(PIT.z0 - z, 0, z - PIT.z1);
    const slopeF = clamp(1 - Math.hypot(dx, dz) / PIT.slope);
    if (slopeF <= 0 || dig <= 0) return 0;
    const front = lerp(PIT.x0 - PIT.slope - 4, PIT.x1 + PIT.slope + 1, dig);
    const dug = smooth(clamp((front - x) / 6));
    let d = PIT.depth * slopeF * dug;
    if (!inFoot(x, z)) d *= 1 - back;
    return d;
  }

  function updateTerrain(p) {
    const dig = range(p, ...T.dig), back = srange(p, ...T.backfill), strip = srange(p, ...T.strip), land = srange(p, ...T.landscape);
    const s = terrainState;
    if (Math.abs(dig - s.dig) < 1e-4 && Math.abs(back - s.back) < 1e-4 && Math.abs(strip - s.strip) < 1e-4 && Math.abs(land - s.land) < 1e-4) return;
    Object.assign(s, { dig, back, strip, land });
    for (let i = 0; i < pos.count; i++) {
      const x = baseX[i], z = baseZ[i];
      const d = depthAt(x, z, dig, back);
      pos.setY(i, -d);
      // colour
      const fenceEdge = Math.min(x - FENCE.x0, FENCE.x1 - x, z - FENCE.z0, FENCE.z1 - z);
      const inside = smooth(clamp(fenceEdge / 1.5 + 0.5));
      const k = strip * inside;
      let cr = lerp(COL.grass[0], COL.site[0], k), cg = lerp(COL.grass[1], COL.site[1], k), cb = lerp(COL.grass[2], COL.site[2], k);
      const dr = clamp(d / PIT.depth);
      if (dr > 0) {
        const wall = lerp(COL.clay[0], COL.deep[0], dr), wallG = lerp(COL.clay[1], COL.deep[1], dr), wallB = lerp(COL.clay[2], COL.deep[2], dr);
        const kk = clamp(dr * 3);
        cr = lerp(cr, wall, kk); cg = lerp(cg, wallG, kk); cb = lerp(cb, wallB, kk);
      }
      if (land > 0 && !inFoot(x, z)) {
        const l = land * (0.9 + 0.1 * Math.sin(x * 0.8 + z));
        cr = lerp(cr, COL.lawn[0], l); cg = lerp(cg, COL.lawn[1], l); cb = lerp(cb, COL.lawn[2], l);
      }
      const v = vari[i];
      colors[i * 3] = cr * v; colors[i * 3 + 1] = cg * v; colors[i * 3 + 2] = cb * v;
    }
    pos.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  function heightAt(x, z, p) {
    if (x < PLOT.x0 || x > PLOT.x1 || z < PLOT.z0 || z > PLOT.z1) return 0;
    return -depthAt(x, z, range(p, ...T.dig), srange(p, ...T.backfill));
  }

  // ---------- site hoarding (printed panels with a truck gate)
  const fence = new THREE.Group();
  const hoardTex = hoardingTexture();
  const fenceMat = new THREE.MeshStandardMaterial({ map: hoardTex, roughness: 0.7, metalness: 0.1 });
  const panelLen = 19.2;
  const fenceSeg = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const g = new THREE.BoxGeometry(len, FENCE.h, 0.08);
    const u = g.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setX(i, u.getX(i) * len / panelLen);
    const m = new THREE.Mesh(g, fenceMat);
    m.position.set((x0 + x1) / 2, FENCE.h / 2, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    m.castShadow = true; m.receiveShadow = true;
    fence.add(m);
  };
  fenceSeg(FENCE.x0, FENCE.z1, FENCE.gate[0], FENCE.z1);
  fenceSeg(FENCE.gate[1], FENCE.z1, FENCE.x1, FENCE.z1);
  fenceSeg(FENCE.x1, FENCE.z1, FENCE.x1, FENCE.z0);
  fenceSeg(FENCE.x1, FENCE.z0, FENCE.x0, FENCE.z0);
  fenceSeg(FENCE.x0, FENCE.z0, FENCE.x0, FENCE.z1);
  // gate posts
  const postMat = new THREE.MeshStandardMaterial({ color: 0xc9a15f, roughness: 0.4, metalness: 0.7 });
  for (const gx of FENCE.gate) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, FENCE.h + 0.4, 0.25), postMat);
    post.position.set(gx, (FENCE.h + 0.4) / 2, FENCE.z1);
    post.castShadow = true;
    fence.add(post);
  }
  group.add(fence);

  // ---------- survey: stakes, string lines, total station
  const survey = new THREE.Group();
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.8 });
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xe0562a, roughness: 0.6 });
  const corners = [[FOOT.x0, FOOT.z0], [FOOT.x1, FOOT.z0], [FOOT.x1, FOOT.z1], [FOOT.x0, FOOT.z1]];
  const off = 2.2;
  corners.forEach(([x, z]) => {
    const sx = Math.sign(x) * off, sz = (z > -4 ? 1 : -1) * off;
    for (const [px, pz] of [[x + sx, z], [x, z + sz], [x + sx * 0.6, z + sz * 0.6]]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), stakeMat);
      st.position.set(px, 0.5, pz);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.1), tipMat);
      tip.position.set(px, 1.02, pz);
      st.castShadow = true;
      survey.add(st, tip);
    }
  });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const string = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.015, 0.015), lineMat);
    m.position.set((x0 + x1) / 2, 0.85, (z0 + z1) / 2);
    m.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    survey.add(m);
  };
  string(FOOT.x0 - off, FOOT.z0, FOOT.x1 + off, FOOT.z0);
  string(FOOT.x0 - off, FOOT.z1, FOOT.x1 + off, FOOT.z1);
  string(FOOT.x0, FOOT.z0 - off, FOOT.x0, FOOT.z1 + off);
  string(FOOT.x1, FOOT.z0 - off, FOOT.x1, FOOT.z1 + off);
  // total station on tripod
  const tripod = new THREE.Group();
  const legMat = new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.5, metalness: 0.3 });
  for (let k = 0; k < 3; k++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.65, 6), legMat);
    const a = (k / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.3, 0.78, Math.sin(a) * 0.3);
    leg.rotation.set(Math.sin(a) * 0.36, 0, -Math.cos(a) * 0.36);
    leg.castShadow = true;
    tripod.add(leg);
  }
  const inst = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.18), new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.4 }));
  inst.position.y = 1.72;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.5 }));
  lens.rotation.z = Math.PI / 2; lens.position.y = 1.76;
  tripod.add(inst, lens);
  tripod.position.set(7, 0, 12);
  tripod.rotation.y = 2.4;
  survey.add(tripod);
  group.add(survey);

  // ---------- site office containers
  const cabins = new THREE.Group();
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.35 });
  const cabinTrim = new THREE.MeshStandardMaterial({ color: 0xc9a15f, roughness: 0.4, metalness: 0.6 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x0e1418, roughness: 0.08, metalness: 0.9 });
  for (let level = 0; level < 2; level++) {
    for (let k = 0; k < 2; k++) {
      if (level === 1 && k === 1) continue;
      const c = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(6.06, 2.6, 2.44), cabinMat);
      body.position.y = 1.3;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(6.08, 0.12, 2.46), cabinTrim);
      trim.position.y = 2.45;
      c.add(body, trim);
      for (const wx of [-1.8, 0, 1.8]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.05), winMat);
        w.position.set(wx, 1.5, 1.23);
        c.add(w);
      }
      c.position.set(0, level * 2.62, k * 2.6);
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      cabins.add(c);
    }
  }
  cabins.position.set(-22, 0, 16);
  cabins.rotation.y = 0.0;
  group.add(cabins);

  // ---------- spoil heap
  const heapGeo = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  {
    const hp = heapGeo.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
      const n = 1 + 0.12 * Math.sin(x * 7 + z * 3) + 0.08 * Math.sin(z * 11 - x * 5);
      hp.setXYZ(i, x * n, Math.pow(y, 0.8) * n, z * n);
    }
    heapGeo.computeVertexNormals();
  }
  const heap = new THREE.Mesh(heapGeo, new THREE.MeshStandardMaterial({ color: 0x5e4433, map: terrainTex, roughness: 1 }));
  heap.position.set(-21, 0, -19);
  heap.castShadow = heap.receiveShadow = true;
  group.add(heap);

  // ---------- laydown: rebar bundles, block pallets, formwork panels
  const laydown = new THREE.Group();
  const rebarMat = new THREE.MeshStandardMaterial({ color: 0x5a3b2a, roughness: 0.7, metalness: 0.6 });
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.9 });
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.95 });
  const plyMat = new THREE.MeshStandardMaterial({ color: 0xc58a3f, roughness: 0.75 });
  for (let k = 0; k < 3; k++) {
    const bundle = new THREE.Mesh(new THREE.BoxGeometry(6, 0.35, 0.6), rebarMat);
    bundle.position.set(0, 0.35 + 0.0, k * 0.9);
    const sl = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.18, 0.12), palletMat);
    sl.position.set(0, 0.09, k * 0.9);
    laydown.add(bundle, sl);
  }
  for (let k = 0; k < 4; k++) {
    const pal = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 1.0), palletMat);
    const blk = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.0, 0.95), blockMat);
    pal.position.set(-2 + k * 1.5, 0.07, 3.6);
    blk.position.set(-2 + k * 1.5, 0.64, 3.6);
    laydown.add(pal, blk);
  }
  for (let k = 0; k < 6; k++) {
    const ply = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.05, 1.25), plyMat);
    ply.position.set(4.2, 0.1 + k * 0.06, 3.4);
    laydown.add(ply);
  }
  laydown.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  laydown.position.set(-24, 0, 1);
  group.add(laydown);

  // ---------- landscaping
  const land = new THREE.Group();
  const paveTex = paverTexture();
  const paveMat = new THREE.MeshStandardMaterial({ color: 0xd7d0c4, map: paveTex, roughness: 0.85 });
  const paves = [];
  const pave = (x0, z0, x1, z1) => {
    const w = x1 - x0, d = z1 - z0;
    const g = new THREE.BoxGeometry(w, 0.12, d);
    const u = g.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) * w / 2.4, u.getY(i) * d / 2.4);
    g.translate((x0 + x1) / 2, 0.0, (z0 + z1) / 2);
    paves.push(g);
  };
  pave(-8, FOOT.z1, 8, PLOT.z1);                 // entrance plaza
  pave(FOOT.x0 - 2, FOOT.z1, -8, FOOT.z1 + 2);   // perimeter band
  pave(8, FOOT.z1, FOOT.x1 + 2, FOOT.z1 + 2);
  pave(FOOT.x0 - 2, FOOT.z0 - 2, FOOT.x0, FOOT.z1);
  pave(FOOT.x1, FOOT.z0 - 2, FOOT.x1 + 2, FOOT.z1);
  pave(FOOT.x0 - 2, FOOT.z0 - 2, FOOT.x1 + 2, FOOT.z0);
  pave(FOOT.x1 + 2, -2, PLOT.x1, 2);             // side path to the east street
  const paving = new THREE.Mesh(mergeGeometries(paves), paveMat);
  paving.receiveShadow = true;
  land.add(paving);

  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x2b3d1c, map: detailTexture({ seed: 33, cells: 10, base: 0.7, amp: 0.35, repeat: [2, 1] }), roughness: 1 });
  const hedges = [];
  for (const side of [-1, 1]) {
    for (const [z0, z1] of [[FOOT.z1 + 3, 13], [15.5, PLOT.z1 - 1.5]]) {
      const g = new THREE.BoxGeometry(0.9, 0.8, z1 - z0);
      g.translate(side * 8.9, 0.4, (z0 + z1) / 2);
      hedges.push(g);
    }
  }
  const hedge = new THREE.Mesh(mergeGeometries(hedges), hedgeMat);
  hedge.castShadow = hedge.receiveShadow = true;
  land.add(hedge);

  // planters with water feature in the plaza
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.6 });
  const basin = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 3.2), stoneMat);
  basin.position.set(0, 0.25, 15.5);
  const water = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.05, 2.6), new THREE.MeshStandardMaterial({ color: 0x0b1a22, roughness: 0.02, metalness: 0.9 }));
  water.position.set(0, 0.47, 15.5);
  basin.castShadow = basin.receiveShadow = true;
  land.add(basin, water);

  // bollard lights
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.5, metalness: 0.6 });
  const bollardHead = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd2a0, emissiveIntensity: 0 });
  const bollards = [];
  for (const side of [-1, 1]) for (const z of [7.5, 11.5, 19, 23]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 10), bollardMat);
    b.position.set(side * 7.6, 0.45, z);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.14, 10), bollardHead);
    h.position.set(side * 7.6, 0.83, z);
    land.add(b, h);
    bollards.push(h);
  }
  const plazaLights = [];
  for (const [x, z] of [[-5, 9], [5, 9], [-5, 20], [5, 20]]) {
    const l = new THREE.PointLight(0xffc68a, 0, 16, 2);
    l.position.set(x, 1.4, z);
    land.add(l);
    plazaLights.push(l);
  }
  group.add(land);

  // site trees: two avenues along the plaza and specimen trees around the building
  const treeSpots = [];
  for (const side of [-1, 1]) {
    for (const z of [8, 13.5, 19, 23.5]) treeSpots.push([side * 11.5, z]);
    treeSpots.push([side * 18, -16], [side * 23, -10], [side * 21, 2], [side * 24, 12], [side * 17.5, 20]);
  }
  treeSpots.push([-6, -18], [6, -19], [0, -21.5]);
  const siteTreeItems = treeSpots.map(([x, z]) => ({ x, z, s: 0.85 + r() * 0.3, rot: r() * 6.28, tint: leafTint(r) }));
  const siteTrees = createTrees(siteTreeItems, { seed: 6 });
  group.add(siteTrees.group);
  const growth = siteTreeItems.map(() => 0);
  const treeDelays = siteTreeItems.map(() => r() * 0.5);

  // ---------- per-frame update
  let lastLand = -1;
  function update(p, env) {
    updateTerrain(p);

    const fUp = srange(p, ...T.fence), fDown = srange(p, ...T.fenceDown);
    const fenceVis = fUp * (1 - fDown);
    fence.visible = fenceVis > 0.001;
    fence.position.y = (fenceVis - 1) * (FENCE.h + 0.5);

    const st = srange(p, ...T.stakes) * (1 - srange(p, 0.125, 0.145));
    survey.visible = st > 0.001;
    survey.scale.set(1, Math.max(0.001, st), 1);

    const cIn = srange(p, ...T.cabins), cOut = srange(p, 0.795, 0.825);
    cabins.visible = cIn > 0.001 && cOut < 0.999;
    cabins.position.y = (1 - cIn) * 9 - cOut * 5.6;
    cabins.scale.setScalar(Math.max(0.001, Math.min(1, cIn * 4)));

    const dig = range(p, ...T.dig);
    const heapK = Math.min(dig * 1.15, 1) * (1 - 0.6 * srange(p, ...T.backfill)) * (1 - srange(p, 0.78, 0.82));
    heap.visible = heapK > 0.01;
    heap.scale.set(5 * Math.sqrt(heapK) + 0.01, 3.4 * heapK + 0.01, 3.8 * Math.sqrt(heapK) + 0.01);
    heap.position.y = -0.1;

    const ld = srange(p, 0.3, 0.34) * (1 - srange(p, 0.78, 0.81));
    laydown.visible = ld > 0.001;
    laydown.scale.set(1, Math.max(0.001, ld), 1);

    const lt = range(p, ...T.landscape);
    land.visible = lt > 0;
    paving.position.y = lerp(-0.2, 0.04, srange(lt, 0.0, 0.35));
    hedge.scale.y = Math.max(0.001, srange(lt, 0.35, 0.8));
    basin.visible = water.visible = lt > 0.3;
    basin.scale.y = water.scale.y = Math.max(0.001, srange(lt, 0.3, 0.6));
    if (Math.abs(lt - lastLand) > 1e-4) {
      for (let i = 0; i < growth.length; i++) growth[i] = smooth(clamp((lt - 0.25 - treeDelays[i] * 0.5) / 0.4));
      siteTrees.setGrowth(growth);
      lastLand = lt;
    }
    siteTrees.group.visible = lt > 0.25;
    bollardHead.emissiveIntensity = env.night * 8;
    plazaLights.forEach((l) => { l.intensity = env.night * 30; });
  }

  return { group, update, heightAt };
}
