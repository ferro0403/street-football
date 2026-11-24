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

export type ActionKind =
  | 'none'
  | 'kick'
  | 'shoot'
  | 'tackle'
  | 'shoulder'
  | 'slide'
  | 'fall'
  | 'stagger'
  | 'feint'
  | 'veronica'
  | 'elastico'
  | 'sombrero'
  | 'tunnel'
  | 'rabona'
  | 'dive'
  | 'stunned'
  | 'celebrate';

export interface PlayerAction {
  kind: ActionKind;
  t: number;
  dur: number;
  dx: number;
  dy: number;
  /** Per il contrasto: già risolto in questo intervento. */
  done: boolean;
  /** Dati extra dell'azione (es. perno della veronica, lato dell'elastico). */
  ax: number;
  ay: number;
  side: number;
  /** Bersaglio dell'azione (es. difensore saltato), -1 = nessuno. */
  target: number;
}

export interface AiMemory {
  think: number;
  tx: number;
  ty: number;
  score: number;
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
  special: SpecialSkill | null;
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
  stun: number;
  /** Finestra in cui i contrasti vanno a vuoto (finte, skill). */
  evade: number;
  skillCd: number;
  feintCd: number;
  tackleCd: number;
  charge: number;
  chargeKind: 'none' | 'shot' | 'pass';
  /** Fase del palleggio (0..1): la palla si allontana e torna ai piedi. */
  dribble: number;
  /** Distanza attuale palla-piedi quando la conduce (m). */
  ballOff: number;
  /** Dopo un controllo perso o un cambio brusco, breve pausa. */
  touchCd: number;
  slideCd: number;
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
  passTarget: number;
  shotId: number;
  shotTeam: number;
  shotActive: boolean;
  /** Da dove è partito il tiro (per i tiri dalla distanza). */
  shotX: number;
  shotY: number;
  /** Effetto: accelerazione laterale (m/s²) perpendicolare alla velocità. */
  spin: number;
  /** 0 nessuno, 1 rasoterra, 2 lancio, 3 filtrante. */
  passKind: number;
  /** Punto dove andrà ricevuto il passaggio. */
  passTx: number;
  passTy: number;
  /** Squadra che ha segnato in questa azione (palla dentro la rete), -1 = no. */
  inGoal: number;
}

export interface PlayerInput {
  /** Direzione nel piano del campo (coordinate mondo), lunghezza <= 1. */
  mx: number;
  my: number;
  sprint: boolean;
  /** Con palla: passaggio rasoterra (tieni = più veloce). Senza: cambio giocatore. */
  pass: boolean;
  /** Con palla: lancio alto. Senza: scivolata. */
  lob: boolean;
  /** Con palla: passaggio filtrante nello spazio. */
  through: boolean;
  /** Con palla: tiro (tieni = più forte). Senza: contrasto in piedi. */
  shoot: boolean;
  feint: boolean;
  skill: boolean;
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
  | 'kick'
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
  | 'slide'
  | 'foul'
  | 'steal'
  | 'heavyTouch'
  | 'tackleMiss'
  | 'dodge'
  | 'feint'
  | 'special'
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
  fouls: number;
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
  /** Eventi prodotti nell'ultimo tick (per suoni ed effetti lato client). */
  events: MatchEvent[];
}
