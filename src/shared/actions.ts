// Azioni del nucleo di gioco: passaggio, tiro, contrasto in piedi, scivolata.
// Le usano sia gli umani (solo quando premono il tasto) sia la CPU: regole identiche.
// Niente falli e niente dadi nei contrasti: conta dove sono piede, palla e corpi.
import { CENTER_Y, FIELD, PHYS } from './constants';
import { clamp, dist, len, norm } from './math';
import { nextRandom, randSigned } from './rng';
import { groundSpeedFor, predictCarriedBall } from './ball';
import {
  BODY_RADIUS,
  CLEAN_MARGIN,
  DODGED_STUN,
  FREE_PASS_SPEED,
  LOOSE_MARGIN,
  LOST_BALL_STUN,
  PASS_ARRIVAL,
  SLIDE_COOLDOWN,
  SLIDE_DUR,
  SLIDE_MISS_DOWN,
  TACKLE_CONTACT,
  TACKLE_COOLDOWN,
  TACKLE_DUR,
  TACKLE_LUNGE,
  TACKLE_MISS_STUN,
  footCover,
  passError,
  shieldRadius,
  shotError,
  shotSpeed,
  slideReach,
  slideSpeed,
  tackleReach,
} from './stats';
import type { ActionKind, MatchState, PlayerState } from './types';
import { attackDir, laneClear, oppGoalX, openness } from './world';

export function setAction(p: PlayerState, kind: ActionKind, dur: number, dx = 0, dy = 0): void {
  p.action = { kind, t: 0, dur, dx, dy, done: false };
}

/** Sbilancia un giocatore per un attimo (contrasto mancato, palla persa). */
export function stagger(p: PlayerState, dur: number): void {
  p.stun = Math.max(p.stun, dur);
  setAction(p, 'stagger', dur);
  p.charge = 0;
  p.charging = false;
}

function releaseBall(s: MatchState, p: PlayerState): void {
  const b = s.ball;
  b.owner = -1;
  b.lastTouch = p.idx;
  b.kicker = p.idx;
  b.kickCd = 0.25;
  b.passTarget = -1;
  b.shotActive = false;
  b.x = clamp(p.x + p.fx * 0.45, PHYS.ballRadius, FIELD.length - PHYS.ballRadius);
  b.y = clamp(p.y + p.fy * 0.45, PHYS.ballRadius, FIELD.width - PHYS.ballRadius);
  b.z = 0;
  b.vz = 0;
  p.charge = 0;
  p.charging = false;
}

// --- Passaggio -------------------------------------------------------------------------

/** Ruota leggermente una direzione (errore del passaggio), senza trigonometria. */
function wobble(dx: number, dy: number, e: number): [number, number] {
  return norm(dx - dy * e, dy + dx * e);
}

/** Mezza apertura del cono di scelta del compagno: ~70° per parte (coseno). */
const PASS_CONE = 0.34;
/** Passaggio libero contro il muro solo se il muro è vicino in quella direzione (m). */
const WALL_PASS_DIST = 7;

/**
 * Compagno da servire nella direzione indicata: il più allineato con la levetta dentro un
 * cono largo (~70° per parte). -1 se nessuno sta da quella parte.
 */
export function passTargetInDir(s: MatchState, p: PlayerState, dirX: number, dirY: number): number {
  const [ux, uy] = norm(dirX, dirY);
  if (ux === 0 && uy === 0) return -1;
  let best = -1;
  let bestScore = -Infinity;
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx) continue;
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < 1) continue;
    const [qx, qy] = norm(q.x - p.x, q.y - p.y);
    const align = qx * ux + qy * uy;
    if (align < PASS_CONE) continue;
    let score = align * 10 - d * 0.1;
    if (q.role === 'gk') score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = q.idx;
    }
  }
  return best;
}

/** Distanza dal muro della gabbia andando in quella direzione. */
function wallDistance(x: number, y: number, ux: number, uy: number): number {
  let t = Infinity;
  if (ux > 1e-6) t = Math.min(t, (FIELD.length - x) / ux);
  if (ux < -1e-6) t = Math.min(t, -x / ux);
  if (uy > 1e-6) t = Math.min(t, (FIELD.width - y) / uy);
  if (uy < -1e-6) t = Math.min(t, -y / uy);
  return t;
}

