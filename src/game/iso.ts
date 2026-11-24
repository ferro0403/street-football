// Proiezione isometrica 2:1. Il mondo è in metri (x = lunghezza, y = larghezza, z = altezza).
// La squadra di casa (0) attacca verso x = length, cioè in alto a destra sullo schermo:
// la porta avversaria sta sulla parete di fondo, sempre ben visibile.

// Scala usata anche dallo script degli sprite (scripts/sprites): stesso pixel nel gioco e negli asset.
export const HW = 24; // pixel per metro, metà larghezza del rombo
export const HH = 12; // pixel per metro, metà altezza del rombo
export const ZPX = 27; // pixel per metro di altezza (2·HH/ZPX = vista isometrica coerente)

export function isoX(x: number, y: number): number {
  return (x + y) * HW;
}

export function isoY(x: number, y: number, z = 0): number {
  return (y - x) * HH - z * ZPX;
}

/** Ordine di disegno: più grande = più vicino alla camera. */
export function isoDepth(x: number, y: number): number {
  return 1000 + (y - x) * 10;
}

/**
 * Converte una direzione sullo schermo (es. levetta: destra = +x, giù = +y) nella direzione
 * nel mondo che, proiettata, punta nello stesso verso. Mantiene l'intensità (0..1).
 */
export function screenToWorldDir(sx: number, sy: number): [number, number] {
  const m = Math.min(1, Math.sqrt(sx * sx + sy * sy));
  if (m < 1e-4) return [0, 0];
  const wx = sx / HW - sy / HH;
  const wy = sx / HW + sy / HH;
  const l = Math.sqrt(wx * wx + wy * wy);
  return [(wx / l) * m, (wy / l) * m];
}

/** Direzione nel mondo → direzione sullo schermo (non normalizzata). */
export function worldToScreenDir(wx: number, wy: number): [number, number] {
  return [(wx + wy) * HW, (wy - wx) * HH];
}
