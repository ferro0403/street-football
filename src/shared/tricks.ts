// Trick stick: 8 direzioni (rispetto a dove guarda il giocatore) = 8 trucchi base,
// altri 8 col modificatore, più i trucchi aerei durante il palleggio.
//
// Ogni trucco è un DUELLO con il difensore davanti:
// - si risolve a metà animazione ("resolve"), non all'istante;
// - riesce se il difensore sbaglia lettura o tempo, fallisce se indovina (ruba o respinge);
// - contano dribbling vs difesa, il "calore" (trucchi ripetuti di fila riescono sempre meno),
//   la memoria del difensore (la CPU legge meglio un trucco appena visto) e il tempismo:
//   un contrasto premuto DURANTE il trucco lo interrompe, uno premuto PRIMA lascia il
//   difensore fuori tempo.
import { DT, FIELD, PHYS } from './constants';
import { clamp, dist, norm } from './math';
import { chance } from './rng';
import { knockDown, setAction } from './actions';
import { addGb, comboStep, gbOn, loseGb } from './gamebreaker';
import type { MatchState, PlayerState } from './types';
import { attackDir } from './world';

export type TrickKind = 'over' | 'through' | 'side' | 'step' | 'drag' | 'spin' | 'elastico' | 'shift' | 'juggle' | 'style';

export interface TrickDef {
  id: string;
  name: string;
  kind: TrickKind;
  dur: number;
  /** Momento del duello (s dall'inizio). */
  resolve: number;
  /** Distanza massima del difensore sfidato. */
  range: number;
  /** Probabilità di base di riuscita (prima di statistiche e calore). */
  base: number;
  /** Punti Gamebreaker se riesce. */
  gb: number;
  /** Quanto resta piantato il difensore saltato (s). */
  stun: number;
}

const T = (id: string, name: string, kind: TrickKind, dur: number, resolve: number, range: number, base: number, gb: number, stun: number): TrickDef => ({
  id,
  name,
  kind,
  dur,
  resolve,
  range,
  base,
  gb,
  stun,
});

export const TRICKS: Record<string, TrickDef> = {
  // Base (senza modificatore)
  sombrero: T('sombrero', 'SOMBRERO', 'over', 0.42, 0.22, 3.2, 0.52, 0.1, 1.0),
  panna: T('panna', 'PANNA!', 'through', 0.42, 0.2, 2.8, 0.42, 0.18, 1.0),
  finta: T('finta', 'FINTA DI CORPO', 'side', 0.32, 0.16, 2.6, 0.6, 0.05, 0.7),
  doppio: T('doppio', 'DOPPIO PASSO', 'step', 0.42, 0.24, 2.8, 0.55, 0.07, 0.75),
  trascinata: T('trascinata', 'TRASCINATA', 'drag', 0.38, 0.2, 2.4, 0.68, 0.04, 0.5),
  // Avanzati (modificatore)
  arcobaleno: T('arcobaleno', 'ARCOBALENO', 'over', 0.5, 0.26, 3.4, 0.45, 0.14, 1.1),
  elastico: T('elastico', 'ELASTICO', 'elastico', 0.4, 0.18, 2.6, 0.47, 0.12, 0.85),
  ruleta: T('ruleta', 'RULETA', 'spin', 0.42, 0.3, 2.4, 0.5, 0.12, 0.8),
  croqueta: T('croqueta', 'CROQUETA', 'shift', 0.3, 0.14, 2.4, 0.6, 0.07, 0.6),
  palleggio: T('palleggio', 'PALLEGGIO', 'juggle', 0.3, 0.3, 0, 1, 0.02, 0),
  // Durante il palleggio
  flick: T('flick', 'SOMBRERO AL VOLO', 'over', 0.4, 0.2, 3.2, 0.58, 0.13, 1.0),
  mondo: T('mondo', 'ATTORNO AL MONDO', 'style', 0.5, 0.25, 0, 1, 0.08, 0),
};

/** Ottante relativo allo sguardo, senza trigonometria: 0 avanti, 2 sinistra, 4 indietro, 6 destra. */
export function octant(p: PlayerState, tx: number, ty: number): number {
  const fwd = tx * p.fx + ty * p.fy;
  const left = tx * -p.fy + ty * p.fx;
  const k = 0.41421356; // tan(22,5°)
  if (Math.abs(left) <= k * Math.abs(fwd)) return fwd >= 0 ? 0 : 4;
  if (Math.abs(fwd) <= k * Math.abs(left)) return left > 0 ? 2 : 6;
  if (fwd > 0) return left > 0 ? 1 : 7;
  return left > 0 ? 3 : 5;
}

