// I muri della gabbia come arma: passaggi al muro, uno-due col muro e tiri di sponda.
// Il punto di rimbalzo si calcola in forma chiusa con la stessa fisica di stepBall
// (componente normale × restituzione, tangenziale invariata): la previsione mostrata
// dalla linea di mira coincide con quello che succede davvero.
import { CENTER_Y, FIELD, PHYS } from './constants';
import { dist, norm } from './math';
import { groundSpeedFor } from './ball';
import type { MatchState, PlayerState } from './types';
import { attackDir, oppGoalX } from './world';

const R = PHYS.ballRadius;
const L = FIELD.length;
const W = FIELD.width;

export type WallId = 'y0' | 'yW' | 'x0' | 'xL';

export interface WallPlan {
  wall: WallId;
  /** Punto di partenza, rimbalzo e arrivo. */
  sx: number;
  sy: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  /** Direzione e velocità iniziale. */
  dx: number;
  dy: number;
  v0: number;
  receiver: number;
}

/** Posizione del muro (per il centro della palla). Le pareti di fondo hanno la porta. */
function wallLine(w: WallId): number {
  return w === 'y0' ? R : w === 'yW' ? W - R : w === 'x0' ? 0 : L;
}

function inGoalMouth(w: WallId, y: number): boolean {
  return (w === 'x0' || w === 'xL') && Math.abs(y - CENTER_Y) < FIELD.goalWidth / 2 + 0.4;
}

/**
 * Punto di rimbalzo su un muro per andare da P a T, con restituzione e.
 * Restituisce null se P e T non stanno dalla stessa parte o il punto è fuori dal muro.
 */
export function bouncePoint(w: WallId, px: number, py: number, tx: number, ty: number, e: number): [number, number] | null {
  const c = wallLine(w);
  if (w === 'y0' || w === 'yW') {
    const pn = w === 'y0' ? py - c : c - py;
    const tn = w === 'y0' ? ty - c : c - ty;
    if (pn <= 0.05 || tn <= 0.05) return null;
    const k = tn / (e * pn);
    const bx = (tx + k * px) / (1 + k);
    if (bx < 0.5 || bx > L - 0.5) return null;
    return [bx, c];
  }
  const pn = w === 'x0' ? px - c : c - px;
  const tn = w === 'x0' ? tx - c : c - tx;
  if (pn <= 0.05 || tn <= 0.05) return null;
  const k = tn / (e * pn);
  const by = (ty + k * py) / (1 + k);
  if (by < 0.5 || by > W - 0.5 || inGoalMouth(w, by)) return null;
  return [c, by];
}

/** Il primo muro colpito andando da (x,y) in direzione (dx,dy), entro maxD metri. */
export function firstWall(x: number, y: number, dx: number, dy: number, maxD: number): { w: WallId; t: number; hx: number; hy: number } | null {
  let best: { w: WallId; t: number; hx: number; hy: number } | null = null;
  const test = (w: WallId, t: number) => {
    if (t <= 0.2 || t > maxD) return;
    const hx = x + dx * t;
    const hy = y + dy * t;
    if (hx < -0.01 || hx > L + 0.01 || hy < -0.01 || hy > W + 0.01) return;
    if (inGoalMouth(w, hy)) return;
    if (!best || t < best.t) best = { w, t, hx, hy };
  };
  if (dy < -1e-3) test('y0', (R - y) / dy);
  if (dy > 1e-3) test('yW', (W - R - y) / dy);
  if (dx < -1e-3) test('x0', -x / dx);
  if (dx > 1e-3) test('xL', (L - x) / dx);
  return best;
}

/** Direzione dopo il rimbalzo (stessa regola di stepBall). */
export function reflectDir(w: WallId, dx: number, dy: number, e: number): [number, number] {
  return w === 'y0' || w === 'yW' ? norm(dx, -dy * e) : norm(-dx * e, dy);
}

/** Velocità da dare alla palla perché rimbalzi in H e arrivi in T a vEnd. */
function speedVia(s: MatchState, w: WallId, sx: number, sy: number, hx: number, hy: number, tx: number, ty: number, vEnd: number): number {
  const e = s.tune.wall;
  const f = s.tune.friction;
  const d1 = dist(sx, sy, hx, hy);
  const d2 = dist(hx, hy, tx, ty);
  const [ux, uy] = norm(hx - sx, hy - sy);
  const side = w === 'y0' || w === 'yW';
  const ut = side ? ux : uy;
  const un = side ? uy : ux;
  const keep = Math.sqrt(ut * ut + e * e * un * un);
  const vOut = groundSpeedFor(d2, vEnd, f);
  return groundSpeedFor(d1, vOut / Math.max(0.2, keep), f);
}

function plan(s: MatchState, w: WallId, sx: number, sy: number, tx: number, ty: number, vEnd: number, receiver: number): WallPlan | null {
  const h = bouncePoint(w, sx, sy, tx, ty, s.tune.wall);
  if (!h) return null;
  const v0 = speedVia(s, w, sx, sy, h[0], h[1], tx, ty, vEnd);
  if (v0 >= PHYS.maxBallSpeed - 0.5) return null;
  const [dx, dy] = norm(h[0] - sx, h[1] - sy);
  return { wall: w, sx, sy, hx: h[0], hy: h[1], tx, ty, dx, dy, v0, receiver };
}

