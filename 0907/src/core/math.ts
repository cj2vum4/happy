/**
 * Small math helpers shared across the game.
 *
 * `clamp` deliberately propagates NaN rather than silently returning a bound:
 * a NaN slipping into the simulation used to poison position and heading with
 * no trace, so it is better that it stays visible.
 */
export const clamp = (v: number, a: number, b: number): number =>
  v < a ? a : v > b ? b : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Frame-rate independent exponential approach toward `to`. */
export const damp = (from: number, to: number, lambda: number, dt: number): number =>
  lerp(from, to, 1 - Math.exp(-lambda * dt));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const randi = (n: number): number => (Math.random() * n) | 0;

/** Wrap an angle into (-PI, PI]. */
export const angleDiff = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export const fmtTime = (s: number): string => {
  const m = (s / 60) | 0;
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(2)}`;
};

/** Deterministic hash-based RNG — same seed always yields the same sequence. */
export function seededRandom(seed: number): () => number {
  let s = seed * 3711.11;
  return () => {
    s = Math.sin(s) * 43758.5453;
    return s - Math.floor(s);
  };
}