/** Il compagno più libero (per quando nessuno sta nella direzione indicata). */
export function bestOpenMate(s: MatchState, p: PlayerState): number {
  let best = -1;
  let bv = -Infinity;
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx) continue;
    const v = passValue(s, p, q);
    if (v > bv) {
      bv = v;
      best = q.idx;
    }
  }
  return best;
}

export interface PassChoice {
  /** Compagno che riceve, -1 per il passaggio libero verso il muro. */
  target: number;
  /** Direzione del passaggio libero (solo se target = -1). */
  wx: number;
  wy: number;
}

/**
 * Scelta del passaggio di chi preme il tasto: il compagno verso cui punti; se non c'è,
 * contro il muro SOLO se punti un muro vicino (di proposito); altrimenti il compagno più
 * libero. Mai nel vuoto.
 */
export function choosePass(s: MatchState, p: PlayerState, mx: number, my: number): PassChoice {
  const hasDir = len(mx, my) > 0.2;
  const t = passTargetInDir(s, p, hasDir ? mx : p.fx, hasDir ? my : p.fy);
  if (t >= 0) return { target: t, wx: 0, wy: 0 };
  if (hasDir) {
    const [ux, uy] = norm(mx, my);
    if (wallDistance(p.x, p.y, ux, uy) < WALL_PASS_DIST) return { target: -1, wx: ux, wy: uy };
  }
  return { target: bestOpenMate(s, p), wx: 0, wy: 0 };
}

/**
 * Passaggio rasoterra a un compagno: veloce e diretto alla sua posizione ATTUALE (niente
 * anticipo). La velocità è calcolata con la stessa fisica della palla: arriva sempre, e
 * il compagno va incontro alla palla invece di scappare.
 */
export function pass(s: MatchState, p: PlayerState, target: number): void {
  const r = s.players[target];
  const vEnd = PASS_ARRIVAL * s.tune.pass;
  releaseBall(s, p);
  const b = s.ball;
  const d = dist(b.x, b.y, r.x, r.y);
  const v0 = groundSpeedFor(d, vEnd);
  let [dx, dy] = norm(r.x - b.x, r.y - b.y);
  [dx, dy] = wobble(dx, dy, passError(p.stats) * randSigned(s));
  b.vx = dx * v0;
  b.vy = dy * v0;
  b.passTarget = target;
  finishKick(s, p, dx, dy);
}

/** Passaggio contro il muro, di proposito: la palla va lì e rimbalza (angolo speculare). */
export function freePass(s: MatchState, p: PlayerState, dirX: number, dirY: number): void {
  releaseBall(s, p);
  const b = s.ball;
  const [dx, dy] = norm(dirX, dirY);
  const v = FREE_PASS_SPEED * s.tune.pass;
  b.vx = dx * v;
  b.vy = dy * v;
  finishKick(s, p, dx, dy);
}

function finishKick(s: MatchState, p: PlayerState, dx: number, dy: number): void {
  const b = s.ball;
  p.fx = dx;
  p.fy = dy;
  s.stats[p.team].passes += 1;
  setAction(p, 'kick', 0.22, dx, dy);
  s.events.push({ type: 'pass', p: p.idx, team: p.team, power: len(b.vx, b.vy), x: b.x, y: b.y });
}

/** Valutazione di un compagno come destinatario (per la CPU). */
export function passValue(s: MatchState, p: PlayerState, q: PlayerState): number {
  const dir = attackDir(p.team);
  const d = dist(p.x, p.y, q.x, q.y);
  let v = (q.x - p.x) * dir * 0.3 + openness(s, p.team, q.x, q.y) * 0.7;
  v -= Math.abs(d - 9) * 0.08;
  if (q.role === 'gk') v -= 6;
  if (!laneClear(s, p.team, p.x, p.y, q.x, q.y, 0.9)) v -= 4;
  return v;
}

// --- Tiro --------------------------------------------------------------------------------

/** Mira laterale (-1..1 sull'asse y della porta) dalla levetta. */
export function shotAim(my: number): number {
  return clamp(my * 1.3, -1, 1);
}

/** Punto della porta avversaria verso cui si mira (senza errore). */
export function shotTarget(p: PlayerState, aim: number): [number, number] {
  return [oppGoalX(p.team), CENTER_Y + clamp(aim, -1, 1) * (FIELD.goalWidth / 2 - 0.35)];
}

