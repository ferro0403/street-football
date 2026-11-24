// Tipi dello stato di gioco. Tutto è JSON puro: niente classi, niente Map, niente funzioni,
// così lo stato si può serializzare, confrontare e (più avanti) inviare dal server.

export type TeamIndex = 0 | 1;
export type Role = 'gk' | 'field';
export type SpecialSkill = 'veronica' | 'rabona' | 'elastico' | 'sombrero' | 'tunnel';

export interface PlayerStats {
  speed: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defense: number;
  /** Forza fisica: spallate e contrasti. */
  strength: number;
}

/** Tagli di capelli disponibili negli sprite (scripts/sprites/rig.ts). */
export type HairStyle = 'bald' | 'buzz' | 'short' | 'curly' | 'mohawk' | 'long';

/** Aspetto personalizzabile: base per avatar e campioni. Colori 0xRRGGBB. */
export interface PlayerLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  /** Colore delle scarpe (personale, non della squadra). */
  boots: number;
}

export interface PlayerDef {
  id: string;
  name: string;
  number: number;
  role: Role;
  stats: PlayerStats;
  special: SpecialSkill | null;
  look: PlayerLook;
}

export interface Kit {
  shirt: number;
  trim: number;
  shorts: number;
  socks: number;
}

export interface TeamDef {
  id: string;
  name: string;
  short: string;
  nation: string;
  /** Lo stile della nazione: la skill speciale tipica dei suoi giocatori. */
  style: SpecialSkill;
  kit: Kit;
  gkKit: Kit;
  /** 5 giocatori: indice 0 = portiere. */
  players: PlayerDef[];
}

/**
 * Azioni del nucleo di gioco (Passo 1). Niente falli, niente trucchi: solo calcio, passaggio,
 * tiro, contrasto in piedi, scivolata, tuffo del portiere ed esultanza.
 */
export type ActionKind =
  | 'none'
  | 'kick' // passaggio
  | 'shoot'
  | 'tackle' // contrasto in piedi
  | 'slide' // scivolata
  | 'fall' // a terra dopo una scivolata a vuoto (brevissimo)
  | 'stagger' // sbilanciato: contrasto mancato o palla persa
  | 'dive' // tuffo del portiere
  | 'celebrate';

export interface PlayerAction {
  kind: ActionKind;
  t: number;
  dur: number;
  dx: number;
  dy: number;
  /** Il contatto con la palla è già stato valutato in questa azione. */
  done: boolean;
}

export interface AiMemory {
  think: number;
  tx: number;
  ty: number;
  /** Secondi da cui il giocatore non si muove (guardia anti-blocco). */
  still: number;
}

export interface KeeperMemory {
  react: number;
  seenShot: number;
  rolledShot: number;
  hold: number;
}

export interface PlayerState {
  idx: number;
  team: TeamIndex;
  role: Role;
  defId: string;
  name: string;
  number: number;
  stats: PlayerStats;
  ovr: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Direzione in cui guarda (normalizzata). */
  fx: number;
  fy: number;
  stamina: number;
  action: PlayerAction;
  /** Secondi in cui non può muoversi né agire (dopo un contrasto subito o mancato). */
  stun: number;
  tackleCd: number;
  slideCd: number;
  /** Carica del tiro (0..1) mentre si tiene premuto. */
  charge: number;
  charging: boolean;
  /** Fase del tocco di palla (solo grafica e ritmo del dribbling). */
  dribble: number;
  /** ID del controller umano che lo guida, null = CPU. */
  human: string | null;
  ai: AiMemory;
  gk: KeeperMemory;
}

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: number;
  lastTouch: number;
  /** Chi ha appena calciato non può riprenderla subito. */
  kicker: number;
  kickCd: number;
  /** Destinatario del passaggio in corso (-1 = nessuno). */
  passTarget: number;
  shotId: number;
  shotTeam: number;
  shotActive: boolean;
  /** Da dove è partito il tiro (i tiri da lontano si parano meglio). */
  shotX: number;
  shotY: number;
  /** Squadra che ha segnato in questa azione (palla dentro la rete), -1 = no. */
  inGoal: number;
}

/** Input di un giocatore umano per un tick. I tasti sono "tenuti"; i fronti li calcola la simulazione. */
export interface PlayerInput {
  /** Direzione nel piano del campo (coordinate mondo), lunghezza <= 1. */
  mx: number;
  my: number;
  sprint: boolean;
  /** Con palla: passaggio rasoterra (alla pressione). Senza palla: cambio giocatore. */
  pass: boolean;
  /** Con palla: tiro (tieni = più potenza, parte al rilascio). */
  shoot: boolean;
  /** Senza palla: contrasto in piedi. */
  tackle: boolean;
  /** Senza palla: scivolata. */
  slide: boolean;
  /** Cambio giocatore. */
  switch: boolean;
}

export type InputMap = Record<string, PlayerInput | undefined>;

export interface ControllerState {
  id: string;
  team: TeamIndex;
  player: number;
  prev: PlayerInput;
}

export type MatchPhase = 'kickoff' | 'play' | 'goal' | 'ended';

export type MatchEventType =
  | 'pass'
  | 'shot'
  | 'bounce'
  | 'wall'
  | 'post'
  | 'goal'
  | 'save'
  | 'catch'
  | 'dive'
  | 'tackle'
  | 'tackleMiss'
  | 'slide'
  | 'whistle'
  | 'kickoff'
  | 'end'
  | 'possession'
  | 'switch';

export interface MatchEvent {
  type: MatchEventType;
  p?: number;
  team?: number;
  power?: number;
  x?: number;
  y?: number;
  z?: number;
  skill?: string;
  ctrl?: string;
}

export interface TeamMatchStats {
  shots: number;
  onTarget: number;
  saves: number;
  tackles: number;
  passes: number;
  possessionTicks: number;
}

export interface TeamMeta {
  id: string;
  name: string;
  short: string;
  nation: string;
  kit: Kit;
  gkKit: Kit;
  ovr: number;
}

/** Parametri regolabili dal pannello debug (F2). Fanno parte dello stato: tutto resta deterministico. */
export interface Tuning {
  /** Velocità dei giocatori (moltiplicatore). */
  speed: number;
  /** Forza del contrasto (moltiplicatore della probabilità di riuscita). */
  tackle: number;
  /** Potenza dei passaggi (velocità di arrivo al compagno). */
  pass: number;
  /** Potenza dei tiri. */
  shot: number;
}

export interface MatchState {
  version: 1;
  tick: number;
  rng: number;
  phase: MatchPhase;
  phaseTime: number;
  /** Secondi rimanenti. */
  clock: number;
  duration: number;
  score: [number, number];
  teams: [TeamMeta, TeamMeta];
  players: PlayerState[];
  ball: BallState;
  controllers: ControllerState[];
  kickoffTeam: TeamIndex;
  lastGoal: { team: TeamIndex; scorer: number; ownGoal: boolean; tick: number } | null;
  stats: [TeamMatchStats, TeamMatchStats];
  tune: Tuning;
  /** Eventi prodotti nell'ultimo tick (per suoni ed effetti lato client). */
  events: MatchEvent[];
}
