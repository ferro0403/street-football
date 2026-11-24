// Fisica della palla: gravità, rimbalzi sul terreno, attrito, effetto, pareti della gabbia,
// pali e reti. La gabbia è chiusa: l'unico modo per superare le linee di fondo è entrare in porta.
import { CENTER_Y, DT, FIELD, PHYS } from './constants';
import { len } from './math';
import { randSigned } from './rng';
import { TOUCH, touchPushMult } from './stats';
import type { MatchState, PlayerState } from './types';

const R = PHYS.ballRadius;
const HALF_GOAL = FIELD.goalWidth / 2;

/** Un passo di rotolamento (palla a terra): stessa formula usata da stepBall. */
function rollStep(speed: number): number {
  return Math.max(0, speed - (PHYS.rollFriction + PHYS.rollDrag * speed) * DT);
}

/** Distanza percorsa rotolando da v0 finché la velocità scende a vEnd (stessa integrazione del gioco). */
export function rollDistance(v0: number, vEnd: number): number {
  let v = v0;
  let d = 0;
  let guard = 0;
  while (v > vEnd && guard++ < 2000) {
    const nv = rollStep(v);
    d += nv * DT; // stepBall integra la posizione con la velocità aggiornata
    v = nv;
    if (nv === 0) break;
  }
  return d;
}

/**
 * Velocità iniziale per un rasoterra che percorre `dist` metri e arriva a `vEnd` m/s.
 * Bisezione deterministica sulla stessa fisica di stepBall: il passaggio arriva davvero.
 */
export function groundSpeedFor(dist: number, vEnd: number): number {
  let lo = vEnd;
  let hi: number = PHYS.maxBallSpeed;
  if (rollDistance(hi, vEnd) < dist) return hi;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, vEnd) < dist) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Secondi per percorrere `dist` rotolando partendo da v0 (stima per gli anticipi). */
export function rollTime(v0: number, dist: number): number {
  let v = v0;
  let d = 0;
  let t = 0;
  while (d < dist && v > 0.05 && t < 6) {
    v = rollStep(v);
    d += v * DT;
    t += DT;
  }
  return t;
}

/** Avanza la palla libera di un tick. Restituisce la squadra che ha segnato o -1. */
export function stepBall(s: MatchState): number {
  const b = s.ball;
  const ev = s.events;

  const hs = len(b.vx, b.vy);
  if (hs > PHYS.maxBallSpeed) {
    const k = PHYS.maxBallSpeed / hs;
    b.vx *= k;
    b.vy *= k;
  }

  const airborne = b.z > 0.001 || b.vz > 0;
  if (airborne) {
    b.vz -= PHYS.gravity * DT;
    const drag = 1 - PHYS.airDrag * DT;
    b.vx *= drag;
    b.vy *= drag;
  } else {
    const sp = len(b.vx, b.vy);
    if (sp > 0) {
      const k = rollStep(sp) / sp;
      b.vx *= k;
      b.vy *= k;
    }
  }

  const px = b.x;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;

  if (b.z < 0) {
    b.z = 0;
    if (b.vz < -1.6) {
      const impact = -b.vz;
      b.vz = impact * PHYS.groundRestitution;
      b.vx *= 0.9;
      b.vy *= 0.9;
      if (impact > 3) ev.push({ type: 'bounce', power: impact, x: b.x, y: b.y });
    } else {
      b.vz = 0;
    }
  }

  if (b.z > FIELD.roofHeight - R) {
    b.z = FIELD.roofHeight - R;
    if (b.vz > 0) b.vz = -b.vz * 0.4;
    ev.push({ type: 'wall', power: 4, x: b.x, y: b.y, z: b.z });
  }

  if (b.y < R) {
    b.y = R;
    if (b.vy < 0) {
      wallHit(s, Math.abs(b.vy));
      b.vy = -b.vy * PHYS.wallRestitution;
    }
  } else if (b.y > FIELD.width - R) {
    b.y = FIELD.width - R;
    if (b.vy > 0) {
      wallHit(s, Math.abs(b.vy));
      b.vy = -b.vy * PHYS.wallRestitution;
    }
  }

  if (b.x < 0 || b.x > FIELD.length) return insideGoal(s, px);
  return -1;
}

function wallHit(s: MatchState, speed: number): void {
  if (speed > 2.5) s.events.push({ type: 'wall', power: speed, x: s.ball.x, y: s.ball.y, z: s.ball.z });
}

