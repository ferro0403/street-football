// Azioni del nucleo di gioco (Passo 1): passaggio, tiro, contrasto in piedi e scivolata.
// Le usano sia gli umani (solo quando premono il tasto) sia la CPU: regole identiche.
// Niente falli: un contrasto riesce o no, mai fischi o cadute da fallo.
import { CENTER_Y, FIELD, PHYS } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, randSigned, nextRandom } from './rng';
import { groundSpeedFor, rollTime } from './ball';
import {
  FREE_PASS_SPEED,
  LOST_BALL_STUN,
  PASS_ARRIVAL,
  SLIDE_COOLDOWN,
  SLIDE_DUR,
  SLIDE_MISS_DOWN,
  TACKLE_COOLDOWN,
  TACKLE_DUR,
  TACKLE_MISS_STUN,
  passError,
  shotError,
  shotSpeed,
  slideReach,
  slideSpeed,
  slideWinChance,
  tackleChance,
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

/**
 * Compagno da servire nella direzione indicata (cono di ~50° attorno alla levetta),
 * il più allineato e vicino. -1 se nessuno sta da quella parte.
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
    if (align < 0.64) continue; // fuori dal cono
    let score = align * 10 - d * 0.12;
    if (q.role === 'gk') score -= 4;
    if (score > bestScore) {
      bestScore = score;
      best = q.idx;
    }
  }
  return best;
}

/**
 * Passaggio rasoterra a un compagno: velocità calcolata con la stessa fisica della palla,
 * così ARRIVA SEMPRE e con la velocità giusta. Mira dove il compagno sta andando.
 */
export function pass(s: MatchState, p: PlayerState, target: number): void {
  const r = s.players[target];
  const vEnd = PASS_ARRIVAL * s.tune.pass;
  let tx = r.x;
  let ty = r.y;
  for (let i = 0; i < 2; i++) {
    const d = dist(p.x, p.y, tx, ty);
    const t = rollTime(groundSpeedFor(d, vEnd), d);
    tx = clamp(r.x + r.vx * t, 0.6, FIELD.length - 0.6);
    ty = clamp(r.y + r.vy * t, 0.6, FIELD.width - 0.6);
  }
  releaseBall(s, p);
  const b = s.ball;
  const d = dist(b.x, b.y, tx, ty);
  const v0 = groundSpeedFor(d, vEnd);
  let [dx, dy] = norm(tx - b.x, ty - b.y);
  [dx, dy] = wobble(dx, dy, passError(p.stats) * randSigned(s));
  b.vx = dx * v0;
  b.vy = dy * v0;
  b.passTarget = target;
  finishKick(s, p, dx, dy);
}

/** Passaggio nella direzione indicata senza compagni: la palla va lì (e rimbalza sui muri). */
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

// --- Contrasti ------------------------------------------------------------------------------

/** Da dove arriva il difensore rispetto a chi ha palla: 1 di fronte, 0 di lato, -1 da dietro. */
export function approach(carrier: PlayerState, def: PlayerState): number {
  const [rx, ry] = norm(def.x - carrier.x, def.y - carrier.y);
  return rx * carrier.fx + ry * carrier.fy;
}

function canAct(p: PlayerState): boolean {
  return p.stun <= 0 && (p.action.kind === 'none' || p.action.kind === 'kick');
}

/** Contrasto in piedi: breve allungo verso la palla. Solo su comando (umano o CPU). */
export function startTackle(s: MatchState, p: PlayerState): boolean {
  if (p.tackleCd > 0 || !canAct(p) || s.ball.owner === p.idx) return false;
  const b = s.ball;
  let [dx, dy] = norm(b.x - p.x, b.y - p.y);
  if (dx === 0 && dy === 0) [dx, dy] = [p.fx, p.fy];
  setAction(p, 'tackle', TACKLE_DUR, dx, dy);
  p.vx = dx * 4.5 + p.vx * 0.3;
  p.vy = dy * 4.5 + p.vy * 0.3;
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
  if (keep) {
    b.owner = p.idx;
    b.kicker = -1;
  } else {
    b.owner = -1;
    b.kicker = c.idx;
    b.kickCd = 0.4;
    b.vx = kx + randSigned(s) * 1.2;
    b.vy = ky + randSigned(s) * 1.2;
    b.vz = 0.8;
  }
  stagger(c, LOST_BALL_STUN);
  s.stats[p.team].tackles += 1;
}

/**
 * Avanza i contrasti in corso (ogni tick). Il contrasto in piedi si decide una volta, a metà
 * allungo; la scivolata prende la palla se il piede la raggiunge nella fase utile.
 * Alla fine dell'azione si torna SEMPRE liberi (vedi finishAction): mai bloccati.
 */
export function updateTackles(s: MatchState, p: PlayerState): void {
  const a = p.action;
  const b = s.ball;
  if (a.kind === 'tackle' && !a.done && a.t >= 0.1) {
    a.done = true;
    const fx = p.x + a.dx * 0.5;
    const fy = p.y + a.dy * 0.5;
    const reach = 0.8 + (p.stats.defense / 99) * 0.2;
    const c = b.owner >= 0 ? s.players[b.owner] : null;
    if (dist(fx, fy, b.x, b.y) > reach || b.z > 0.8 || (c && (c.team === p.team || c.role === 'gk'))) {
      stagger(p, TACKLE_MISS_STUN);
      s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
      return;
    }
    if (!c) {
      // Palla vagante: la tocca via nella direzione dell'allungo.
      b.vx = a.dx * 5 + b.vx * 0.3;
      b.vy = a.dy * 5 + b.vy * 0.3;
      b.lastTouch = p.idx;
      b.passTarget = -1;
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y });
      return;
    }
    const pr = clamp(tackleChance(p.stats, c.stats, approach(c, p)) * s.tune.tackle, 0.03, 0.97);
    if (chance(s, pr)) {
      takeBall(s, p, c, chance(s, 0.55), a.dx * 4, a.dy * 4);
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y });
    } else {
      stagger(p, TACKLE_MISS_STUN);
      s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
    }
    return;
  }
  if (a.kind === 'slide' && !a.done && a.t > 0.04 && a.t < 0.42) {
    const fx = p.x + a.dx * 0.6;
    const fy = p.y + a.dy * 0.6;
    if (dist(fx, fy, b.x, b.y) < slideReach(p.stats) && b.z < 0.6) {
      a.done = true;
      const c = b.owner >= 0 ? s.players[b.owner] : null;
      if (c && c.team !== p.team && c.role !== 'gk') {
        if (chance(s, clamp(slideWinChance(p.stats, c.stats) * s.tune.tackle, 0.05, 0.97))) {
          takeBall(s, p, c, false, a.dx * 6 + c.vx * 0.2, a.dy * 6 + c.vy * 0.2);
          s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y, skill: 'slide' });
        } else {
          a.done = false; // l'attaccante l'ha saltata: la scivolata finisce a vuoto
          a.t = 0.42;
        }
      } else if (!c) {
        b.vx = a.dx * 7;
        b.vy = a.dy * 7;
        b.lastTouch = p.idx;
        b.passTarget = -1;
        s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y, skill: 'slide' });
      }
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
