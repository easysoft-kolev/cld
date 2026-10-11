// Surrounding Sofia-style urban context: ground, street grid, neighbouring blocks,
// street trees and lamps. Anything that would block a camera sight line is dropped.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../lib/util.js';
import { detailTexture, cityFacadeTextures, roadTexture } from '../lib/textures.js';
import { sightLines } from '../camera.js';
import { createTrees, leafTint } from './trees.js';

export const PLOT = { x0: -30, x1: 30, z0: -25, z1: 25 };
const BLOCK = { hx: 32, hz: 27 };
const PITCH = { x: 74, z: 64 };
const ROAD_W = 10;
const RANGE = 3;

export function createCity({ quality }) {
  const group = new THREE.Group();
  const r = rng(42);
  const lines = sightLines();
  const ray = new THREE.Ray();
  const box = new THREE.Box3();
  const hit = new THREE.Vector3();

  const blocksView = (minX, minY, minZ, maxX, maxY, maxZ) => {
    box.min.set(minX, minY, minZ);
    box.max.set(maxX, maxY, maxZ);
    for (const [from, to] of lines) {
      if (box.containsPoint(from)) return true;
      ray.origin.copy(from);
      ray.direction.subVectors(to, from);
      const len = ray.direction.length();
      ray.direction.normalize();
      if (ray.intersectBox(box, hit) && hit.distanceTo(from) < len) return true;
    }
    return false;
  };

  // --- ground with a hole where the construction plot is
  const outer = new THREE.Shape();
  const G = 2600;
  outer.moveTo(-G, -G); outer.lineTo(G, -G); outer.lineTo(G, G); outer.lineTo(-G, G); outer.lineTo(-G, -G);
  const hole = new THREE.Path();
  hole.moveTo(PLOT.x0, PLOT.z0); hole.lineTo(PLOT.x0, PLOT.z1); hole.lineTo(PLOT.x1, PLOT.z1); hole.lineTo(PLOT.x1, PLOT.z0); hole.lineTo(PLOT.x0, PLOT.z0);
  outer.holes.push(hole);
  const groundGeo = new THREE.ShapeGeometry(outer);
  groundGeo.rotateX(-Math.PI / 2); // (x, y) -> (x, 0, -y), facing up
  const groundTex = detailTexture({ seed: 4, cells: 4, base: 0.78, amp: 0.22, repeat: [0.08, 0.08] });
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x55603f, map: groundTex, roughness: 1 }));
  ground.receiveShadow = true;
  ground.position.y = -0.02;
  group.add(ground);

  // --- streets
  const roads = [];
  const span = (RANGE + 0.5) * Math.max(PITCH.x, PITCH.z) * 2;
  const tile = 12;
  const addRoad = (cx, cz, length, alongX) => {
    const g = new THREE.PlaneGeometry(length, ROAD_W);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (length / tile));
    g.rotateX(-Math.PI / 2);
    if (!alongX) g.rotateY(Math.PI / 2);
    g.translate(cx, alongX ? 0.02 : 0.03, cz);
    roads.push(g);
  };
  for (let j = -RANGE - 1; j <= RANGE; j++) addRoad(0, j * PITCH.z + PITCH.z / 2, span, true);
  for (let i = -RANGE - 1; i <= RANGE; i++) addRoad(i * PITCH.x + PITCH.x / 2, 0, span, false);
  const roadMesh = new THREE.Mesh(mergeGeometries(roads), new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.9, metalness: 0 }));
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // --- sidewalk pads (raised kerb) for every block; our own block gets a ring around the plot
  const padTex = detailTexture({ seed: 9, cells: 8, base: 0.86, amp: 0.12, speckle: 0.05, repeat: [0.25, 0.25] });
  const padMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a8, map: padTex, roughness: 0.92 });
  const pads = [];
  const padBox = (cx, cz, w, d) => {
    const g = new THREE.BoxGeometry(w, 0.16, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 4, uv.getY(i) * d / 4);
    g.translate(cx, 0.08, cz);
    pads.push(g);
  };
  for (let i = -RANGE; i <= RANGE; i++) for (let j = -RANGE; j <= RANGE; j++) {
    if (i === 0 && j === 0) continue;
    padBox(i * PITCH.x, j * PITCH.z, BLOCK.hx * 2, BLOCK.hz * 2);
  }
  // ring around the plot: north/south full width, east/west between
  padBox(0, (PLOT.z1 + BLOCK.hz) / 2, BLOCK.hx * 2, BLOCK.hz - PLOT.z1);
  padBox(0, (PLOT.z0 - BLOCK.hz) / 2, BLOCK.hx * 2, BLOCK.hz - PLOT.z1);
  padBox((PLOT.x1 + BLOCK.hx) / 2, 0, BLOCK.hx - PLOT.x1, PLOT.z1 * 2);
  padBox((PLOT.x0 - BLOCK.hx) / 2, 0, BLOCK.hx - PLOT.x1, PLOT.z1 * 2);
  const padMesh = new THREE.Mesh(mergeGeometries(pads), padMat);
  padMesh.receiveShadow = true;
  group.add(padMesh);

  // Lawn inside other blocks so they read as residential courtyards.
  const lawns = [];
  for (let i = -RANGE; i <= RANGE; i++) for (let j = -RANGE; j <= RANGE; j++) {
    if (i === 0 && j === 0) continue;
    const g = new THREE.PlaneGeometry(BLOCK.hx * 2 - 8, BLOCK.hz * 2 - 8);
    g.rotateX(-Math.PI / 2);
    g.translate(i * PITCH.x, 0.17, j * PITCH.z);
    lawns.push(g);
  }
  const lawnTex = detailTexture({ seed: 12, cells: 6, base: 0.8, amp: 0.25, repeat: [3, 3] });
  const lawnMesh = new THREE.Mesh(mergeGeometries(lawns), new THREE.MeshStandardMaterial({ color: 0x5b6b3c, map: lawnTex, roughness: 1 }));
  lawnMesh.receiveShadow = true;
  group.add(lawnMesh);

  // --- neighbouring buildings: four facade styles, each merged into one draw call
  const STYLES = ['panel', 'plaster', 'brick', 'modern'];
  const styleTex = STYLES.map((st, i) => cityFacadeTextures(3 + i * 7, st));
  const TILE_W = 12.8, TILE_H = 12.4;
  const tints = {
    panel: [[1, 1, 1], [0.95, 0.93, 0.9], [1, 0.96, 0.9], [0.9, 0.9, 0.9]],
    plaster: [[1, 1, 1], [1, 0.93, 0.84], [0.94, 0.95, 0.92], [1, 0.9, 0.82], [0.92, 0.9, 0.95]],
    brick: [[1, 1, 1], [0.9, 0.92, 0.95]],
    modern: [[1, 1, 1], [1.25, 1.22, 1.18]],
  };
  const bGeos = Object.fromEntries(STYLES.map((st) => [st, []]));
  const roofGeos = [];
  const camPts = lines.map(([from]) => from);
  const nearCamera = (cx, cz, w, d, h) => camPts.some((c) => {
    const dx = Math.max(Math.abs(c.x - cx) - w / 2, 0), dz = Math.max(Math.abs(c.z - cz) - d / 2, 0);
    return Math.hypot(dx, dz) < 34 && h > c.y - 14;
  });
  const placeBuilding = (cx, cz, w, d, h, style) => {
    if (nearCamera(cx, cz, w, d, h)) return false;
    if (blocksView(cx - w / 2 - 3, 0, cz - d / 2 - 3, cx + w / 2 + 3, h + 3, cz + d / 2 + 3)) return false;
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const ou = Math.floor(r() * 4) / 4, ov = Math.floor(r() * 4) / 4;
    // Box face order: +x, -x, +y, -y, +z, -z (4 verts each); +y/-y are covered by the roof cap
    for (let f = 0; f < 6; f++) {
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        if (f === 2 || f === 3) { uv.setXY(i, 0, 0); continue; }
        const faceW = f < 2 ? d : w;
        uv.setXY(i, uv.getX(i) * faceW / TILE_W + ou, uv.getY(i) * h / TILE_H + ov);
      }
    }
    const list = tints[style];
    const tint = list[Math.floor(r() * list.length)];
    const col = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) col.set(tint, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(cx, h / 2 + 0.16, cz);
    bGeos[style].push(g);
    // roof: coping/parapet cap, plant room, a couple of vents
    roofGeos.push(new THREE.BoxGeometry(w + 0.3, 0.5, d + 0.3).translate(cx, h + 0.16 + 0.2, cz));
    roofGeos.push(new THREE.BoxGeometry(Math.min(6, w * 0.3), 2.6, Math.min(5, d * 0.3)).translate(cx + (r() - 0.5) * w * 0.4, h + 1.6, cz + (r() - 0.5) * d * 0.4));
    for (let k = 0; k < 2; k++) roofGeos.push(new THREE.BoxGeometry(0.8, 0.9, 0.8).translate(cx + (r() - 0.5) * w * 0.7, h + 0.85, cz + (r() - 0.5) * d * 0.7));
    return true;
  };

  const occupied = [];
  for (let i = -RANGE; i <= RANGE; i++) for (let j = -RANGE; j <= RANGE; j++) {
    if (i === 0 && j === 0) continue;
    const bx = i * PITCH.x, bz = j * PITCH.z;
    const dist = Math.hypot(i, j);
    const slots = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [sx, sz] of slots) {
      if (r() < 0.15) continue;
      const roll = r();
      const style = roll < 0.45 ? 'panel' : roll < 0.72 ? 'plaster' : roll < 0.86 ? 'brick' : 'modern';
      const w = 14 + r() * 10, d = 12 + r() * 8;
      const floors = style === 'brick' ? 3 + Math.round(r() * 3) : style === 'panel' ? 6 + Math.round(r() * (dist < 1.5 ? 3 : 8)) : 4 + Math.round(r() * 6);
      const h = floors * 3.1;
      const cx = bx + sx * (BLOCK.hx - w / 2 - 4 - r() * 4);
      const cz = bz + sz * (BLOCK.hz - d / 2 - 4 - r() * 3);
      if (placeBuilding(cx, cz, w, d, h, style)) occupied.push([cx, cz, w, d]);
    }
  }
  const cityMats = [];
  STYLES.forEach((st, i) => {
    if (!bGeos[st].length) return;
    const mat = new THREE.MeshStandardMaterial({
      map: styleTex[i].map, emissiveMap: styleTex[i].emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: st === 'modern' ? 0.45 : 0.85, metalness: st === 'modern' ? 0.2 : 0.02,
    });
    cityMats.push(mat);
    const m = new THREE.Mesh(mergeGeometries(bGeos[st]), mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6d6a66, map: detailTexture({ seed: 19, cells: 8, base: 0.8, amp: 0.25, speckle: 0.1, repeat: [2, 2] }), roughness: 0.95 });
  const roofMesh = new THREE.Mesh(mergeGeometries(roofGeos), roofMat);
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  group.add(roofMesh);

  // --- street trees on block edges (and the north/east sides of our block)
  const trees = [];
  const tryTree = (x, z) => {
    if (blocksView(x - 2.8, 0, z - 2.8, x + 2.8, 8, z + 2.8)) return;
    for (const [cx, cz, w, d] of occupied) if (Math.abs(x - cx) < w / 2 + 2.5 && Math.abs(z - cz) < d / 2 + 2.5) return;
    trees.push({ x, y: 0.16, z, s: 0.75 + r() * 0.45, rot: r() * 6.28, tint: leafTint(r) });
  };
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const bx = i * PITCH.x, bz = j * PITCH.z;
    const own = i === 0 && j === 0;
    for (let x = -BLOCK.hx + 5; x <= BLOCK.hx - 5; x += 12 + r() * 5) {
      if (!own) tryTree(bx + x, bz + BLOCK.hz - 1.2);
      tryTree(bx + x, bz - BLOCK.hz + 1.2);
    }
    for (let z = -BLOCK.hz + 6; z <= BLOCK.hz - 6; z += 12 + r() * 5) {
      tryTree(bx + BLOCK.hx - 1.2, bz + z);
      if (!own) tryTree(bx - BLOCK.hx + 1.2, bz + z);
    }
  }
  const streetTrees = createTrees(trees, { seed: 8, detail: 2 });
  group.add(streetTrees.group);

  // --- street lamps along the roads
  const lamps = [];
  for (let j = -RANGE - 1; j <= RANGE; j++) for (let x = -RANGE * PITCH.x; x <= RANGE * PITCH.x; x += 28) {
    const z = j * PITCH.z + PITCH.z / 2;
    for (const [lx, lz, ry] of [[x + 9, z - ROAD_W / 2 - 0.6, 0], [x + 23, z + ROAD_W / 2 + 0.6, Math.PI]]) {
      const across = ((((lx - PITCH.x / 2) % PITCH.x) + PITCH.x * 1.5) % PITCH.x) - PITCH.x / 2;
      if (Math.abs(across) < ROAD_W / 2 + 1) continue; // would stand in a crossing street
      if (Math.abs(lx) < 22 && lz > 20 && lz < 30) continue; // keep the frontage of our plot clear
      if (blocksView(lx - 0.3, 0, lz - 0.3, lx + 0.3, 7.2, lz + 0.3)) continue;
      lamps.push([lx, lz, ry]);
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 7, 6); poleGeo.translate(0, 3.5, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.6); armGeo.translate(0, 6.95, 0.75);
  const pole = mergeGeometries([poleGeo.toNonIndexed(), armGeo.toNonIndexed()]);
  const headGeo = new THREE.BoxGeometry(0.34, 0.12, 0.7); headGeo.translate(0, 6.86, 1.45);
  const poleMesh = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.6 }), lamps.length);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc98a, emissiveIntensity: 0 });
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
  const m = new THREE.Matrix4();
  lamps.forEach(([x, z, ry], i) => {
    m.makeRotationY(ry).setPosition(x, 0.16, z);
    poleMesh.setMatrixAt(i, m);
    headMesh.setMatrixAt(i, m);
  });
  poleMesh.castShadow = true;
  group.add(poleMesh, headMesh);

  function update(p, env) {
    cityMats.forEach((m) => { m.emissiveIntensity = env.night * 1.25; });
    headMat.emissiveIntensity = env.night * 6;
  }

  return { group, update };
}
