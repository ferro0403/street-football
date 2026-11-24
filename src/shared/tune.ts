// Parametri regolabili in tempo reale dal pannello debug (F2). Stanno dentro lo stato della
// partita: la simulazione resta deterministica (un server potrà usare gli stessi valori).
import type { Tuning } from './types';

export const DEFAULT_TUNE: Tuning = { speed: 1, tackle: 1, aggression: 1, pass: 1, shot: 1 };

export const TUNE_INFO: { key: keyof Tuning; label: string; min: number; max: number; step: number }[] = [
  { key: 'speed', label: 'Velocità giocatori', min: 0.6, max: 1.5, step: 0.05 },
  { key: 'tackle', label: 'Forza del contrasto', min: 0.5, max: 1.6, step: 0.05 },
  { key: 'aggression', label: 'Aggressività difesa CPU', min: 0.3, max: 2, step: 0.05 },
  { key: 'pass', label: 'Potenza passaggi', min: 0.5, max: 2, step: 0.05 },
  { key: 'shot', label: 'Potenza tiri', min: 0.6, max: 1.5, step: 0.05 },
];

/** Corregge valori mancanti o fuori scala (es. letti da localStorage). */
export function sanitizeTune(t?: Partial<Tuning>): Tuning {
  const out = { ...DEFAULT_TUNE };
  if (!t) return out;
  for (const info of TUNE_INFO) {
    const v = t[info.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[info.key] = Math.min(info.max, Math.max(info.min, v));
  }
  return out;
}
