// Azioni dei giocatori: tiro, passaggi, contrasti, finta e skill speciali.
// Le usano sia gli umani (tramite input) sia la CPU, così le regole sono identiche.
import { CENTER_Y, DT, FIELD, PHYS } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, nextRandom, randSigned } from './rng';
import { groundSpeedFor, rollTime } from './ball';
import {
  FEINT_COOLDOWN,
  SKILL_COOLDOWN,
  SLIDE_COOLDOWN,
  TACKLE_COOLDOWN,
  feintEvade,
  foulFromBehind,
  maxCurl,
  maxShotSpeed,
  passArrivalSpeed,
  passError,
  runSpeed,
  shotError,
  shoulderChance,
  slideReach,
  slideSpeed,
  tackleChance,
} from './stats';
import type { ActionKind, MatchState, PlayerState } from './types';
import { attackDir, distToOppGoal, laneClear, nearestOpponent, oppGoalX, openness } from './world';

export function setAction(p: PlayerState, kind: ActionKind, dur: number, dx = 0, dy = 0): void {
  p.action = { kind, t: 0, dur, dx, dy, done: false, ax: 0, ay: 0, side: 0, target: -1 };
}

/** Mette a terra / fa barcollare un giocatore. */
export function knockDown(p: PlayerState, kind: 'fall' | 'stagger', dur: number): void {
  p.stun = Math.max(p.stun, dur);
  setAction(p, kind, dur);
  p.charge = 0;
  p.chargeKind = 'none';
}

function releaseBall(s: MatchState, p: PlayerState): void {
  const b = s.ball;
  b.owner = -1;
  b.lastTouch = p.idx;
  b.kicker = p.idx;
  b.kickCd = 0.28;
  b.passTarget = -1;
  b.passKind = 0;
  b.shotActive = false;
  b.spin = 0;
  b.x = clamp(p.x + p.fx * 0.45, PHYS.ballRadius, FIELD.length - PHYS.ballRadius);
  b.y = clamp(p.y + p.fy * 0.45, PHYS.ballRadius, FIELD.width - PHYS.ballRadius);
  b.z = 0.05;
  p.charge = 0;
  p.chargeKind = 'none';
}

// --- Tiro --------------------------------------------------------------------------

/** Mira laterale (-1..1, asse y) dalla levetta: serve anche al mirino lato client. */
export function shotAimFromInput(mx: number, my: number): number {
  void mx;
  return clamp(my * 1.3, -1, 1);
}

/** Punto della porta avversaria verso cui si mira (senza errore). */
export function shotTarget(p: PlayerState, aim: number): [number, number] {
  return [oppGoalX(p.team), CENTER_Y + clamp(aim, -1, 1) * (FIELD.goalWidth / 2 - 0.35)];
}

/**
 * Tiro verso la porta avversaria.
 * @param power 0..1 (carica)
 * @param aim -1..1 spostamento laterale del bersaglio (asse y)
 * @param curl 0..1 quanto effetto a giro (la palla parte larga e rientra)
 */
export function shoot(s: MatchState, p: PlayerState, power: number, aim: number, curl = 0, bonus = 0): void {
  const st = { ...p.stats, shooting: Math.min(99, p.stats.shooting + bonus) };
  power = clamp(power, 0, 1);
  let [gx, ty] = shotTarget(p, aim);
  const d0 = dist(p.x, p.y, gx, ty);
  const pressure = nearestOpponent(s, p, false).d < 1.6 ? 0.5 : 0;
  const err = shotError(st) * (0.5 + power * 0.8) * (0.6 + d0 / 20) * (1 + pressure);
  ty += randSigned(s) * err;

  const vh = 9 + (maxShotSpeed(st) - 9) * power;
  const skill = st.shooting / 99;
  const th = clamp(0.2 + power * power * 0.95 + nextRandom(s) * power * (1.25 - skill) * 0.9, 0.15, 3.5);

  releaseBall(s, p);
  const b = s.ball;
  const d = dist(b.x, b.y, gx, ty);
  const t = Math.max(0.15, d / vh);

  // Effetto a giro: la palla parte verso l'esterno del palo e rientra.
  const sideSign = ty >= CENTER_Y ? 1 : -1;
  const a = clamp(curl, 0, 1) * maxCurl(st);
  const delta = 0.5 * a * t * t;
  const aimY = ty + sideSign * delta;
  const [dx, dy] = norm(gx - b.x, aimY - b.y);
  b.vx = dx * vh;
  b.vy = dy * vh;
  // spin > 0 spinge a sinistra della velocità: deve spingere verso il centro della porta.
  b.spin = a > 0 ? -sideSign * a * (b.vx >= 0 ? 1 : -1) : 0;
  b.vz = clamp((th - b.z + 0.5 * PHYS.gravity * t * t) / t, 0.5, 14);
  b.shotId += 1;
  b.shotActive = true;
  b.shotTeam = p.team;
  b.shotX = b.x;
  b.shotY = b.y;
  s.stats[p.team].shots += 1;
  p.fx = dx;
  p.fy = dy;
  setAction(p, 'kick', 0.3, dx, dy);
  s.events.push({ type: 'shot', p: p.idx, team: p.team, power: vh, x: b.x, y: b.y });
}