/**
 * Tiro verso la porta, nella direzione indicata. charge 0..1: un tocco è già un buon tiro,
 * tenendo premuto è più forte (e un po' meno preciso).
 */
export function shoot(s: MatchState, p: PlayerState, charge: number, aim: number): void {
  charge = clamp(charge, 0, 1);
  const [gx, ty0] = shotTarget(p, aim);
  const d0 = dist(p.x, p.y, gx, ty0);
  const err = shotError(p.stats) * (0.35 + charge * 0.65) * (0.5 + d0 / 22);
  const ty = ty0 + randSigned(s) * err;
  const vh = shotSpeed(p.stats, charge) * s.tune.shot;
  // Altezza all'arrivo: rasoterra o a mezza altezza, raramente sopra la traversa.
  const th = clamp(0.25 + charge * 0.6 + nextRandom(s) * 0.4 * charge, 0.15, 1.9);
  releaseBall(s, p);
  const b = s.ball;
  const d = dist(b.x, b.y, gx, ty);
  const t = Math.max(0.15, d / vh);
  const [dx, dy] = norm(gx - b.x, ty - b.y);
  b.vx = dx * vh;
  b.vy = dy * vh;
  b.vz = clamp((th + 0.5 * PHYS.gravity * t * t) / t, 0.5, 14);
  b.shotId += 1;
  b.shotActive = true;
  b.shotTeam = p.team;
  b.shotX = b.x;
  b.shotY = b.y;
  s.stats[p.team].shots += 1;
  p.fx = dx;
  p.fy = dy;
  setAction(p, 'shoot', 0.3, dx, dy);
  s.events.push({ type: 'shot', p: p.idx, team: p.team, power: vh, x: b.x, y: b.y });
}

// --- Contrasti: fisici e leggibili -----------------------------------------------------------

/** Da dove arriva il difensore rispetto a chi ha palla: 1 di fronte, 0 di lato, -1 da dietro. */
export function approach(carrier: PlayerState, def: PlayerState): number {
  const [rx, ry] = norm(def.x - carrier.x, def.y - carrier.y);
  return rx * carrier.fx + ry * carrier.fy;
}

function canAct(p: PlayerState): boolean {
  return p.stun <= 0 && (p.action.kind === 'none' || p.action.kind === 'kick');
}

export type TackleOutcome = 'steal' | 'loose' | 'glued' | 'blocked' | 'short' | 'dodged';

/**
 * Esito FISICO di un contrasto con il piede che parte da (fx,fy) con portata `reach`.
 * Nessun dado: conta solo la posizione di palla, piede e corpo nel momento del contatto.
 * - short:   il piede non arriva alla palla
 * - blocked: per arrivarci dovrebbe passare attraverso il corpo (da dietro, o protetta)
 * - dodged:  l'attaccante ha appena cambiato direzione o è scattato (schivata)
 * - glued:   la palla è sotto il suo piede (attaccata)
 * - loose:   la palla è al limite: schizza via libera (50/50)
 * - steal:   la palla era lontana dal piede: rubata
 */
export function tackleOutcome(s: MatchState, fx: number, fy: number, reach: number, c: PlayerState): TackleOutcome {
  const b = s.ball;
  return tackleGeometry(s, fx, fy, reach, b.x, b.y, c.x, c.y, c, c.evade);
}

/** Lo stesso esito, con posizioni esplicite (serve alla CPU per prevedere il momento giusto). */
function tackleGeometry(
  s: MatchState,
  fx: number,
  fy: number,
  reach: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  c: PlayerState,
  evade: number,
  bias = 0,
): TackleOutcome {
  const k = s.tune.tackle;
  if (dist(fx, fy, bx, by) > reach * k) return 'short';
  const body = c.shielding ? shieldRadius(c.stats) : BODY_RADIUS;
  const vx = bx - fx;
  const vy = by - fy;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 1e-9 ? clamp(((cx - fx) * vx + (cy - fy) * vy) / l2, 0, 1) : 0;
  if (dist(fx + vx * t, fy + vy * t, cx, cy) < body) return 'blocked';
  if (evade > 0) return 'dodged';
  const margin = dist(cx, cy, bx, by) - footCover(c.stats) + (k - 1) * 0.15 + bias;
  if (margin > CLEAN_MARGIN) return 'steal';
  if (margin > LOOSE_MARGIN) return 'loose';
  return 'glued';
}

