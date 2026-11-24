// Fisica della palla: gravità, rimbalzi sul terreno, attrito, pareti della gabbia, pali e reti.
// La gabbia è chiusa: l'unico modo per superare le linee di fondo è entrare in porta.
import { CENTER_Y, DT, FIELD, PHYS } from './constants';
import { len } from './math';
import { randSigned } from './rng';
import type { MatchState } from './types';

const R = PHYS.ballRadius;
const HALF_GOAL = FIELD.goalWidth / 2;

/** Avanza la palla libera di un tick. Restituisce la squadra che ha segnato o -1. */
export function stepBall(s: MatchState): number {
  const b = s.ball;
  const ev = s.events;

  // Velocità massima (evita valori assurdi e tunnelling).
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
    // Rotola: attrito costante + proporzionale.
    const sp = len(b.vx, b.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - (PHYS.rollFriction + PHYS.rollDrag * sp) * DT);
      const k = ns / sp;
      b.vx *= k;
      b.vy *= k;
    }
  }

  const px = b.x;
  b.x += b.vx * DT;
  b.y += b.vy * DT;
  b.z += b.vz * DT;

  // Terreno.
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

  // Tetto della gabbia.
  if (b.z > FIELD.roofHeight - R) {
    b.z = FIELD.roofHeight - R;
    if (b.vz > 0) b.vz = -b.vz * 0.4;
    ev.push({ type: 'wall', power: 4, x: b.x, y: b.y, z: b.z });
  }

  // Pareti laterali (y).
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

  // Dentro una porta: la rete trattiene la palla.
  if (b.inGoal >= 0 || b.x < 0 || b.x > FIELD.length) {
    if (b.x < 0 || b.x > FIELD.length) {
      return insideGoal(s, px);
    }
  }
  return -1;
}

function wallHit(s: MatchState, speed: number): void {
  if (speed > 2.5) s.events.push({ type: 'wall', power: speed, x: s.ball.x, y: s.ball.y, z: s.ball.z });
}

/** Gestisce la palla oltre una linea di fondo. */
function insideGoal(s: MatchState, prevX: number): number {
  const b = s.ball;
  const left = b.x < 0;
  const lineX = left ? 0 : FIELD.length;
  const dy = Math.abs(b.y - CENTER_Y);
  const wasInside = left ? prevX < 0 : prevX > FIELD.length;

  if (!wasInside && b.inGoal < 0) {
    // Ha appena attraversato la linea: porta, palo/traversa o parete.
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
  // La rete smorza molto.
  b.vx *= 0.9;
  b.vy *= 0.9;
}

/** Posizione della palla mentre un giocatore la conduce. */
export function attachBall(s: MatchState): void {
  const b = s.ball;
  const p = s.players[b.owner];
  // Piccolo "tocco" ritmico: la palla si allontana e torna mentre corre.
  const sp = len(p.vx, p.vy);
  const phase = (s.tick % 24) / 24;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  const off = 0.48 + (sp > 1 ? tri * 0.22 : 0);
  b.x = p.x + p.fx * off;
  b.y = p.y + p.fy * off;
  b.z = 0;
  b.vx = p.vx;
  b.vy = p.vy;
  b.vz = 0;
  // Mai oltre le linee mentre la si conduce: si segna solo calciando.
  if (b.x < R) b.x = R;
  if (b.x > FIELD.length - R) b.x = FIELD.length - R;
  if (b.y < R) b.y = R;
  if (b.y > FIELD.width - R) b.y = FIELD.width - R;
}