function insideGoal(s: MatchState, prevX: number): number {
  const b = s.ball;
  const left = b.x < 0;
  const lineX = left ? 0 : FIELD.length;
  const dy = Math.abs(b.y - CENTER_Y);
  const wasInside = left ? prevX < 0 : prevX > FIELD.length;

  if (!wasInside && b.inGoal < 0) {
    if (dy < HALF_GOAL - R && b.z < FIELD.goalHeight - R) {
      const scoringTeam = left ? 1 : 0;
      b.inGoal = scoringTeam;
      clampInNet(s, left);
      return scoringTeam;
    }
    const nearPost = dy < HALF_GOAL + R && b.z < FIELD.goalHeight + R;
    b.x = left ? R : FIELD.length - R;
    const speed = Math.abs(b.vx);
    if (nearPost) {
      b.vx = -b.vx * PHYS.postRestitution;
      b.vy += randSigned(s) * 2.5;
      b.vz = Math.abs(b.vz) * 0.5 + 1;
      s.events.push({ type: 'post', power: speed, x: lineX, y: b.y, z: b.z });
    } else {
      b.vx = -b.vx * PHYS.wallRestitution;
      wallHit(s, speed);
    }
    return -1;
  }

  clampInNet(s, left);
  return -1;
}

function clampInNet(s: MatchState, left: boolean): void {
  const b = s.ball;
  const back = left ? -FIELD.goalDepth + R : FIELD.length + FIELD.goalDepth - R;
  if (left ? b.x < back : b.x > back) {
    b.x = back;
    b.vx = -b.vx * 0.15;
  }
  const side = HALF_GOAL - R;
  if (b.y < CENTER_Y - side) {
    b.y = CENTER_Y - side;
    b.vy = -b.vy * 0.2;
  } else if (b.y > CENTER_Y + side) {
    b.y = CENTER_Y + side;
    b.vy = -b.vy * 0.2;
  }
  if (b.z > FIELD.goalHeight - R) {
    b.z = FIELD.goalHeight - R;
    b.vz = -Math.abs(b.vz) * 0.2;
  }
  b.vx *= 0.9;
  b.vy *= 0.9;
}

/**
 * Distanza palla-corpo durante la conduzione. A ogni tocco la palla si allontana dal piede e
 * torna: quando è lontana si può rubare, quando è sotto il piede no. Da fermi la palla sta
 * un po' davanti (contrastabile di fronte); proteggendo resta attaccata, dietro al corpo.
 */
export function touchOffset(p: PlayerState, phase: number, sprinting: boolean, moving: number): number {
  if (p.shielding) return TOUCH.shield;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const base = sprinting ? TOUCH.sprintBase : TOUCH.walkBase;
  const push = (sprinting ? TOUCH.sprintPush : TOUCH.walkPush) * touchPushMult(p.stats);
  return base + push * tri * moving + (1 - moving) * 0.13;
}

/** Dove sarà la palla di chi la porta tra `dt` secondi, se continua a correre così. */
export function predictCarriedBall(p: PlayerState, dt: number): [number, number, number] {
  const sp = len(p.vx, p.vy);
  const tl = p.sprinting ? TOUCH.sprintLen : TOUCH.walkLen;
  const ph = (p.dribble + (sp * dt) / tl) % 1;
  const off = touchOffset(p, ph, p.sprinting, Math.min(1, sp / 3));
  const dx = p.shielding ? p.shx : p.fx;
  const dy = p.shielding ? p.shy : p.fy;
  return [p.x + p.vx * dt + dx * off, p.y + p.vy * dt + dy * off, off];
}

/** Palla condotta: segue il ritmo dei tocchi (vedi touchOffset). */
export function attachBall(s: MatchState): void {
  const b = s.ball;
  const p = s.players[b.owner];
  const sp = len(p.vx, p.vy);
  const touchLen = p.sprinting ? TOUCH.sprintLen : TOUCH.walkLen;
  p.dribble = (p.dribble + (sp * DT) / touchLen) % 1;
  const off = touchOffset(p, p.dribble, p.sprinting, Math.min(1, sp / 3));
  const dx = p.shielding ? p.shx : p.fx;
  const dy = p.shielding ? p.shy : p.fy;
  b.x = p.x + dx * off;
  b.y = p.y + dy * off;
  b.z = 0;
  b.vx = p.vx;
  b.vy = p.vy;
  b.vz = 0;
  if (b.x < R) b.x = R;
  if (b.x > FIELD.length - R) b.x = FIELD.length - R;
  if (b.y < R) b.y = R;
  if (b.y > FIELD.width - R) b.y = FIELD.width - R;
}