// --- Passaggi ------------------------------------------------------------------------

/** Ruota leggermente una direzione (errore del passaggio), senza trigonometria. */
function wobble(dx: number, dy: number, e: number): [number, number] {
  return norm(dx - dy * e, dy + dx * e);
}

/**
 * Passaggio rasoterra: arriva SEMPRE al compagno. La carica (0..1) cambia solo la velocità
 * di arrivo (tocco morbido → passaggio teso), mai la traiettoria.
 */
export function groundPass(s: MatchState, p: PlayerState, target: number, charge: number, bonus = 0): void {
  const r = s.players[target];
  const st = { ...p.stats, passing: Math.min(99, p.stats.passing + bonus) };
  const vEnd = passArrivalSpeed(st, clamp(charge, 0, 1));
  // Anticipo: due iterazioni sul tempo di arrivo stimato.
  let tx = r.x;
  let ty = r.y;
  for (let i = 0; i < 2; i++) {
    const d = dist(p.x, p.y, tx, ty);
    const v0 = groundSpeedFor(d, vEnd);
    const t = rollTime(v0, d);
    tx = clamp(r.x + r.vx * t * 0.85, 0.6, FIELD.length - 0.6);
    ty = clamp(r.y + r.vy * t * 0.85, 0.6, FIELD.width - 0.6);
  }
  releaseBall(s, p);
  const b = s.ball;
  const d = dist(b.x, b.y, tx, ty);
  const v0 = groundSpeedFor(d, vEnd);
  let [dx, dy] = norm(tx - b.x, ty - b.y);
  [dx, dy] = wobble(dx, dy, passError(st) * randSigned(s));
  b.vx = dx * v0;
  b.vy = dy * v0;
  b.vz = 0;
  b.z = 0;
  finishPass(s, p, target, 1, tx, ty, dx, dy);
}

/** Lancio alto: arriva dall'alto al compagno, scavalca chi sta in mezzo. */
export function lobPass(s: MatchState, p: PlayerState, target: number, bonus = 0): void {
  const r = s.players[target];
  const st = { ...p.stats, passing: Math.min(99, p.stats.passing + bonus) };
  const d0 = dist(p.x, p.y, r.x, r.y);
  const vh0 = clamp(d0 / 1.05, 6, 17);
  const t0 = d0 / vh0;
  const tx = clamp(r.x + r.vx * t0 * 0.8, 0.6, FIELD.length - 0.6);
  const ty = clamp(r.y + r.vy * t0 * 0.8, 0.6, FIELD.width - 0.6);
  releaseBall(s, p);
  const b = s.ball;
  // Atterra un po' prima: il rimbalzo porta la palla al compagno.
  const d = dist(b.x, b.y, tx, ty) * 0.9;
  const vh = clamp(d / 1.05, 6, 17);
  const t = d / vh;
  let [dx, dy] = norm(tx - b.x, ty - b.y);
  [dx, dy] = wobble(dx, dy, passError(st) * 1.5 * randSigned(s));
  b.vx = dx * vh;
  b.vy = dy * vh;
  b.vz = 0.5 * PHYS.gravity * t;
  finishPass(s, p, target, 2, tx, ty, dx, dy);
}

