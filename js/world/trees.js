// Procedural deciduous trees rendered as two instanced meshes (trunks + canopies).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../lib/util.js';

function blob(radius, seed, detail) {
  let g = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const r = rng(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const k = [r() * 9, r() * 9, r() * 9];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const wobble = 1 + 0.18 * Math.sin(n.x * 5 + k[0]) * Math.sin(n.y * 6 + k[1]) * Math.sin(n.z * 5 + k[2]) + 0.08 * Math.sin(n.x * 19 + n.y * 15 + k[1]) * Math.sin(n.z * 17 + k[2]);
    v.multiplyScalar(wobble);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

export function treeGeometries(seed = 5, detail = 3) {
  const r = rng(seed);
  const parts = [];
  const lumps = [
    [0, 5.5, 0, 1.9], [1.3, 4.7, 0.5, 1.3], [-1.2, 4.9, -0.4, 1.4], [0.2, 4.5, -1.3, 1.25], [-0.3, 6.6, 0.3, 1.3], [0.6, 4.4, 1.2, 1.2],
    [1.0, 6.0, -0.8, 1.1], [-1.0, 6.1, 0.9, 1.05], [-1.6, 4.3, 0.8, 1.0], [1.7, 5.4, -0.2, 1.0], [0, 7.3, -0.2, 0.9], [-0.6, 3.9, -0.9, 1.0],
  ];
  lumps.forEach(([x, y, z, s], i) => {
    const b = blob(s, seed * 10 + i, detail);
    b.translate(x, y, z);
    parts.push(b);
  });
  const canopy = mergeGeometries(parts);
  canopy.computeVertexNormals();
  // Fake ambient occlusion: darker underneath and towards the centre.
  const pos = canopy.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
    const radial = Math.min(1, Math.hypot(x, z) / 2.6);
    const ao = Math.min(1, 0.45 + (y - 3) / 4.5 * 0.45 + radial * 0.25) * (0.9 + r() * 0.2);
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  canopy.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const trunk = new THREE.CylinderGeometry(0.12, 0.22, 4.6, 7);
  trunk.translate(0, 2.3, 0);
  const branchA = new THREE.CylinderGeometry(0.05, 0.1, 2.2, 5);
  branchA.rotateZ(0.6); branchA.translate(0.55, 3.9, 0);
  const branchB = new THREE.CylinderGeometry(0.05, 0.1, 2.0, 5);
  branchB.rotateX(-0.6); branchB.translate(0, 3.8, -0.5);
  [trunk, branchA, branchB].forEach((t) => t.deleteAttribute('uv'));
  const trunkAll = mergeGeometries([trunk, branchA, branchB]);
  return { canopy, trunk: trunkAll };
}

const leafMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.5 });
const barkMat = () => new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 0.95 });

/**
 * items: [{x, z, s, rot, tint: [r,g,b]}]
 */
export function createTrees(items, { seed = 5, castShadow = true, detail = 3 } = {}) {
  const geo = treeGeometries(seed, detail);
  const canopy = new THREE.InstancedMesh(geo.canopy, leafMat(), items.length);
  const trunk = new THREE.InstancedMesh(geo.trunk, barkMat(), items.length);
  canopy.castShadow = trunk.castShadow = castShadow;
  canopy.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  function setGrowth(growths) {
    items.forEach((it, i) => {
      const g = growths ? growths[i] : 1;
      q.setFromAxisAngle(up, it.rot);
      t.set(it.x, it.y || 0, it.z);
      const k = Math.max(0.0001, g) * it.s;
      s.set(k, k, k);
      m.compose(t, q, s);
      canopy.setMatrixAt(i, m);
      trunk.setMatrixAt(i, m);
    });
    canopy.instanceMatrix.needsUpdate = true;
    trunk.instanceMatrix.needsUpdate = true;
  }
  items.forEach((it, i) => canopy.setColorAt(i, c.setRGB(...it.tint)));
  canopy.instanceColor.needsUpdate = true;
  setGrowth(null);

  const group = new THREE.Group();
  group.add(trunk, canopy);
  return { group, setGrowth, canopy, trunk };
}

export function leafTint(r) {
  const k = r();
  return [0.075 + k * 0.05, 0.13 + r() * 0.05, 0.045 + k * 0.02];
}
