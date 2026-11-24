// Come le statistiche (1-99) diventano numeri di gioco. Tutto il bilanciamento è qui.
import type { PlayerStats, Role, SpecialSkill } from './types';

export function overall(stats: PlayerStats, role: Role): number {
  if (role === 'gk') {
    return Math.round(stats.defense * 0.7 + stats.speed * 0.15 + stats.passing * 0.15);
  }
  return Math.round(
    stats.speed * 0.19 +
      stats.shooting * 0.19 +
      stats.passing * 0.19 +
      stats.dribbling * 0.19 +
      stats.defense * 0.16 +
      stats.strength * 0.08,
  );
}

const n = (v: number) => v / 99;

// --- Corsa ------------------------------------------------------------------------
/** Velocità massima di corsa (m/s). */
export const runSpeed = (s: PlayerStats) => 5.2 + n(s.speed) * 2.6;
export const SPRINT_MULT = 1.32;
/** Quanto rallenta quando conduce palla (moltiplicatore). */
export const dribbleSpeedMult = (s: PlayerStats) => 0.82 + n(s.dribbling) * 0.14;
/** Accelerazione verso la velocità desiderata (1/s). */
export const acceleration = (s: PlayerStats) => 7 + n(s.speed) * 5;
/** Quanto velocemente cambia direzione (1/s). */
export const turnRate = (s: PlayerStats, hasBall: boolean) => (hasBall ? 5 + n(s.dribbling) * 9 : 14);

// --- Palleggio --------------------------------------------------------------------
/** Distanza minima palla-piedi (m). */
export const DRIBBLE_BASE = 0.42;
/** Ampiezza del "tocco" a corsa normale: la palla resta vicina. */
export const dribbleAmpWalk = (s: PlayerStats) => 0.1 + (1 - n(s.dribbling)) * 0.16;
/** Ampiezza in scatto: la palla si allunga, di più per chi dribbla male. */
export const dribbleAmpSprint = (s: PlayerStats) => 0.45 + (1 - n(s.dribbling)) * 0.8;
/** Oltre questa distanza dai piedi la palla è "scoperta" e un avversario può soffiarla. */
export const EXPOSED_OFFSET = 0.8;
/** Probabilità (per cambio brusco di direzione) di perdere il controllo. */
export const turnLossChance = (s: PlayerStats, sprinting: boolean) =>
  sprinting ? 0.06 + (1 - n(s.dribbling)) * 0.5 : 0.01 + (1 - n(s.dribbling)) * 0.12;
/** Probabilità per tick di soffiare una palla scoperta. */
export const stealChance = (def: PlayerStats, carrier: PlayerStats) =>
  Math.max(0.02, 0.07 + (def.defense - carrier.dribbling) * 0.0018);

// --- Tiro ----------------------------------------------------------------------------
/** Velocità orizzontale di un tiro a potenza piena (m/s). */
export const maxShotSpeed = (s: PlayerStats) => 17 + n(s.shooting) * 13;
/** Errore laterale base del tiro (metri), prima di potenza/distanza. */
export const shotError = (s: PlayerStats) => 0.12 + (1 - n(s.shooting)) * 1.1;
/** Effetto massimo a giro (m/s² di accelerazione laterale). */
export const maxCurl = (s: PlayerStats) => 4 + n(s.shooting) * 6;

// --- Passaggio ------------------------------------------------------------------------
/** Errore angolare del passaggio (radianti circa): piccolo, il rasoterra deve arrivare. */
export const passError = (s: PlayerStats) => 0.01 + (1 - n(s.passing)) * 0.07;
/** Velocità con cui il rasoterra arriva al compagno: tocco breve → carica piena. */
export const passArrivalSpeed = (s: PlayerStats, charge: number) => 5 + charge * (5 + n(s.passing) * 3);

// --- Controllo palla ----------------------------------------------------------------------
/** Raggio entro cui controlla una palla vagante (m). */
export const controlRadius = (s: PlayerStats) => 0.62 + n(s.dribbling) * 0.25;
/** Velocità oltre la quale lo stop non riesce e la palla schizza via (m/s). */
export const controlMaxSpeed = (s: PlayerStats) => 15 + n(s.dribbling) * 10;
/** Finestra in cui la finta evita i contrasti (s). */
export const feintEvade = (s: PlayerStats) => 0.16 + n(s.dribbling) * 0.3;

// --- Contrasti --------------------------------------------------------------------------
/** Contrasto in piedi frontale: difesa contro dribbling. */
export function tackleChance(defender: PlayerStats, carrier: PlayerStats): number {
  const p = 0.48 + (defender.defense - carrier.dribbling) * 0.011;
  return p < 0.12 ? 0.12 : p > 0.9 ? 0.9 : p;
}
/** Spallata di lato: conta la forza. */
export function shoulderChance(defender: PlayerStats, carrier: PlayerStats): number {
  const p = 0.42 + (defender.strength - carrier.strength) * 0.009 + (defender.defense - carrier.dribbling) * 0.004;
  return p < 0.1 ? 0.1 : p > 0.88 ? 0.88 : p;
}
/** Probabilità di fallo entrando da dietro. */
export const foulFromBehind = (s: PlayerStats) => 0.7 - n(s.defense) * 0.35;
/** Portata della scivolata (m) e velocità iniziale (m/s). */
export const slideReach = (s: PlayerStats) => 0.75 + n(s.defense) * 0.3;
export const slideSpeed = (s: PlayerStats) => 8 + n(s.speed) * 1.5 + n(s.defense) * 1;

// --- Portiere ----------------------------------------------------------------------------
export const keeperSpeed = (s: PlayerStats) => 4.2 + n(s.speed) * 2.2;
/** Velocità del tuffo (m/s). */
export const keeperDive = (s: PlayerStats) => 5 + n(s.defense) * 4;
export const keeperReaction = (s: PlayerStats) => 0.22 - n(s.defense) * 0.12;

/**
 * Probabilità di parata quando la palla è a portata.
 * @param lateral distanza della palla dal corpo (m)
 * @param flight secondi di volo del tiro: i tiri da lontano si leggono meglio
 */
export function keeperSaveChance(s: PlayerStats, ballSpeed: number, lateral: number, height: number, flight: number): number {
  let p = 0.64 + n(s.defense) * 0.32;
  p -= Math.max(0, ballSpeed - 18) * 0.02;
  p -= Math.max(0, lateral - 0.45) * 0.3;
  if (height > 1.25) p -= 0.08;
  p += Math.max(0, flight - 0.55) * 0.35;
  return p < 0.08 ? 0.08 : p > 0.94 ? 0.94 : p;
}
/** Blocca (true) o respinge: i tiri forti e lontani dal corpo si respingono. */
export const keeperCatchChance = (s: PlayerStats, ballSpeed: number, lateral: number) =>
  Math.max(0.05, Math.min(0.85, 0.3 + n(s.defense) * 0.4 - Math.max(0, ballSpeed - 13) * 0.04 - lateral * 0.35));

export const STAMINA_DRAIN = 0.32;
export const STAMINA_REGEN = 0.16;

export const SKILL_COOLDOWN = 3.2;
export const FEINT_COOLDOWN = 0.75;
export const TACKLE_COOLDOWN = 0.8;
export const SLIDE_COOLDOWN = 1.6;

export const SKILL_LABELS: Record<SpecialSkill, string> = {
  veronica: 'Veronica',
  rabona: 'Rabona',
  elastico: 'Elastico',
  sombrero: 'Sombrero',
  tunnel: 'Tunnel',
};
