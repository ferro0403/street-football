// Costanti della simulazione. Unità: metri, secondi. Nessuna dipendenza da Phaser.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Gabbia: x = lunghezza (porte alle estremità), y = larghezza, z = altezza. */
export const FIELD = {
  length: 36,
  width: 22,
  goalWidth: 3.6,
  goalHeight: 1.5,
  goalDepth: 1.2,
  /** Rete-tetto della gabbia: la palla rimbalza anche lì. */
  roofHeight: 5,
} as const;

export const CENTER_X = FIELD.length / 2;
export const CENTER_Y = FIELD.width / 2;

export const PHYS = {
  gravity: 20,
  ballRadius: 0.22,
  playerRadius: 0.42,
  groundRestitution: 0.5,
  wallRestitution: 0.72,
  postRestitution: 0.6,
  /** Decelerazione costante della palla che rotola (m/s²). */
  rollFriction: 2.4,
  /** Attrito proporzionale alla velocità quando rotola (1/s). */
  rollDrag: 0.3,
  airDrag: 0.06,
  maxBallSpeed: 34,
} as const;

export const RULES = {
  defaultDurationSec: 180,
  kickoffFreezeSec: 1.2,
  /** Esultanza + finestra per il replay lato client. */
  goalPhaseSec: 6.5,
  /** Dopo questo tempo nella fase gol un tasto salta il replay. */
  goalSkipAfterSec: 1.5,
} as const;

export const PLAYERS_PER_TEAM = 5;
