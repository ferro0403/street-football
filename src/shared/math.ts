// Matematica deterministica: solo + - * / e Math.sqrt (arrotondamento esatto IEEE-754).
// Niente Math.sin/cos/atan2/hypot nella simulazione: possono variare tra motori JS.

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Normalizza; restituisce [0,0] se il vettore è quasi nullo. */
export function norm(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  if (l < 1e-6) return [0, 0];
  return [x / l, y / l];
}

/** Distanza del punto P dal segmento AB e parametro t (0..1) del punto più vicino. */
export function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): { d: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return { d: dist(px, py, cx, cy), t };
}

/** Arrotonda per ridurre la deriva nei numeri serializzati (non usato nel passo di simulazione). */
export function round(v: number, decimals = 4): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}
