// Come le statistiche (1-99) diventano numeri di gioco. Tutto il bilanciamento è qui.
import type { PlayerStats, Role, SpecialSkill } from './types';

export function overall(stats: PlayerStats, role: Role): number {
  if (role === 'gk') {
    return Math.round(stats.defense * 0.7 + stats.speed * 0.15 + stats.passing * 0.15);
  }
  return Math.round(
    stats.speed * 0.2 +
      stats.shooting * 0.2 +
      stats.passing * 0.2 +
      stats.dribbling * 0.2 +
      stats.defense * 0.2,
  );
}

const n = (v: number) => v / 99;

/** Velocità massima di corsa (m/s). */
export const runSpeed = (s: PlayerStats) => 5.2 + n(s.speed) * 2.6;
export const SPRINT_MULT = 1.32;
/** Quanto rallenta quando conduce palla (moltiplicatore). */
export const dribbleSpeedMult = (s: PlayerStats) => 0.8 + n(s.dribbling) * 0.16;
/** Accelerazione verso la velocità desiderata (1/s). */
export const acceleration = (s: PlayerStats) => 7 + n(s.speed) * 5;
/** Quanto velocemente cambia direzione con la palla (1/s). */
export const turnRate = (s: PlayerStats, hasBall: boolean) =>
  hasBall ? 6 + n(s.dribbling) * 10 : 14;

/** Velocità orizzontale di un tiro a potenza piena (m/s). */
export const maxShotSpeed = (s: PlayerStats) => 17 + n(s.shooting) * 13;
/** Errore laterale base del tiro (metri), prima di potenza/distanza. */
export const shotError = (s: PlayerStats) => 0.15 + (1 - n(s.shooting)) * 1.2;
/** Errore angolare del passaggio (radianti circa). */
export const passError = (s: PlayerStats) => 0.025 + (1 - n(s.passing)) * 0.17;
export const passSpeedMult = (s: PlayerStats) => 0.9 + n(s.passing) * 0.2;

/** Raggio entro cui controlla una palla vagante (m). */
export const controlRadius = (s: PlayerStats) => 0.62 + n(s.dribbling) * 0.25;
/** Velocità oltre la quale lo stop non riesce e la palla schizza via (m/s). */
export const controlMaxSpeed = (s: PlayerStats) => 15 + n(s.dribbling) * 10;
/** Finestra in cui la finta evita i contrasti (s). */
export const feintEvade = (s: PlayerStats) => 0.16 + n(s.dribbling) * 0.3;

/** Probabilità di vincere un contrasto. */
export function tackleChance(defender: PlayerStats, carrier: PlayerStats): number {
  const p = 0.5 + (defender.defense - carrier.dribbling) * 0.011;
  return p < 0.12 ? 0.12 : p > 0.9 ? 0.9 : p;
}

/** Portiere. */
export const keeperRating = (s: PlayerStats) => s.defense;
export const keeperSpeed = (s: PlayerStats) => 4.2 + n(s.speed) * 2.2;
export const keeperReach = (s: PlayerStats) => 0.95 + n(s.defense) * 0.8;
export const keeperReaction = (s: PlayerStats) => 0.24 - n(s.defense) * 0.14;

export function keeperSaveChance(
  s: PlayerStats,
  ballSpeed: number,
  lateral: number,
  height: number,
): number {
  // Palla addosso al portiere: quasi sempre parata. Angolata e forte: spesso gol.
  let p = 0.56 + n(s.defense) * 0.4;
  p -= Math.max(0, ballSpeed - 17) * 0.022;
  p -= Math.max(0, lateral - 0.4) * 0.32;
  if (height > 1.2) p -= 0.08;
  return p < 0.08 ? 0.08 : p > 0.93 ? 0.93 : p;
}

export const STAMINA_DRAIN = 0.32;
export const STAMINA_REGEN = 0.16;

export const SKILL_COOLDOWN = 3.2;
export const FEINT_COOLDOWN = 0.75;
export const TACKLE_COOLDOWN = 0.9;

export const SKILL_LABELS: Record<SpecialSkill, string> = {
  veronica: 'Veronica',
  rabona: 'Rabona',
  elastico: 'Elastico',
  sombrero: 'Sombrero',
  tunnel: 'Tunnel',
};