const BASE_BY_OCT = ['sombrero', 'doppio', 'finta', 'trascinata', 'panna', 'trascinata', 'finta', 'doppio'];
const ADV_BY_OCT = ['arcobaleno', 'elastico', 'ruleta', 'croqueta', 'palleggio', 'croqueta', 'ruleta', 'elastico'];

/** Trucco e lato (+1 sinistra, -1 destra) per una direzione del trick stick. */
export function trickFor(p: PlayerState, tx: number, ty: number, mod: boolean): { id: string; side: number } {
  const o = octant(p, tx, ty);
  const side = o === 0 || o === 4 ? 0 : o < 4 ? 1 : -1;
  if (p.juggle > 0) return { id: o === 0 ? 'flick' : 'mondo', side };
  return { id: (mod ? ADV_BY_OCT : BASE_BY_OCT)[o], side };
}

/** Il difensore sfidato: il più vicino davanti (anche il portiere). */
export function challenger(s: MatchState, p: PlayerState, range: number, minDot: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bd = range;
  for (const q of s.players) {
    if (!q.active || q.team === p.team) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d > bd) continue;
    const [rx, ry] = norm(q.x - p.x, q.y - p.y);
    if (rx * p.fx + ry * p.fy < minDot) continue;
    bd = d;
    best = q;
  }
  return best;
}

function opponentsNear(s: MatchState, p: PlayerState, r: number): boolean {
  return s.players.some((q) => q.active && q.team !== p.team && dist(p.x, p.y, q.x, q.y) < r);
}

/** Avvia un trucco. Restituisce false se non si può fare adesso. */
export function startTrick(s: MatchState, p: PlayerState, id: string, side: number): boolean {
  const def = TRICKS[id];
  if (!def || s.ball.owner !== p.idx || p.stun > 0 || p.trickCd > 0) return false;
  if (p.action.kind !== 'none' && p.action.kind !== 'kick') return false;
  if (def.kind === 'juggle') {
    // Palleggio solo da fermo o quasi.
    if (Math.sqrt(p.vx * p.vx + p.vy * p.vy) > 2.6) return false;
    p.juggle = 0.001;
    p.trickCd = 0.3;
    s.events.push({ type: 'trick', p: p.idx, team: p.team, label: def.name, skill: id, pts: 0 });
    return true;
  }
  const sd = side === 0 ? (s.tick % 2 === 0 ? 1 : -1) : side;
  setAction(p, 'trick', def.dur, p.fx, p.fy);
  p.action.id = id;
  p.action.side = sd;
  const target = def.range > 0 ? challenger(s, p, def.range, def.kind === 'drag' ? -1 : 0.15) : null;
  p.action.target = target ? target.idx : -1;
  // Anti-spam: il calore cresce di più se ripeti lo stesso trucco.
  p.heat = Math.min(1.5, p.heat + 0.3 + (p.lastTrick === id ? 0.25 : 0));
  p.lastTrick = id;
  p.trickCd = 0.3;
  const lx = -p.fy * sd;
  const ly = p.fx * sd;
  switch (def.kind) {
    case 'side':
      p.vx = p.vx * 0.3 + lx * 4.6;
      p.vy = p.vy * 0.3 + ly * 4.6;
      break;
    case 'shift':
      p.vx = p.vx * 0.4 + lx * 3.6;
      p.vy = p.vy * 0.4 + ly * 3.6;
      break;
    case 'step':
    case 'elastico':
    case 'over':
    case 'through':
      p.vx *= 0.45;
      p.vy *= 0.45;
      break;
    case 'drag': {
      // Trascina indietro e gira di 90° dalla parte scelta.
      p.vx = -p.fx * 1.2;
      p.vy = -p.fy * 1.2;
      const [nx, ny] = norm(lx - p.fx * 0.2, ly - p.fy * 0.2);
      p.fx = nx;
      p.fy = ny;
      break;
    }
    case 'spin':
      if (target) {
        p.action.ax = target.x;
        p.action.ay = target.y;
      }
      p.vx *= 0.3;
      p.vy *= 0.3;
      break;
    case 'style':
      p.evade = Math.max(p.evade, 0.35);
      break;
  }
  return true;
}