/** Punto nello spazio per il filtrante: davanti al compagno, nella direzione dell'attacco. */
export function throughPoint(p: PlayerState, r: PlayerState, dirX: number, dirY: number): [number, number] {
  const ad = attackDir(p.team);
  let [ux, uy] = norm(dirX, dirY);
  if (ux === 0 && uy === 0) [ux, uy] = [ad, 0];
  // Sempre almeno un po' verso la porta avversaria.
  [ux, uy] = norm(ux * 0.6 + ad * 0.6, uy * 0.6);
  const lead = 3.5 + (runSpeed(r.stats) - 5) * 0.9;
  const gx = oppGoalX(p.team);
  let tx = r.x + ux * lead;
  const ty = clamp(r.y + uy * lead, 1, FIELD.width - 1);
  tx = ad > 0 ? Math.min(tx, gx - 1.8) : Math.max(tx, gx + 1.8);
  return [clamp(tx, 1, FIELD.length - 1), ty];
}

/** Filtrante: palla nello spazio dove il compagno arriva correndo. */
export function throughPass(s: MatchState, p: PlayerState, target: number, dirX: number, dirY: number, bonus = 0): void {
  const r = s.players[target];
  const st = { ...p.stats, passing: Math.min(99, p.stats.passing + bonus) };
  const [tx, ty] = throughPoint(p, r, dirX, dirY);
  releaseBall(s, p);
  const b = s.ball;
  const d = dist(b.x, b.y, tx, ty);
  // Il compagno impiega tR ad arrivare: la palla deve arrivarci più o meno insieme.
  const tR = dist(r.x, r.y, tx, ty) / (runSpeed(r.stats) * 1.2);
  let vEnd = 3;
  let v0 = groundSpeedFor(d, vEnd);
  if (rollTime(v0, d) > tR + 0.4) {
    vEnd = 5;
    v0 = groundSpeedFor(d, vEnd);
  }
  let [dx, dy] = norm(tx - b.x, ty - b.y);
  [dx, dy] = wobble(dx, dy, passError(st) * 1.2 * randSigned(s));
  b.vx = dx * v0;
  b.vy = dy * v0;
  b.vz = 0;
  b.z = 0;
  finishPass(s, p, target, 3, tx, ty, dx, dy);
}

function finishPass(s: MatchState, p: PlayerState, target: number, kind: number, tx: number, ty: number, dx: number, dy: number): void {
  const b = s.ball;
  b.passTarget = target;
  b.passKind = kind;
  b.passTx = tx;
  b.passTy = ty;
  p.fx = dx;
  p.fy = dy;
  s.stats[p.team].passes += 1;
  setAction(p, 'kick', 0.25, dx, dy);
  s.events.push({ type: 'pass', p: p.idx, team: p.team, power: len(b.vx, b.vy), x: b.x, y: b.y, skill: String(kind) });
}

/** Valutazione di un compagno come destinatario del passaggio (più alto = meglio). */
export function passValue(s: MatchState, p: PlayerState, q: PlayerState): number {
  const dir = attackDir(p.team);
  const d = dist(p.x, p.y, q.x, q.y);
  let v = (q.x - p.x) * dir * 0.3 + openness(s, p.team, q.x, q.y) * 0.7;
  v -= Math.abs(d - 9) * 0.08;
  if (q.role === 'gk') v -= 6;
  if (!laneClear(s, p.team, p.x, p.y, q.x, q.y, 0.9)) v -= 4;
  return v;
}

/**
 * Sceglie il compagno da servire. Con una direzione (levetta) privilegia chi sta da quella
 * parte, altrimenti usa la valutazione tattica.
 */
export function pickPassTarget(s: MatchState, p: PlayerState, dirX: number, dirY: number): number {
  let best = -1;
  let bestScore = -Infinity;
  const [ux, uy] = norm(dirX, dirY);
  const hasDir = ux !== 0 || uy !== 0;
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx) continue;
    const [qx, qy] = norm(q.x - p.x, q.y - p.y);
    const d = dist(p.x, p.y, q.x, q.y);
    let score: number;
    if (hasDir) {
      const align = qx * ux + qy * uy;
      score = align * 6 - d * 0.08 + openness(s, p.team, q.x, q.y) * 0.25;
      if (align < 0.2) score -= 8;
      if (q.role === 'gk') score -= 5;
    } else {
      score = passValue(s, p, q);
    }
    if (score > bestScore) {
      bestScore = score;
      best = q.idx;
    }
  }
  return best;
}