/**
 * La CPU "legge" il tocco: come andrebbe un contrasto che parte tra `wait` secondi? Usa il
 * ritmo dei tocchi del portatore e la sua corsa attuale (se cambia direzione, sbaglia).
 * `bias` > 0 = più ottimista (difensore aggressivo: entra anche quando è al limite).
 */
export function predictTackle(s: MatchState, p: PlayerState, c: PlayerState, wait: number, bias = 0): TackleOutcome {
  const T = wait + TACKLE_CONTACT;
  const [bx, by] = predictCarriedBall(c, T);
  const cx = c.x + c.vx * T;
  const cy = c.y + c.vy * T;
  const px = p.x + p.vx * wait;
  const py = p.y + p.vy * wait;
  const [dx, dy] = norm(bx - px, by - py);
  const fx = px + dx * TACKLE_LUNGE * TACKLE_CONTACT * 0.8;
  const fy = py + dy * TACKLE_LUNGE * TACKLE_CONTACT * 0.8;
  return tackleGeometry(s, fx, fy, tackleReach(p.stats), bx, by, cx, cy, c, c.evade - T, bias);
}

/** Come sopra, per la scivolata: dove arriverà il piede dopo `t` secondi di scivolata. */
export function predictSlide(s: MatchState, p: PlayerState, c: PlayerState, t: number): TackleOutcome {
  const [bx, by] = predictCarriedBall(c, t);
  const [dx, dy] = norm(bx - p.x, by - p.y);
  const run = slideSpeed(p.stats) * t * 0.8;
  const fx = p.x + dx * run;
  const fy = p.y + dy * run;
  return tackleGeometry(s, fx, fy, 0.6 + slideReach(p.stats), bx, by, c.x + c.vx * t, c.y + c.vy * t, c, c.evade - t);
}

/** Contrasto in piedi: breve allungo verso la palla. Solo su comando (umano o CPU). */
export function startTackle(s: MatchState, p: PlayerState): boolean {
  if (p.tackleCd > 0 || !canAct(p) || s.ball.owner === p.idx) return false;
  const b = s.ball;
  let [dx, dy] = norm(b.x - p.x, b.y - p.y);
  if (dx === 0 && dy === 0) [dx, dy] = [p.fx, p.fy];
  setAction(p, 'tackle', TACKLE_DUR, dx, dy);
  p.vx = dx * TACKLE_LUNGE + p.vx * 0.3;
  p.vy = dy * TACKLE_LUNGE + p.vy * 0.3;
  p.fx = dx;
  p.fy = dy;
  p.tackleCd = TACKLE_COOLDOWN;
  return true;
}

