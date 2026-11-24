// Barra Gamebreaker e combo (ispirazione FIFA Street, con limiti anti-abuso):
// - si riempie con trucchi riusciti, panna, passaggi al muro e combo;
// - la combo cresce solo ALTERNANDO trucco e passaggio (trucco → passaggio → trucco);
// - ripetere lo stesso trucco o farlo senza avversari vicini vale poco o nulla;
// - si svuota in parte se perdi palla male.
// Piena: si attiva per pochi secondi (squadra più veloce, trucchi più efficaci,
// tiri quasi imparabili). Poi riparte da zero.
import { DT } from './constants';
import type { ComboState, MatchState, TeamIndex } from './types';

export const GB_DURATION = 10;
const COMBO_WINDOW = 4;

export function emptyCombo(): ComboState {
  return { n: 0, mult: 1, t: 0, last: '' };
}

/** Avanza i timer di combo e Gamebreaker. */
export function tickGamebreaker(s: MatchState): void {
  for (const t of [0, 1] as TeamIndex[]) {
    const c = s.combo[t];
    if (c.t > 0) {
      c.t -= DT;
      if (c.t <= 0) s.combo[t] = emptyCombo();
    }
    if (s.gbActive[t] > 0) {
      s.gbActive[t] = Math.max(0, s.gbActive[t] - DT);
      if (s.gbActive[t] === 0) s.events.push({ type: 'gbEnd', team: t });
    }
  }
}

/**
 * Registra una mossa nella combo. Solo l'alternanza trucco/passaggio la fa crescere:
 * due trucchi di fila non la allungano (niente spam), due passaggi neanche.
 */
export function comboStep(s: MatchState, team: TeamIndex, kind: 'trick' | 'pass'): number {
  const c = s.combo[team];
  if (c.t > 0 && c.last !== kind) {
    c.n += 1;
  } else if (c.t <= 0) {
    c.n = kind === 'trick' ? 1 : 0;
  }
  c.last = kind;
  c.t = COMBO_WINDOW;
  c.mult = Math.min(3, 1 + Math.max(0, c.n - 1) * 0.5);
  if (c.n >= 2 && kind === 'trick') s.events.push({ type: 'combo', team, pts: c.mult, label: `COMBO x${c.mult.toFixed(1)}` });
  return c.mult;
}

/** Aggiunge punti alla barra (con moltiplicatori). Restituisce i punti effettivi. */
export function addGb(s: MatchState, team: TeamIndex, amount: number): number {
  if (s.gbActive[team] > 0 || amount <= 0) return 0;
  const pts = amount * s.tune.gb * s.combo[team].mult;
  s.gb[team] = Math.min(1, s.gb[team] + pts);
  return pts;
}

/** Perdita di palla "male": la barra scende e la combo si azzera. */
export function loseGb(s: MatchState, team: TeamIndex, amount: number): void {
  s.gb[team] = Math.max(0, s.gb[team] - amount);
  s.combo[team] = emptyCombo();
}

export function canActivate(s: MatchState, team: TeamIndex): boolean {
  return s.gb[team] >= 1 && s.gbActive[team] <= 0 && s.phase === 'play';
}

export function activateGb(s: MatchState, team: TeamIndex): boolean {
  if (!canActivate(s, team)) return false;
  s.gb[team] = 0;
  s.gbActive[team] = GB_DURATION;
  s.events.push({ type: 'gamebreaker', team, label: 'GAMEBREAKER!' });
  return true;
}

export const gbOn = (s: MatchState, team: TeamIndex): boolean => s.gbActive[team] > 0;

/** Fine del Gamebreaker dopo un gol (si riparte in parità di condizioni). */
export function endGbOnGoal(s: MatchState): void {
  for (const t of [0, 1] as TeamIndex[]) {
    if (s.gbActive[t] > 0) {
      s.gbActive[t] = 0;
      s.events.push({ type: 'gbEnd', team: t });
    }
    s.combo[t] = emptyCombo();
  }
}
