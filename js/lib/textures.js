// Procedural textures drawn on canvas at startup — no image downloads needed.
import * as THREE from 'three';
import { rng } from './util.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = [1, 1], srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tileable fractal value noise in 0..1. */
export function fbm(size, cells, octaves, seed) {
  const out = new Float32Array(size * size);
  const r = rng(seed);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const lattice = new Float32Array(n * n);
    for (let i = 0; i < lattice.length; i++) lattice[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * n, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % n) * n, yb = ((y0 + 1) % n) * n;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % n, xb = (x0 + 1) % n;
        const a = lattice[ya + xa] + (lattice[ya + xb] - lattice[ya + xa]) * sx;
        const b = lattice[yb + xa] + (lattice[yb + xb] - lattice[yb + xa]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** Grayscale detail map: value = base ± amp * noise, plus optional speckle. */
export function detailTexture({ size = 256, cells = 4, octaves = 5, seed = 1, base = 0.82, amp = 0.3, speckle = 0, repeat = [1, 1], tint = [1, 1, 1] } = {}) {
  const [c, g] = canvas(size);
  const n = fbm(size, cells, octaves, seed);
  const img = g.createImageData(size, size);
  const r = rng(seed + 7);
  for (let i = 0; i < n.length; i++) {
    let v = base + (n[i] - 0.5) * 2 * amp;
    if (speckle && r() < speckle) v *= 0.6 + r() * 0.6;
    v = Math.max(0, Math.min(1, v));
    img.data[i * 4] = v * 255 * tint[0];
    img.data[i * 4 + 1] = v * 255 * tint[1];
    img.data[i * 4 + 2] = v * 255 * tint[2];
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { repeat });
}

/** Steel lattice (tower crane mast / jib). Transparent between members. */
export function latticeTexture() {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = '#fff';
  g.lineCap = 'square';
  g.lineWidth = 12;
  g.beginPath(); g.moveTo(6, 0); g.lineTo(6, 128); g.moveTo(122, 0); g.lineTo(122, 128); g.stroke();
  g.lineWidth = 7;
  g.beginPath(); g.moveTo(0, 4); g.lineTo(128, 4); g.moveTo(0, 124); g.lineTo(128, 124); g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(8, 6); g.lineTo(120, 124); g.stroke();
  const t = toTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Fine safety netting / mesh fence. */
export function netTexture() {
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 3;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  return toTexture(c, { srgb: true });
}

/**
 * Facade textures for context buildings. One tile = 4 bays x 4 storeys (12.8 m x 12.4 m).
 * Styles: panel (Sofia prefab blocks), plaster, brick, modern. Emissive variant lights a random subset.
 */
const FACADE_STYLES = {
  panel:   { wall: [196, 190, 178], noise: 0.12, win: [0.16, 0.3, 0.68, 0.46], frame: [88, 84, 78], band: [150, 144, 134], joints: true, balcony: 0.35 },
  plaster: { wall: [226, 214, 196], noise: 0.08, win: [0.24, 0.24, 0.52, 0.52], frame: [240, 236, 228], band: null, joints: false, balcony: 0.15 },
  brick:   { wall: [150, 86, 62], noise: 0.22, win: [0.26, 0.26, 0.48, 0.5], frame: [232, 226, 214], band: [120, 70, 52], joints: false, balcony: 0, brick: true },
  modern:  { wall: [62, 64, 68], noise: 0.06, win: [0.06, 0.1, 0.88, 0.74], frame: [40, 41, 44], band: [214, 210, 202], joints: false, balcony: 0.25 },
};

export function cityFacadeTextures(seed = 3, styleName = 'plaster') {
  const st = FACADE_STYLES[styleName];
  const W = 512, H = 512, cols = 4, rows = 4;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  const r = rng(seed);
  const n = fbm(W, 4, 4, seed + 11);
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = 1 + (n[i] - 0.5) * 2 * st.noise;
    if (st.brick) {
      const row = Math.floor(y / 6), off = row % 2 ? 6 : 0;
      if (y % 6 === 0 || (x + off) % 12 === 0) v *= 0.72;
      else v *= 0.9 + ((Math.sin(row * 12.9 + Math.floor((x + off) / 12) * 78.2) * 43758.5) % 1 + 1) % 1 * 0.2;
    }
    img.data[i * 4] = Math.min(255, st.wall[0] * v); img.data[i * 4 + 1] = Math.min(255, st.wall[1] * v); img.data[i * 4 + 2] = Math.min(255, st.wall[2] * v); img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  const cw = W / cols, ch = H / rows;
  const rgb = (a, k = 1) => `rgb(${(a[0] * k) | 0},${(a[1] * k) | 0},${(a[2] * k) | 0})`;
  for (let y = 0; y < rows; y++) {
    if (st.band) { g.fillStyle = rgb(st.band); g.fillRect(0, y * ch + ch - 7, W, 7); }
    if (st.joints) {
      g.fillStyle = 'rgba(60,56,50,0.35)';
      g.fillRect(0, y * ch, W, 2);
      for (let x = 0; x <= cols; x++) g.fillRect(x * cw - 1, y * ch, 2, ch);
    }
    for (let x = 0; x < cols; x++) {
      const [fx, fy, fw, fh] = st.win;
      const wx = x * cw + cw * fx, wy = y * ch + ch * fy, ww = cw * fw, wh = ch * fh;
      g.fillStyle = rgb(st.frame);
      g.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
      const sky = 34 + r() * 30;
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, `rgb(${sky + 48},${sky + 58},${sky + 68})`);
      grad.addColorStop(1, `rgb(${sky},${sky + 6},${sky + 12})`);
      g.fillStyle = grad;
      g.fillRect(wx, wy, ww, wh);
      // blinds / curtains
      if (r() < 0.35) { g.fillStyle = `rgba(${200 + r() * 40},${190 + r() * 30},${170 + r() * 20},0.55)`; g.fillRect(wx, wy, ww, wh * (0.2 + r() * 0.6)); }
      g.fillStyle = rgb(st.frame, 0.9);
      g.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      if (styleName === 'modern') g.fillRect(wx, wy + wh * 0.62, ww, 3);
      if (st.balcony && r() < st.balcony) {
        g.fillStyle = 'rgba(30,30,32,0.55)';
        g.fillRect(wx - 10, wy + wh * 0.62, ww + 20, wh * 0.38 + 6);
        g.fillStyle = rgb(st.frame, 1.3);
        g.fillRect(wx - 10, wy + wh * 0.62, ww + 20, 4);
      }
      if (r() < 0.36) {
        const warm = r() < 0.8;
        const k = 0.45 + r() * 0.55;
        ge.fillStyle = warm ? `rgba(255,${(186 * k) | 0},${(110 * k) | 0},${k})` : `rgba(200,220,255,${k * 0.8})`;
        ge.fillRect(wx, wy, ww, wh);
      }
    }
  }
  return { map: toTexture(c), emissive: toTexture(e) };
}

/** Square stone pavers. */
export function paverTexture() {
  const [c, g] = canvas(256);
  const r = rng(21);
  const n = fbm(256, 8, 3, 22);
  const img = g.createImageData(256, 256);
  for (let i = 0; i < n.length; i++) {
    const v = 200 + (n[i] - 0.5) * 30;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.97; img.data[i * 4 + 2] = v * 0.92; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
    const off = y % 2 ? 64 : 0;
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.06})`;
    g.fillRect(((x * 128 + off) % 256), y * 64, 128, 64);
  }
  g.strokeStyle = 'rgba(70,66,60,0.75)';
  g.lineWidth = 3;
  for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, y * 64); g.lineTo(256, y * 64); g.stroke(); }
  for (let y = 0; y < 4; y++) for (let x = 0; x <= 2; x++) {
    const xx = (x * 128 + (y % 2 ? 64 : 0)) % 256;
    g.beginPath(); g.moveTo(xx, y * 64); g.lineTo(xx, y * 64 + 64); g.stroke();
  }
  return toTexture(c);
}

/** Asphalt with a dashed centre line running along U. */
export function roadTexture() {
  const [c, g] = canvas(512, 128);
  const n = fbm(128, 8, 4, 31);
  const img = g.createImageData(512, 128);
  const r = rng(32);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
    const v = 52 + (n[y * 128 + (x % 128)] - 0.5) * 22 + (r() - 0.5) * 14;
    const i = (y * 512 + x) * 4;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v * 1.04; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(232,228,214,0.85)';
  g.fillRect(0, 62, 300, 4);
  g.fillStyle = 'rgba(232,228,214,0.6)';
  g.fillRect(0, 4, 512, 3);
  g.fillRect(0, 121, 512, 3);
  return toTexture(c);
}

/** Printed site hoarding: graphite panels with the brand line and a hazard band. */
export function hoardingTexture() {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = '#1b1d20';
  g.fillRect(0, 0, 1024, 128);
  for (let x = 0; x < 1024; x += 128) {
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(x, 0, 2, 128);
  }
  g.fillStyle = '#c9a15f';
  g.fillRect(0, 112, 1024, 6);
  g.font = '600 34px "Inter Tight", Arial, sans-serif';
  g.fillStyle = '#ece6da';
  g.textBaseline = 'middle';
  g.fillText('BULSTROY GROUP', 56, 56);
  g.font = '400 18px "Inter Tight", Arial, sans-serif';
  g.fillStyle = 'rgba(236,230,218,0.6)';
  g.fillText('BUILDING SOFIA SINCE 2003', 400, 58);
  g.fillStyle = '#c9a15f';
  g.fillRect(44, 38, 4, 36);
  return toTexture(c);
}
