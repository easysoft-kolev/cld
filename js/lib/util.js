// Small math + timeline helpers shared by every scene module.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Normalised position of p inside [a, b], clamped to 0..1. */
export const range = (p, a, b) => clamp((p - a) / (b - a));
/** Smoothstep version of range(). */
export const srange = (p, a, b) => smooth(range(p, a, b));

/** Deterministic PRNG so the city and site look identical on every load. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Interpolate a keyframed track. keys: [{p, v}] sorted by p, v is number or array.
 */
export function track(keys, p, ease = smooth) {
  if (p <= keys[0].p) return keys[0].v;
  const last = keys[keys.length - 1];
  if (p >= last.p) return last.v;
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1].p) i++;
  const a = keys[i], b = keys[i + 1];
  const t = ease((p - a.p) / (b.p - a.p));
  if (typeof a.v === 'number') return lerp(a.v, b.v, t);
  return a.v.map((x, k) => lerp(x, b.v[k], t));
}

/** Frame-rate independent exponential damping. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