// --- Difesa ------------------------------------------------------------------------

function ballCarrier(s: MatchState): PlayerState | null {
  return s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
}

/** Contrasto in piedi: allunga la gamba (o la spalla) per rubare palla. */
export function startTackle(s: MatchState, p: PlayerState): boolean {
  if (p.tackleCd > 0 || p.stun > 0 || p.action.kind === 'tackle' || p.action.kind === 'slide') return false;
  const b = s.ball;
  let [dx, dy] = norm(b.x - p.x, b.y - p.y);
  if (dx === 0 && dy === 0) [dx, dy] = [p.fx, p.fy];
  setAction(p, 'tackle', 0.32, dx, dy);
  p.vx = dx * 4.5 + p.vx * 0.3;
  p.vy = dy * 4.5 + p.vy * 0.3;
  p.fx = dx;
  p.fy = dy;
  p.tackleCd = TACKLE_COOLDOWN;
  return true;
}

/** Scivolata: lunga, rischiosa. Se non prende la palla resti a terra fuori tempo. */
export function startSlide(s: MatchState, p: PlayerState): boolean {
  if (p.slideCd > 0 || p.stun > 0 || p.action.kind === 'slide' || p.action.kind === 'tackle') return false;
  const b = s.ball;
  const c = ballCarrier(s);
  const tx = c ? b.x + c.vx * 0.25 : b.x + b.vx * 0.2;
  const ty = c ? b.y + c.vy * 0.25 : b.y + b.vy * 0.2;
  let [dx, dy] = norm(tx - p.x, ty - p.y);
  if (dx === 0 && dy === 0) [dx, dy] = [p.fx, p.fy];
  setAction(p, 'slide', 0.65, dx, dy);
  const v = slideSpeed(p.stats);
  p.vx = dx * v;
  p.vy = dy * v;
  p.fx = dx;
  p.fy = dy;
  p.slideCd = SLIDE_COOLDOWN;
  p.tackleCd = TACKLE_COOLDOWN;
  s.events.push({ type: 'slide', p: p.idx, team: p.team, x: p.x, y: p.y });
  return true;
}

/** Da dove arriva il difensore rispetto a chi ha palla: 1 davanti, 0 di lato, -1 da dietro. */
function approach(c: PlayerState, p: PlayerState): number {
  const [rx, ry] = norm(p.x - c.x, p.y - c.y);
  const d = rx * c.fx + ry * c.fy;
  return d > 0.4 ? 1 : d < -0.4 ? -1 : 0;
}

function foul(s: MatchState, p: PlayerState, c: PlayerState): void {
  const b = s.ball;
  // Fallo: chi lo subisce cade ma la palla resta alla sua squadra.
  b.owner = c.idx;
  b.lastTouch = c.idx;
  b.passTarget = -1;
  b.passKind = 0;
  b.shotActive = false;
  knockDown(c, 'fall', 0.55);
  c.evade = 0.9; // protetto mentre si rialza
  knockDown(p, 'stagger', 1.4);
  s.stats[p.team].fouls += 1;
  s.events.push({ type: 'foul', p: p.idx, team: p.team, x: c.x, y: c.y }, { type: 'whistle' });
}

function winBall(s: MatchState, p: PlayerState, c: PlayerState, kickX: number, kickY: number, keep: boolean): void {
  const b = s.ball;
  b.owner = -1;
  b.lastTouch = p.idx;
  b.kicker = c.idx;
  b.kickCd = 0.45;
  b.passTarget = -1;
  b.passKind = 0;
  b.shotActive = false;
  if (keep) {
    b.owner = p.idx;
  } else {
    b.vx = kickX + randSigned(s) * 1.5;
    b.vy = kickY + randSigned(s) * 1.5;
    b.vz = 1.2;
  }
  s.stats[p.team].tackles += 1;
}

