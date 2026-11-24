// Come le statistiche (1-99) diventano numeri di gioco. Tutto il bilanciamento è qui.
// Passo 1: arcade e reattivo come FIFA Street. Pochi numeri, facili da regolare.
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

// --- Movimento: reattivo, niente inerzia "pesante" -----------------------------------
/** Velocità di corsa (m/s). */
export const runSpeed = (s: PlayerStats) => 5.6 + n(s.speed) * 2.4;
/** Scatto: molto più veloce della corsa. */
export const SPRINT_MULT = 1.38;
/** Con la palla si va quasi alla stessa velocità (palla incollata ai piedi). */
export const dribbleSpeedMult = (s: PlayerStats) => 0.9 + n(s.dribbling) * 0.08;
/** Accelerazione (1/s): con 18+ la velocità piena arriva in ~0,1 s. */
export const acceleration = (s: PlayerStats) => 18 + n(s.speed) * 8;
/** Rotazione dello sguardo (1/s): cambi di direzione immediati. */
export const TURN_RATE = 30;

// --- Passaggio ------------------------------------------------------------------------
/** Velocità con cui il rasoterra arriva al compagno (m/s), prima della regolazione. */
export const PASS_ARRIVAL = 6.5;
/** Errore angolare massimo (radianti circa): minimo, il passaggio deve arrivare. */
export const passError = (s: PlayerStats) => (1 - n(s.passing)) * 0.03;
/** Passaggio "nel vuoto" (nessun compagno in quella direzione): velocità fissa. */
export const FREE_PASS_SPEED = 14;

// --- Tiro -------------------------------------------------------------------------------
/** Velocità del tiro (m/s): tocco breve → carica piena. */
export const shotSpeed = (s: PlayerStats, charge: number) => 14 + charge * (5 + n(s.shooting) * 11);
/** Errore laterale (m) a piena potenza, da lontano. */
export const shotError = (s: PlayerStats) => 0.15 + (1 - n(s.shooting)) * 0.9;

// --- Controllo palla ------------------------------------------------------------------------
/** Raggio entro cui si prende una palla vagante (m). */
export const controlRadius = (s: PlayerStats) => 0.7 + n(s.dribbling) * 0.2;
/** Oltre questa velocità relativa una palla non passata a te rimbalza via (m/s). */
export const controlMaxSpeed = (s: PlayerStats) => 16 + n(s.dribbling) * 10;

// --- Contrasti -----------------------------------------------------------------------------
/**
 * Contrasto in piedi: difesa contro dribbling, più facile di fronte che da dietro.
 * @param approach 1 di fronte, 0 di lato, -1 da dietro
 */
export function tackleChance(def: PlayerStats, carrier: PlayerStats, approach: number): number {
  const p = 0.5 + (def.defense - carrier.dribbling) * 0.01 + approach * 0.12;
  return p < 0.1 ? 0.1 : p > 0.92 ? 0.92 : p;
}
/** Portata del piede in scivolata (m) e velocità iniziale (m/s). */
export const slideReach = (s: PlayerStats) => 0.8 + n(s.defense) * 0.3;
export const slideSpeed = (s: PlayerStats) => 8.5 + n(s.speed) * 1.5;
/** Probabilità di portare via la palla quando la scivolata la raggiunge. */
export const slideWinChance = (def: PlayerStats, carrier: PlayerStats) =>
  Math.max(0.35, Math.min(0.95, 0.75 + (def.defense - carrier.dribbling) * 0.008));

export const TACKLE_DUR = 0.28;
export const TACKLE_COOLDOWN = 0.55;
/** Contrasto mancato: un attimo sbilanciato. */
export const TACKLE_MISS_STUN = 0.35;
export const SLIDE_DUR = 0.55;
export const SLIDE_COOLDOWN = 1.2;
/** Scivolata a vuoto: a terra per un attimo. */
export const SLIDE_MISS_DOWN = 0.5;
/** Chi perde palla resta sbilanciato giusto un istante. */
export const LOST_BALL_STUN = 0.22;

// --- Portiere -------------------------------------------------------------------------------
export const keeperSpeed = (s: PlayerStats) => 4.2 + n(s.speed) * 2.2;
export const keeperDive = (s: PlayerStats) => 5 + n(s.defense) * 4;
export const keeperReaction = (s: PlayerStats) => 0.2 - n(s.defense) * 0.1;

/**
 * Probabilità di parata quando la palla è a portata: alta sui tiri centrali e deboli,
 * bassa su quelli angolati e potenti.
 * @param lateral distanza della palla dal corpo (m)
 * @param flight secondi di volo: i tiri da lontano si leggono meglio
 * @param placement 0 = centro della porta, 1 = palo: i tiri angolati sono più difficili
 */
export function keeperSaveChance(s: PlayerStats, ballSpeed: number, lateral: number, height: number, flight: number, placement = 0): number {
  let p = 0.72 + n(s.defense) * 0.28;
  p -= Math.max(0, placement - 0.3) * 0.5;
  p -= Math.max(0, ballSpeed - 17) * 0.024;
  p -= Math.max(0, lateral - 0.4) * 0.36;
  if (height > 1.2) p -= 0.08;
  p += Math.max(0, flight - 0.6) * 0.3;
  return p < 0.06 ? 0.06 : p > 0.96 ? 0.96 : p;
}
/** Blocca (true) o respinge: i tiri forti e lontani dal corpo si respingono. */
export const keeperCatchChance = (s: PlayerStats, ballSpeed: number, lateral: number) =>
  Math.max(0.05, Math.min(0.9, 0.35 + n(s.defense) * 0.4 - Math.max(0, ballSpeed - 13) * 0.04 - lateral * 0.35));

export const STAMINA_DRAIN = 0.28;
export const STAMINA_REGEN = 0.18;

export const SKILL_LABELS: Record<SpecialSkill, string> = {
  veronica: 'Veronica',
  rabona: 'Rabona',
  elastico: 'Elastico',
  sombrero: 'Sombrero',
  tunnel: 'Tunnel',
};
