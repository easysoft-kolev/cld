// Cinematic camera path keyed to construction progress.
import * as THREE from 'three';
import { clamp } from './lib/util.js';

// p, camera position, look-at target, vertical fov
export const CAMERA_KEYS = [
  { p: 0.00, pos: [74, 34, 96],   target: [0, 2, -6],   fov: 36 },
  { p: 0.06, pos: [40, 24, 52],   target: [0, 0, -4],   fov: 38 },
  { p: 0.12, pos: [12, 14, 40],   target: [-2, -1, -4], fov: 40 },
  { p: 0.20, pos: [-14, 8, 30],   target: [-2, -2, -2], fov: 42 },
  { p: 0.28, pos: [22, 18, 30],   target: [0, -3, -4],  fov: 40 },
  { p: 0.36, pos: [34, 30, 26],   target: [0, -2, -4],  fov: 40 },
  { p: 0.46, pos: [-34, 16, 36],  target: [0, 6, -4],   fov: 42 },
  { p: 0.56, pos: [-34, 34, 30],  target: [0, 13, -4],  fov: 42 },
  { p: 0.66, pos: [30, 14, 34],   target: [0, 14, -4],  fov: 42 },
  { p: 0.75, pos: [24, 5, 26],    target: [0, 13, -4],  fov: 46 },
  { p: 0.84, pos: [-2, 6.5, 34.5], target: [0, 11, -4], fov: 46 },
  { p: 0.92, pos: [36, 12, 44],   target: [0, 14, -4],  fov: 40 },
  { p: 1.00, pos: [-36, 15, 54],  target: [0, 13, -4],  fov: 36 },
].map((k) => ({ p: k.p, pos: new THREE.Vector3(...k.pos), target: new THREE.Vector3(...k.target), fov: k.fov }));

function catmull(out, p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  for (const c of ['x', 'y', 'z']) {
    out[c] = 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
  }
  return out;
}

export function evaluateCamera(p, out = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 }) {
  const K = CAMERA_KEYS;
  p = clamp(p);
  let i = 0;
  while (i < K.length - 2 && p > K[i + 1].p) i++;
  const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
  const t = clamp((p - b.p) / (c.p - b.p));
  catmull(out.pos, a.pos, b.pos, c.pos, d.pos, t);
  catmull(out.target, a.target, b.target, c.target, d.target, t);
  out.fov = b.fov + (c.fov - b.fov) * t;
  return out;
}

/** Sampled sight lines along the whole path — used to keep context buildings out of the shot. */
export function sightLines(samples = 160) {
  const lines = [];
  const o = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  for (let i = 0; i <= samples; i++) {
    evaluateCamera(i / samples, o);
    lines.push([o.pos.clone(), o.target.clone()]);
  }
  return lines;
}