/** Risolve il contrasto in piedi (una volta, a metà intervento). */
export function resolveTackle(s: MatchState, p: PlayerState): void {
  const a = p.action;
  if (a.kind !== 'tackle' || a.done || a.t < 0.1) return;
  a.done = true;
  const b = s.ball;
  const fx = p.x + a.dx * 0.5;
  const fy = p.y + a.dy * 0.5;
  const reach = 0.75 + (p.stats.defense / 99) * 0.2;
  // Da dietro la palla è davanti all'attaccante: si prendono le gambe → fallo probabile.
  const cc = ballCarrier(s);
  if (cc && cc.team !== p.team && cc.role !== 'gk' && cc.evade <= 0 && approach(cc, p) < 0 && dist(fx, fy, cc.x, cc.y) < 0.85) {
    if (chance(s, foulFromBehind(p.stats))) {
      foul(s, p, cc);
      return;
    }
  }
  if (dist(fx, fy, b.x, b.y) > reach || b.z > 0.9) {
    knockDown(p, 'stagger', 0.4);
    s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
    return;
  }
  const c = ballCarrier(s);
  if (!c) {
    // Palla vagante: la tocca via.
    b.vx = a.dx * 6 + b.vx * 0.3;
    b.vy = a.dy * 6 + b.vy * 0.3;
    b.lastTouch = p.idx;
    b.passTarget = -1;
    b.passKind = 0;
    s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y });
    return;
  }
  if (c.team === p.team || c.role === 'gk') return;
  if (c.evade > 0) {
    knockDown(p, 'stagger', 0.6);
    s.events.push({ type: 'dodge', p: c.idx, team: c.team, x: c.x, y: c.y });
    return;
  }
  const from = approach(c, p);
  if (from === 0) {
    // Spallata.
    a.kind = 'shoulder';
    if (chance(s, shoulderChance(p.stats, c.stats))) {
      winBall(s, p, c, a.dx * 3, a.dy * 3, chance(s, 0.5));
      if (p.stats.strength - c.stats.strength > 15) knockDown(c, 'fall', 0.6);
      else knockDown(c, 'stagger', 0.45);
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y, skill: 'shoulder' });
    } else {
      knockDown(p, 'stagger', 0.5);
      s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
    }
    return;
  }
  const pr = tackleChance(p.stats, c.stats) - (from < 0 ? 0.15 : 0);
  if (chance(s, pr)) {
    winBall(s, p, c, a.dx * 4.5, a.dy * 4.5, chance(s, 0.4 + (p.stats.defense - c.stats.dribbling) * 0.01));
    knockDown(c, 'stagger', 0.4);
    s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y });
  } else {
    knockDown(p, 'stagger', 0.5);
    s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
  }
}

/** Scivolata: controllo continuo del contatto durante la fase utile. */
export function updateSlide(s: MatchState, p: PlayerState): void {
  const a = p.action;
  if (a.kind !== 'slide') return;
  if (!a.done && a.t > 0.04 && a.t < 0.45) {
    const b = s.ball;
    const fx = p.x + a.dx * 0.55;
    const fy = p.y + a.dy * 0.55;
    if (dist(fx, fy, b.x, b.y) < slideReach(p.stats) && b.z < 0.6) {
      a.done = true;
      const c = ballCarrier(s);
      if (c && c.team !== p.team && c.role !== 'gk') {
        if (c.evade > 0) {
          s.events.push({ type: 'dodge', p: c.idx, team: c.team, x: c.x, y: c.y });
          a.done = false; // salta l'intervento: niente palla
          a.t = 0.46;
          return;
        }
        if (approach(c, p) < 0 && dist(p.x, p.y, c.x, c.y) < 1.2 && chance(s, foulFromBehind(p.stats) + 0.1)) {
          foul(s, p, c);
          return;
        }
        winBall(s, p, c, a.dx * 6.5 + c.vx * 0.2, a.dy * 6.5 + c.vy * 0.2, false);
        if (dist(p.x, p.y, c.x, c.y) < 1.0) knockDown(c, 'fall', 0.7);
        else knockDown(c, 'stagger', 0.35);
        s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y, skill: 'slide' });
      } else if (!c) {
        b.vx = a.dx * 7;
        b.vy = a.dy * 7;
        b.lastTouch = p.idx;
        b.passTarget = -1;
        b.passKind = 0;
        s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y, skill: 'slide' });
      }
    }
  }
}

/** Fine scivolata a vuoto: resta a terra fuori tempo. */
export function endSlide(p: PlayerState): void {
  if (p.action.kind === 'slide' && !p.action.done) {
    knockDown(p, 'fall', 0.55);
  }
}

// --- Dribbling ----------------------------------------------------------------------

