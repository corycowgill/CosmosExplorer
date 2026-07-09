// Small shared helpers.

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const randRange = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(randRange(min, max + 1));

// Frame-rate independent smoothing factor for lerps.
// `rate` is roughly "how much of the gap is closed per second".
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Device / capability detection.
export const isTouchDevice = (typeof window !== 'undefined') &&
  (('ontouchstart' in window) || (navigator.maxTouchPoints > 0));

export const isCoarsePointer = (typeof window !== 'undefined') &&
  window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

// Format a number with thousands separators.
export function fmt(n) {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