// Rotazione di ~6° per tick con coefficienti razionali (niente sin/cos).
const RT = 0.0524;
const RC = (1 - RT * RT) / (1 + RT * RT);
const RS = (2 * RT) / (1 + RT * RT);

/** Movimento guidato del trucco in corso. True se ha già posizionato il giocatore. */
export function trickTick(s: MatchState, p: PlayerState): boolean {
  const a = p.action;
  if (a.kind !== 'trick') return false;
  const def = TRICKS[a.id];
  if (!def) return false;
  if (a.res === 0 && a.t >= def.resolve) resolveTrick(s, p, def);
  // Ruleta: giro attorno al difensore (circa 120°) prima del duello.
  if (def.kind === 'spin' && a.target >= 0 && a.t < def.resolve) {
    const ox = p.x - a.ax;
    const oy = p.y - a.ay;
    const sg = -a.side;
    const nx = ox * RC - sg * oy * RS;
    const ny = sg * ox * RS + oy * RC;
    const px = clamp(a.ax + nx, PHYS.playerRadius, FIELD.length - PHYS.playerRadius);
    const py = clamp(a.ay + ny, PHYS.playerRadius, FIELD.width - PHYS.playerRadius);
    p.vx = (px - p.x) / DT;
    p.vy = (py - p.y) / DT;
    p.x = px;
    p.y = py;
    return true;
  }
  return false;
}

function resolveTrick(s: MatchState, p: PlayerState, def: TrickDef): void {
  const a = p.action;
  const b = s.ball;
  if (b.owner !== p.idx) {
    a.res = -1;
    return;
  }
  const d = a.target >= 0 ? s.players[a.target] : null;
  const heat = Math.max(0, p.heat - 0.3); // il trucco attuale non conta su se stesso
  let ok: boolean;
  let read = false;
  if (!d || !d.active || dist(p.x, p.y, d.x, d.y) > def.range * 1.5) {
    ok = true; // nessun duello: trucco "di stile"
  } else {
    let pr = def.base + (p.stats.dribbling - d.stats.defense) * 0.009 + (s.tune.trick - 1) * 0.35 - heat * 0.45;
    if (gbOn(s, p.team)) pr += 0.25;
    if (d.stun > 0) pr += 0.5;
    // Difensore che si era già buttato: fuori tempo.
    if ((d.action.kind === 'tackle' || d.action.kind === 'slide') && d.action.t > 0.1) pr += 0.35;
    // Difensore in contenimento: legge meglio.
    if (d.shield) pr -= 0.15;
    if (!d.human) {
      const memory = d.seenTrick === def.id && d.seenT > 0 ? 0.28 : 0;
      const readP = (0.08 + d.stats.defense * 0.0022 + memory) * s.tune.ai;
      read = chance(s, clamp(readP, 0, 0.8));
    }
    ok = !read && chance(s, clamp(pr, 0.05, 0.95));
    d.seenTrick = def.id;
    d.seenT = 5;
  }
  a.res = ok ? 1 : -1;
  if (ok) trickSuccess(s, p, def, d);
  else trickFail(s, p, d, read ? 'LETTO!' : 'RESPINTO!');
}