/** Scivolata: lunga, rischiosa. Solo su comando (umano o CPU). */
export function startSlide(s: MatchState, p: PlayerState): boolean {
  if (p.slideCd > 0 || !canAct(p) || s.ball.owner === p.idx) return false;
  const b = s.ball;
  const c = b.owner >= 0 ? s.players[b.owner] : null;
  const tx = c ? b.x + c.vx * 0.2 : b.x + b.vx * 0.15;
  const ty = c ? b.y + c.vy * 0.2 : b.y + b.vy * 0.15;
  let [dx, dy] = norm(tx - p.x, ty - p.y);
  if (dx === 0 && dy === 0) [dx, dy] = [p.fx, p.fy];
  setAction(p, 'slide', SLIDE_DUR, dx, dy);
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

/** Palla tolta al portatore: la si tiene o schizza via; lui resta sbilanciato un istante. */
function takeBall(s: MatchState, p: PlayerState, c: PlayerState, keep: boolean, kx: number, ky: number): void {
  const b = s.ball;
  b.lastTouch = p.idx;
  b.passTarget = -1;
  b.shotActive = false;
  c.shielding = false;
  if (keep) {
    b.owner = p.idx;
    b.kicker = -1;
  } else {
    b.owner = -1;
    b.kicker = c.idx;
    b.kickCd = 0.35;
    b.vx = kx;
    b.vy = ky;
    b.vz = 0.6;
  }
  stagger(c, LOST_BALL_STUN);
  s.stats[p.team].tackles += 1;
}

/** Direzione (normalizzata) in cui schizza una palla contesa: tra l'allungo e la corsa del portatore. */
function looseDir(dx: number, dy: number, c: PlayerState): [number, number] {
  const [cx, cy] = norm(c.vx, c.vy);
  // Lato deterministico: dalla parte in cui stava andando l'attaccante.
  const side = dx * cy - dy * cx >= 0 ? 1 : -1;
  return norm(dx + cx * 0.6 - dy * side * 0.5, dy + cy * 0.6 + dx * side * 0.5);
}

/**
 * Avanza i contrasti in corso (ogni tick). Il contrasto in piedi si decide una volta, al
 * contatto; la scivolata prende la palla se il piede la raggiunge nella fase utile.
 * Alla fine dell'azione si torna SEMPRE liberi (vedi finishAction): mai bloccati.
 */
export function updateTackles(s: MatchState, p: PlayerState): void {
  const a = p.action;
  const b = s.ball;
  if (a.kind === 'tackle' && !a.done && a.t >= TACKLE_CONTACT) {
    a.done = true;
    const c = b.owner >= 0 ? s.players[b.owner] : null;
    if (!c) {
      // Palla vagante: se il piede ci arriva, la tocca via nella direzione dell'allungo.
      if (dist(p.x, p.y, b.x, b.y) <= tackleReach(p.stats) * s.tune.tackle && b.z < 0.8) {
        b.vx = a.dx * 5 + b.vx * 0.3;
        b.vy = a.dy * 5 + b.vy * 0.3;
        b.lastTouch = p.idx;
        b.passTarget = -1;
        s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y });
      } else {
        stagger(p, TACKLE_MISS_STUN);
        s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
      }
      return;
    }
    if (c.team === p.team || c.role === 'gk') {
      stagger(p, TACKLE_MISS_STUN);
      return;
    }
    const out = tackleOutcome(s, p.x, p.y, tackleReach(p.stats), c);
    if (out === 'steal') {
      takeBall(s, p, c, true, 0, 0);
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y });
    } else if (out === 'loose') {
      const [lx, ly] = looseDir(a.dx, a.dy, c);
      takeBall(s, p, c, false, lx * 5.5, ly * 5.5);
      s.events.push({ type: 'tackleLoose', p: p.idx, team: p.team, x: b.x, y: b.y });
    } else {
      stagger(p, out === 'dodged' ? DODGED_STUN : TACKLE_MISS_STUN);
      // Lo slancio lo porta oltre: deve recuperare.
      p.vx = a.dx * 2.5;
      p.vy = a.dy * 2.5;
      s.events.push({ type: out === 'dodged' ? 'dodge' : 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y, skill: out });
    }
    return;
  }
  if (a.kind === 'slide' && !a.done && a.t > 0.04 && a.t < 0.42) {
    const fx = p.x + a.dx * 0.6;
    const fy = p.y + a.dy * 0.6;
    if (b.z >= 0.6 || dist(fx, fy, b.x, b.y) > slideReach(p.stats) * s.tune.tackle) return;
    const c = b.owner >= 0 ? s.players[b.owner] : null;
    if (c && (c.team === p.team || c.role === 'gk')) return;
    if (c) {
      const out = tackleOutcome(s, p.x, p.y, 0.6 + slideReach(p.stats), c);
      if (out === 'blocked' || out === 'dodged') {
        // Addosso al corpo o saltata: la scivolata finisce a vuoto (niente fallo).
        a.t = 0.42;
        if (out === 'dodged') s.events.push({ type: 'dodge', p: p.idx, team: p.team, x: p.x, y: p.y, skill: 'slide' });
        return;
      }
      if (out === 'short') return;
      a.done = true;
      // La scivolata non tiene palla: la porta via, pulita (si allunga meglio del contrasto).
      takeBall(s, p, c, false, a.dx * 6.5 + c.vx * 0.2, a.dy * 6.5 + c.vy * 0.2);
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y, skill: 'slide' });
    } else {
      a.done = true;
      b.vx = a.dx * 7;
      b.vy = a.dy * 7;
      b.lastTouch = p.idx;
      b.passTarget = -1;
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y, skill: 'slide' });
    }
  }
}

/** Fine di un'azione: la scivolata a vuoto lascia a terra un attimo, tutto il resto torna libero. */
export function finishAction(p: PlayerState): void {
  const a = p.action;
  if (a.kind === 'slide' && !a.done) {
    p.stun = Math.max(p.stun, SLIDE_MISS_DOWN);
    setAction(p, 'fall', SLIDE_MISS_DOWN);
    return;
  }
  setAction(p, 'none', 0);
}

