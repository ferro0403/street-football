// Generatore pseudo-casuale con seme (mulberry32). Lo stato vive dentro MatchState.rng,
// quindi la partita si può riprodurre identica a partire da seme + input.

export function nextRandom(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Valore uniforme in [-1, 1). */
export function randSigned(s: { rng: number }): number {
  return nextRandom(s) * 2 - 1;
}

export function chance(s: { rng: number }, p: number): boolean {
  return nextRandom(s) < p;
}

export function seedFrom(n: number): number {
  return (n | 0) ^ 0x5bd1e995;
}
