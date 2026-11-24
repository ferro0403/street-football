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
/** Velocità con cui il rasoterra arriva al compagno (m/s): veloce e diretto. */
export const PASS_ARRIVAL = 8.5;
/** Oltre questa velocità un passaggio non si intercetta: rimbalza sul piede (m/s). */
export const INTERCEPT_MAX_SPEED = 10;
/** Distanza dalla linea entro cui un avversario intercetta un passaggio (m). */
export const INTERCEPT_RADIUS = 0.38;
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

// --- Conduzione e contrasti: tutto fisico, niente dadi ----------------------------------------
// Il contrasto riesce se il piede del difensore arriva sulla PALLA nel momento del contatto,
// senza passare attraverso il corpo di chi la porta, e se la palla non è "coperta" dal suo
// piede. Le statistiche spostano solo le finestre (portata, copertura, tempo di reazione).

/** Distanza palla-corpo a ogni tocco (m): base e allungo massimo, a passo e in scatto. */
export const TOUCH = {
  walkBase: 0.42,
  walkPush: 0.36,
  sprintBase: 0.5,
  sprintPush: 0.62,
  walkLen: 1.6, // metri tra un tocco e l'altro
  sprintLen: 2.6,
  shield: 0.36,
};
/** Chi dribbla bene allunga meno la palla a ogni tocco. */
export const touchPushMult = (s: PlayerStats) => 1.15 - n(s.dribbling) * 0.3;
/** Fin dove il piede di chi ha palla la "copre" (m dal centro del corpo): lì non si ruba. */
export const footCover = (s: PlayerStats) => 0.5 + n(s.dribbling) * 0.1;
/** Raggio del corpo che fa da scudo (m); proteggendo, con le braccia e la forza, è più largo. */
export const BODY_RADIUS = 0.3;
export const shieldRadius = (s: PlayerStats) => 0.4 + n(s.strength) * 0.1;
/** Protezione: velocità ridotta e rapidità con cui il corpo si mette tra palla e difensore (1/s). */
export const SHIELD_SPEED_MULT = 0.55;
export const shieldTurn = (s: PlayerStats) => 4.5 + n(s.strength) * 2.5;

/** Portata del piede nel contrasto in piedi (m dal centro del corpo del difensore). */
export const tackleReach = (s: PlayerStats) => 0.95 + n(s.defense) * 0.25;
/** Allungo del contrasto (m/s) e istante del contatto (s dall'inizio). */
export const TACKLE_LUNGE = 4.5;
export const TACKLE_CONTACT = 0.1;
/** Margine oltre la copertura del piede: sopra = palla rubata, poco sotto = 50/50. */
export const CLEAN_MARGIN = 0.1;
export const LOOSE_MARGIN = -0.05;

/** Portata del piede in scivolata (m) e velocità iniziale (m/s). */
export const slideReach = (s: PlayerStats) => 0.55 + n(s.defense) * 0.2;
export const slideSpeed = (s: PlayerStats) => 8.5 + n(s.speed) * 1.5;

/** Schivata: un cambio di direzione brusco (o uno scatto) apre questa finestra (s). */
export const EVADE_WINDOW = 0.3;
export const EVADE_COOLDOWN = 0.7;

/** Difensore CPU: tempo tra la decisione e l'entrata (segnale visibile per chi ha palla). */
export const aiTackleReaction = (s: PlayerStats) => 0.3 - n(s.defense) * 0.12;
/** Difensore CPU: attesa minima e massima tra due tentativi (s), prima dell'aggressività. */
export const AI_TACKLE_WAIT = [1.5, 2.5] as const;

export const TACKLE_DUR = 0.28;
export const TACKLE_COOLDOWN = 0.55;
/** Contrasto a vuoto: sbilanciato, deve recuperare. */
export const TACKLE_MISS_STUN = 0.45;
/** Contrasto evitato da un dribbling secco: sbilanciato più a lungo. */
export const DODGED_STUN = 0.6;
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