export function feint(s: MatchState, p: PlayerState, side: number): boolean {
  if (p.feintCd > 0 || p.stun > 0 || s.ball.owner !== p.idx) return false;
  const sd = side === 0 ? (s.tick % 2 === 0 ? 1 : -1) : side > 0 ? 1 : -1;
  const dx = -p.fy * sd;
  const dy = p.fx * sd;
  setAction(p, 'feint', 0.3, dx, dy);
  p.vx = p.vx * 0.4 + dx * 4.8;
  p.vy = p.vy * 0.4 + dy * 4.8;
  p.evade = feintEvade(p.stats);
  p.feintCd = FEINT_COOLDOWN;
  s.events.push({ type: 'feint', p: p.idx, team: p.team, x: p.x, y: p.y });
  return true;
}

/** Avversario davanti (entro dist e con un minimo di allineamento allo sguardo). */
function opponentAhead(s: MatchState, p: PlayerState, maxD: number, minDot: number): PlayerState | null {
  let best: PlayerState | null = null;
  let bd = maxD;
  for (const q of s.players) {
    if (q.team === p.team || q.role === 'gk') continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d > bd) continue;
    const [rx, ry] = norm(q.x - p.x, q.y - p.y);
    if (rx * p.fx + ry * p.fy < minDot) continue;
    bd = d;
    best = q;
  }
  return best;
}

// Rotazione di ~6° per tick con coefficienti razionali: niente sin/cos, deterministica.
const ROT_T = 0.0524;
const ROT_C = (1 - ROT_T * ROT_T) / (1 + ROT_T * ROT_T);
const ROT_S = (2 * ROT_T) / (1 + ROT_T * ROT_T);
const VERONICA_TICKS = 30; // 30 × 6° ≈ 180°

/** Esegue la skill speciale del giocatore. Restituisce true se è partita. */
export function special(s: MatchState, p: PlayerState, side: number): boolean {
  if (!p.special || p.skillCd > 0 || p.stun > 0 || s.ball.owner !== p.idx) return false;
  const b = s.ball;
  const sd = side === 0 ? (s.tick % 2 === 0 ? 1 : -1) : side > 0 ? 1 : -1;
  const ev = () => s.events.push({ type: 'special', p: p.idx, team: p.team, skill: p.special ?? '', x: p.x, y: p.y });

  switch (p.special) {
    case 'veronica': {
      // Giro di 360° sulla palla che porta il giocatore ALLE SPALLE del difensore.
      const q = opponentAhead(s, p, 3, -0.2);
      setAction(p, 'veronica', VERONICA_TICKS * DT, p.fx, p.fy);
      p.evade = VERONICA_TICKS * DT + 0.1;
      if (q) {
        const r = clamp(dist(p.x, p.y, q.x, q.y), 1.0, 1.6);
        const [ox, oy] = norm(p.x - q.x, p.y - q.y);
        p.x = q.x + ox * r;
        p.y = q.y + oy * r;
        p.action.ax = q.x;
        p.action.ay = q.y;
        p.action.target = q.idx;
        // Gira dal lato che porta verso la porta avversaria.
        const cross = ox * 0 - oy * attackDir(p.team);
        p.action.side = cross >= 0 ? -1 : 1;
        if (side !== 0) p.action.side = sd;
        knockDown(q, 'stagger', VERONICA_TICKS * DT + 0.2);
      } else {
        p.vx = p.fx * 3.2;
        p.vy = p.fy * 3.2;
      }
      break;
    }
    case 'elastico': {
      setAction(p, 'elastico', 0.4, -p.fy * sd, p.fx * sd);
      p.action.side = sd;
      p.vx *= 0.3;
      p.vy *= 0.3;
      p.evade = 0.5;
      // Chi è davanti abbocca alla finta: resta piantato.
      for (const q of s.players) {
        if (q.team !== p.team && q.role !== 'gk' && dist(p.x, p.y, q.x, q.y) < 2.6) knockDown(q, 'stagger', 0.75);
      }
      break;
    }
    case 'sombrero': {
      // Palla alzata sopra la testa dell'avversario, poi la si riprende al volo.
      const q = opponentAhead(s, p, 3.2, 0.2);
      setAction(p, 'sombrero', 0.4, p.fx, p.fy);
      b.owner = -1;
      b.lastTouch = p.idx;
      b.kicker = -1;
      b.kickCd = 0;
      b.passTarget = p.idx;
      b.passKind = 2;
      b.x = p.x + p.fx * 0.4;
      b.y = p.y + p.fy * 0.4;
      b.z = 0.3;
      b.vx = p.fx * 5.5;
      b.vy = p.fy * 5.5;
      b.vz = 8.5;
      b.passTx = p.x + p.fx * 4.6;
      b.passTy = p.y + p.fy * 4.6;
      p.vx = p.fx * 5.5;
      p.vy = p.fy * 5.5;
      p.evade = 0.9;
      if (q) knockDown(q, 'stagger', 1.0);
      break;
    }
    case 'tunnel': {
      const q = opponentAhead(s, p, 2.8, 0.3);
      setAction(p, 'tunnel', 0.45, p.fx, p.fy);
      p.evade = 0.6;
      if (q) {
        knockDown(q, 'stagger', 0.95);
        p.action.target = q.idx;
        b.owner = -1;
        b.lastTouch = p.idx;
        b.kicker = -1;
        b.kickCd = 0;
        b.passTarget = p.idx;
        b.passKind = 1;
        // Palla esattamente sotto il difensore e oltre.
        const [dx, dy] = norm(q.x - b.x, q.y - b.y);
        b.vx = dx * 8.5;
        b.vy = dy * 8.5;
        b.vz = 0;
        b.passTx = q.x + dx * 2.5;
        b.passTy = q.y + dy * 2.5;
        // Il giocatore gira intorno al difensore.
        p.vx = p.fx * 3.5 - p.fy * sd * 4.5;
        p.vy = p.fy * 3.5 + p.fx * sd * 4.5;
        p.action.side = sd;
      } else {
        p.vx = p.fx * 5.5;
        p.vy = p.fy * 5.5;
      }
      break;
    }
    case 'rabona': {
      if (distToOppGoal(p) < 22) {
        p.skillCd = SKILL_COOLDOWN;
        ev();
        shoot(s, p, 0.85, sd * 0.8, 0.9, 14);
        setAction(p, 'rabona', 0.4, p.fx, p.fy);
        return true;
      }
      const t = pickPassTarget(s, p, attackDir(p.team), 0);
      if (t >= 0) {
        p.skillCd = SKILL_COOLDOWN;
        ev();
        lobPass(s, p, t, 14);
        setAction(p, 'rabona', 0.4, p.fx, p.fy);
        return true;
      }
      return false;
    }
  }
  p.skillCd = SKILL_COOLDOWN;
  p.stamina = Math.max(0, p.stamina - 0.12);
  ev();
  return true;
}

