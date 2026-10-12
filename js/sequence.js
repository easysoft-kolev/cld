// Scroll-scrubbed image sequence: draws pre-rendered Blender frames onto a full-screen canvas,
// cross-fading between neighbours so motion stays smooth between rendered frames.

export function createSequence(canvas, { count, src, onProgress }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const frames = new Array(count).fill(null);
  let loaded = 0, failed = 0, dpr = 1, w = 0, h = 0;

  // Coarse-to-fine load order (0, last, middle, quarters…) so the whole timeline is usable early.
  const order = [];
  const seen = new Set();
  const push = (i) => { if (i >= 0 && i < count && !seen.has(i)) { seen.add(i); order.push(i); } };
  push(0); push(count - 1);
  for (let step = count; step >= 1; step = Math.floor(step / 2)) {
    for (let i = 0; i < count; i += step) push(i);
    if (step === 1) break;
  }

  function load(i) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const done = () => { frames[i] = img; loaded++; onProgress?.(loaded, count); resolve(true); };
        if (img.decode) img.decode().then(done, done); else done();
      };
      img.onerror = () => { failed++; onProgress?.(loaded, count); resolve(false); };
      img.src = src(i);
    });
  }

  async function start(parallel = 6) {
    let next = 0;
    const worker = async () => { while (next < order.length) await load(order[next++]); };
    await Promise.all(Array.from({ length: parallel }, worker));
  }

  function nearest(i, dir) {
    for (let k = 0; k < count; k++) {
      const j = i + k * dir;
      if (j < 0 || j >= count) break;
      if (frames[j]) return j;
    }
    return -1;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }

  // tiny offscreen canvas: drawing a frame into it and scaling back up gives a cheap, portable blur
  const blurCanvas = document.createElement('canvas');
  const blurCtx = blurCanvas.getContext('2d');

  function placement(img) {
    const iw = img.naturalWidth, ih = img.naturalHeight, cw = canvas.width, ch = canvas.height;
    const coverS = Math.max(cw / iw, ch / ih);
    if (cw / ch >= 1) return { s: coverS, x: (cw - iw * coverS) / 2, y: (ch - ih * coverS) / 2, band: false };
    // portrait: show (nearly) the full width as a band in the upper part of the screen
    const s = Math.min(coverS, (cw * 1.35) / iw);
    const dh = ih * s;
    return { s, x: (cw - iw * s) / 2, y: Math.max(0, ch * 0.38 - dh / 2), band: dh < ch - 1 };
  }

  function drawImg(img, alpha) {
    const pl = placement(img);
    ctx.globalAlpha = alpha;
    if (pl.band) {
      const bw = 48, bh = Math.max(1, Math.round((bw * canvas.height) / canvas.width));
      if (blurCanvas.width !== bw || blurCanvas.height !== bh) { blurCanvas.width = bw; blurCanvas.height = bh; }
      const cs = Math.max(bw / img.naturalWidth, bh / img.naturalHeight);
      blurCtx.drawImage(img, (bw - img.naturalWidth * cs) / 2, (bh - img.naturalHeight * cs) / 2, img.naturalWidth * cs, img.naturalHeight * cs);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(blurCanvas, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(8,9,11,0.45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, pl.x, pl.y, img.naturalWidth * pl.s, img.naturalHeight * pl.s);
  }

  /** Draw progress p in 0..1. */
  function draw(p) {
    const f = Math.min(count - 1, Math.max(0, p * (count - 1)));
    let a = nearest(Math.floor(f), -1);
    let b = nearest(Math.ceil(f), 1);
    if (a < 0 && b < 0) return false;
    if (a < 0) a = b;
    if (b < 0) b = a;
    let t = a === b ? 0 : (f - a) / (b - a);
    // hold each frame sharp for most of its slice and blend only around the midpoint
    t = Math.min(1, Math.max(0, (t - 0.3) / 0.4));
    t = t * t * (3 - 2 * t);
    ctx.imageSmoothingQuality = 'high';
    drawImg(frames[a], 1);
    if (t > 0.001) drawImg(frames[b], t);
    ctx.globalAlpha = 1;
    return true;
  }

  resize();
  return { start, draw, resize, loaded: () => loaded, failed: () => failed, first: () => load(0) };
}
