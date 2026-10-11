// Entry point: the construction film is a sequence of path-traced frames (rendered with Blender,
// see render/) scrubbed by scroll. The DOM layer — stage cards, HUD, sections — lives in ui.js.
import { createUI } from './ui.js';
import { createSequence } from './sequence.js';
import { FRAMES } from './config.js';
import { T, LV, STOREYS, PIT_DEPTH } from './timeline.js';

const ui = createUI();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const range = (p, a, b) => clamp((p - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

function hudInfo(p) {
  const s = range(p, ...T.structure);
  let elevation;
  if (s > 0) {
    const k = clamp(s * STOREYS, 0, STOREYS), i = Math.floor(k);
    elevation = i >= STOREYS ? LV[STOREYS] : lerp(LV[i], LV[i + 1], k - i);
  } else if (p < T.raft[0]) elevation = -PIT_DEPTH * Math.min(1, range(p, ...T.dig) * 1.15);
  else elevation = lerp(-PIT_DEPTH, 0, range(p, T.raft[0], T.structure[0]));
  return { p, elevation, storeys: Math.min(STOREYS, Math.floor(s * STOREYS + 1e-6)), totalStoreys: STOREYS };
}

async function start() {
  const canvas = document.getElementById('scene');
  if (!canvas.getContext) { ui.noWebGL(); return; }
  const seq = createSequence(canvas, {
    count: FRAMES.count,
    src: FRAMES.src,
    onProgress: (n, total) => ui.setLoad(0.1 + 0.9 * Math.min(1, n / Math.min(total, 24))),
  });
  let dirty = true;
  window.addEventListener('resize', () => { seq.resize(); dirty = true; });

  ui.setLoad(0.1);
  const loading = seq.start();
  // show the page as soon as the first frames are in; the rest streams in coarse-to-fine
  await Promise.race([
    new Promise((r) => { const poll = () => (seq.loaded() >= Math.min(FRAMES.count, 24) ? r() : setTimeout(poll, 50)); poll(); }),
    loading,
  ]);
  if (seq.loaded() === 0) { ui.noWebGL(); return; }

  let p = ui.targetProgress(), drawnP = -1, drawnLoaded = -1, last = performance.now();
  seq.draw(p);
  ui.update(hudInfo(p));
  ui.ready();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.hidden || !ui.journeyVisible()) return;
    const target = ui.targetProgress();
    p = ui.reduced ? target : lerp(p, target, 1 - Math.exp(-6 * dt));
    if (Math.abs(p - target) < 1e-5) p = target;
    // redraw only when something changed (scroll, resize, or new frames arriving nearby)
    if (dirty || Math.abs(p - drawnP) > 1e-5 || seq.loaded() !== drawnLoaded) {
      seq.draw(p);
      drawnP = p;
      drawnLoaded = seq.loaded();
      dirty = false;
    }
    ui.update(hudInfo(p));
  }
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  ui.noWebGL();
});