/**
 * Passaggio al muro verso un compagno: la levetta punta un muro, il compagno è quello
 * meglio allineato col rimbalzo. Null se il muro è lontano o nessuno può riceverla.
 */
export function planWallPass(s: MatchState, p: PlayerState, dirX: number, dirY: number): WallPlan | null {
  const b = s.ball;
  const [ux, uy] = norm(dirX, dirY);
  if (ux === 0 && uy === 0) return null;
  const hit = firstWall(b.x, b.y, ux, uy, 13);
  if (!hit) return null;
  const [rx, ry] = reflectDir(hit.w, ux, uy, s.tune.wall);
  let best: PlayerState | null = null;
  let bestScore = -Infinity;
  for (const q of s.players) {
    if (!q.active || q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const along = (q.x - hit.hx) * rx + (q.y - hit.hy) * ry;
    if (along < 1.5) continue;
    const perp = Math.abs((q.x - hit.hx) * -ry + (q.y - hit.hy) * rx);
    if (perp > 3.5 + along * 0.15 || hit.t + along > 24) continue;
    const score = -perp - (hit.t + along) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  if (!best) return null;
  // Anticipo del compagno, poi rimbalzo esatto verso di lui.
  const tEst = (hit.t + dist(hit.hx, hit.hy, best.x, best.y)) / 13;
  const tx = Math.min(L - 0.8, Math.max(0.8, best.x + best.vx * tEst * 0.8));
  const ty = Math.min(W - 0.8, Math.max(0.8, best.y + best.vy * tEst * 0.8));
  return plan(s, hit.w, b.x, b.y, tx, ty, 6, best.idx) ?? plan(s, hit.w, b.x, b.y, best.x, best.y, 6, best.idx);
}

/**
 * Uno-due col muro: la palla torna davanti al giocatore stesso, oltre il difensore.
 * Si usa il muro indicato dalla levetta (o il più vicino in avanti).
 */
export function planWallOneTwo(s: MatchState, p: PlayerState, dirX: number, dirY: number): WallPlan | null {
  const b = s.ball;
  const ad = attackDir(p.team);
  // Dove riceverla: avanti nella direzione di corsa, verso la porta avversaria.
  const [fx, fy] = norm(p.fx + ad * 0.8, p.fy);
  const lead = 5.5;
  let qx = p.x + fx * lead;
  let qy = p.y + fy * lead;
  const gx = oppGoalX(p.team);
  qx = ad > 0 ? Math.min(qx, gx - 1.5) : Math.max(qx, gx + 1.5);
  qx = Math.min(L - 1, Math.max(1, qx));
  qy = Math.min(W - 1, Math.max(1, qy));
  let [ux, uy] = norm(dirX, dirY);
  if (ux === 0 && uy === 0) [ux, uy] = [0, p.y < CENTER_Y ? -1 : 1];
  const hit = firstWall(b.x, b.y, ux, uy, 9);
  const walls: WallId[] = hit ? [hit.w] : [p.y < CENTER_Y ? 'y0' : 'yW'];
  for (const w of walls) {
    const pl = plan(s, w, b.x, b.y, qx, qy, 4.5, p.idx);
    if (pl && dist(pl.hx, pl.hy, b.x, b.y) < 10) return pl;
  }
  return null;
}

/**
 * Tiro di sponda: la palla rimbalza sul muro laterale ed entra in porta.
 * side: muro y=0 (-1) o y=W (+1). Valido solo se il rimbalzo cade prima della porta.
 */
export function planBankShot(s: MatchState, p: PlayerState, side: -1 | 1, aimY: number): { hx: number; hy: number; dx: number; dy: number; d: number } | null {
  const b = s.ball;
  const gx = oppGoalX(p.team);
  const w: WallId = side < 0 ? 'y0' : 'yW';
  const h = bouncePoint(w, b.x, b.y, gx, aimY, s.tune.wall);
  if (!h) return null;
  const ad = attackDir(p.team);
  if ((h[0] - b.x) * ad < 1 || (gx - h[0]) * ad < 2) return null;
  const [dx, dy] = norm(h[0] - b.x, h[1] - b.y);
  return { hx: h[0], hy: h[1], dx, dy, d: dist(b.x, b.y, h[0], h[1]) + dist(h[0], h[1], gx, aimY) };
}

/** La levetta punta un muro (entro maxD) senza compagni in quella direzione (~30°)? */
export function wallAimed(s: MatchState, p: PlayerState, mx: number, my: number, maxD: number): boolean {
  if (Math.sqrt(mx * mx + my * my) < 0.5) return false;
  const [ux, uy] = norm(mx, my);
  if (!firstWall(s.ball.x, s.ball.y, ux, uy, maxD)) return false;
  for (const q of s.players) {
    if (!q.active || q.team !== p.team || q.idx === p.idx) continue;
    const [qx, qy] = norm(q.x - p.x, q.y - p.y);
    if (qx * ux + qy * uy > 0.87 && dist(p.x, p.y, q.x, q.y) < 20) return false;
  }
  return true;
}