/**
 * Movimento guidato dalle skill (tick per tick). Restituisce true se la skill ha già
 * posizionato il giocatore in questo tick.
 */
export function skillTick(_s: MatchState, p: PlayerState): boolean {
  const a = p.action;
  if (a.kind === 'veronica' && a.target >= 0) {
    const ox = p.x - a.ax;
    const oy = p.y - a.ay;
    const sg = a.side;
    const nx = ox * ROT_C - sg * oy * ROT_S;
    const ny = sg * ox * ROT_S + oy * ROT_C;
    const px = a.ax + nx;
    const py = a.ay + ny;
    p.vx = (px - p.x) / DT;
    p.vy = (py - p.y) / DT;
    p.x = clamp(px, PHYS.playerRadius, FIELD.length - PHYS.playerRadius);
    p.y = clamp(py, PHYS.playerRadius, FIELD.width - PHYS.playerRadius);
    // Guarda nel verso del giro: la palla segue la suola.
    const [fx, fy] = norm(p.vx, p.vy);
    if (fx !== 0 || fy !== 0) {
      p.fx = fx;
      p.fy = fy;
    }
    if (a.t + DT >= a.dur) {
      // Uscita: rivolto lontano dal difensore, con slancio.
      const [ux, uy] = norm(p.x - a.ax, p.y - a.ay);
      p.fx = ux;
      p.fy = uy;
      p.vx = ux * 4.5;
      p.vy = uy * 4.5;
    }
    return true;
  }
  if (a.kind === 'elastico' && !a.done && a.t >= 0.16) {
    a.done = true;
    // Scatto dalla parte opposta a dove è andata la palla.
    p.vx = a.dx * 7 + p.fx * 2;
    p.vy = a.dy * 7 + p.fy * 2;
  }
  return false;
}