function trickSuccess(s: MatchState, p: PlayerState, def: TrickDef, d: PlayerState | null): void {
  const a = p.action;
  const b = s.ball;
  const sd = a.side || 1;
  const lx = -p.fy * sd;
  const ly = p.fx * sd;
  p.evade = Math.max(p.evade, 0.45);
  if (d && def.stun > 0) knockDown(d, 'stagger', def.stun);
  switch (def.kind) {
    case 'over': {
      // Palla sopra la testa del difensore, la si riprende dietro di lui.
      const h = def.id === 'arcobaleno' ? 9.5 : 8.2;
      b.owner = -1;
      b.lastTouch = p.idx;
      b.kicker = -1;
      b.kickCd = 0;
      b.passTarget = p.idx;
      b.passKind = 2;
      b.x = p.x + p.fx * 0.4;
      b.y = p.y + p.fy * 0.4;
      b.z = Math.max(b.z, 0.3);
      b.vx = p.fx * 5.6;
      b.vy = p.fy * 5.6;
      b.vz = h;
      b.passTx = p.x + p.fx * (h / 1.7);
      b.passTy = p.y + p.fy * (h / 1.7);
      p.juggle = 0;
      p.vx = p.fx * 5.6;
      p.vy = p.fy * 5.6;
      break;
    }
    case 'through': {
      const tx = d ? d.x : p.x + p.fx * 1.5;
      const ty = d ? d.y : p.y + p.fy * 1.5;
      const [dx, dy] = norm(tx - b.x, ty - b.y);
      b.owner = -1;
      b.lastTouch = p.idx;
      b.kicker = -1;
      b.kickCd = 0;
      b.passTarget = p.idx;
      b.passKind = 1;
      b.vx = dx * 8.5;
      b.vy = dy * 8.5;
      b.vz = 0;
      b.passTx = tx + dx * 2.5;
      b.passTy = ty + dy * 2.5;
      // Il giocatore gira intorno al difensore.
      p.vx = p.fx * 3.5 + lx * 4.5;
      p.vy = p.fy * 3.5 + ly * 4.5;
      break;
    }
    case 'step':
    case 'elastico':
    case 'shift':
    case 'side': {
      const [bx, by] = norm(lx * 0.8 + p.fx * 0.6, ly * 0.8 + p.fy * 0.6);
      const v = def.kind === 'elastico' ? 7 : def.kind === 'step' ? 6.4 : 5;
      p.vx = bx * v;
      p.vy = by * v;
      break;
    }
    case 'drag':
    case 'spin': {
      p.vx = p.fx * 4.6;
      p.vy = p.fy * 4.6;
      break;
    }
    default:
      break;
  }
  // Punti: con un avversario vicino e senza ripetere lo stesso trucco all'infinito.
  let pts = 0;
  if (d || (def.kind === 'style' && opponentsNear(s, p, 6))) {
    const mult = comboStep(s, p.team, 'trick');
    void mult;
    pts = addGb(s, p.team, def.gb * Math.max(0, 1 - Math.max(0, p.heat - 0.3) * 0.7));
  }
  s.events.push({ type: 'trick', p: p.idx, team: p.team, label: def.name, skill: def.id, pts, x: p.x, y: p.y });
}

export function trickFail(s: MatchState, p: PlayerState, d: PlayerState | null, label: string): void {
  const b = s.ball;
  p.action.res = -1;
  p.juggle = 0;
  knockDown(p, 'stagger', 0.4);
  if (d && d.active && dist(p.x, p.y, d.x, d.y) < 2.2 && d.role === 'field' && chance(s, 0.45 + (d.stats.defense - p.stats.dribbling) * 0.01)) {
    // Il difensore ha indovinato: palla sua.
    b.owner = d.idx;
    b.lastTouch = d.idx;
    b.passTarget = -1;
    b.passKind = 0;
    d.stun = 0;
    if (d.action.kind === 'stagger') d.action.kind = 'none';
    s.stats[d.team].tackles += 1;
  } else {
    // Respinta: la palla schizza via.
    const [dx, dy] = d ? norm(p.x - d.x, p.y - d.y) : [-p.fx, -p.fy];
    b.owner = -1;
    b.lastTouch = d ? d.idx : p.idx;
    b.kicker = p.idx;
    b.kickCd = 0.3;
    b.passTarget = -1;
    b.passKind = 0;
    b.vx = dx * 3.5 + p.fy * 1.5;
    b.vy = dy * 3.5 - p.fx * 1.5;
    b.vz = 1.2;
  }
  loseGb(s, p.team, 0.08);
  s.events.push({ type: 'trickFail', p: p.idx, team: p.team, label, x: p.x, y: p.y, skill: d ? String(d.idx) : '' });
}

/** Raffreddamento del calore e della memoria dei difensori (ogni tick). */
export function coolTricks(p: PlayerState): void {
  if (p.heat > 0) p.heat = Math.max(0, p.heat - 0.22 * DT);
  if (p.trickCd > 0) p.trickCd = Math.max(0, p.trickCd - DT);
  if (p.seenT > 0) p.seenT = Math.max(0, p.seenT - DT);
  if (p.tackleT > 0) p.tackleT = Math.max(0, p.tackleT - DT);
  if (p.juggle > 0) {
    p.juggle += DT;
    if (p.juggle > 6) p.juggle = 0; // dopo un po' la palla torna a terra
  }
}

/** Direzione "in avanti" verso cui spingono i trucchi dell'IA. */
export function forwardTo(p: PlayerState): [number, number] {
  return norm(p.fx + attackDir(p.team) * 0.5, p.fy);
}
