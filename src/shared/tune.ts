// Parametri di bilanciamento regolabili in tempo reale (pannello debug F2).
// Fanno parte dello stato della partita: la simulazione resta deterministica e un server
// potrà usare gli stessi valori.

export interface Tuning {
  /** Velocità dei giocatori (moltiplicatore). */
  speed: number;
  /** Forza dei contrasti: probabilità di vincerli (moltiplicatore). */
  tackle: number;
  /** Rimbalzo sulle pareti (restituzione 0..1). */
  wall: number;
  /** Potenza dei trucchi: probabilità di riuscita (moltiplicatore). */
  trick: number;
  /** Potenza dei tiri (moltiplicatore). */
  shot: number;
  /** Bravura dei portieri (moltiplicatore della probabilità di parata). */
  keeper: number;
  /** Attrito della palla a terra (moltiplicatore). */
  friction: number;
  /** Velocità di riempimento della barra Gamebreaker (moltiplicatore). */
  gb: number;
  /** Aggressività e furbizia della CPU (moltiplicatore). */
  ai: number;
}

export const DEFAULT_TUNE: Tuning = {
  speed: 1,
  tackle: 1,
  wall: 0.78,
  trick: 1,
  shot: 1,
  keeper: 1,
  friction: 1,
  gb: 1,
  ai: 1,
};

export const TUNE_INFO: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: 'speed', label: 'Velocità giocatori', min: 0.6, max: 1.5, step: 0.05 },
  { key: 'tackle', label: 'Forza contrasti', min: 0.4, max: 1.8, step: 0.05 },
  { key: 'wall', label: 'Rimbalzo pareti', min: 0.3, max: 0.98, step: 0.02 },
  { key: 'trick', label: 'Potenza trucchi', min: 0.4, max: 1.8, step: 0.05 },
  { key: 'shot', label: 'Potenza tiri', min: 0.7, max: 1.4, step: 0.05 },
  { key: 'keeper', label: 'Bravura portieri', min: 0.4, max: 1.6, step: 0.05 },
  { key: 'friction', label: 'Attrito palla', min: 0.4, max: 2, step: 0.05 },
  { key: 'gb', label: 'Ricarica Gamebreaker', min: 0.3, max: 4, step: 0.1 },
  { key: 'ai', label: 'Aggressività CPU', min: 0.4, max: 1.8, step: 0.05 },
];

/** Corregge valori mancanti o fuori scala (es. letti da localStorage). */
export function sanitizeTune(t: Partial<Tuning> | undefined): Tuning {
  const out = { ...DEFAULT_TUNE };
  if (!t) return out;
  for (const info of TUNE_INFO) {
    const v = t[info.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[info.key] = Math.min(info.max, Math.max(info.min, v));
  }
  return out;
}
