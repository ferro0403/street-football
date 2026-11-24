// Azioni dei giocatori: tiro, passaggio, contrasto, finta e skill speciali.
// Le usano sia gli umani (tramite input) sia la CPU, così le regole sono identiche.
import { CENTER_Y, FIELD, PHYS } from './constants';
import { clamp, dist, len, norm } from './math';
import { chance, nextRandom, randSigned } from './rng';
import {
  FEINT_COOLDOWN,
  SKILL_COOLDOWN,
  TACKLE_COOLDOWN,
  feintEvade,
  maxShotSpeed,
  passError,
  passSpeedMult,
  shotError,
  tackleChance,
} from './stats';
import type { ActionKind, MatchState, PlayerState } from './types';
import { attackDir, distToOppGoal, laneClear, nearestOpponent, oppGoalX, openness } from './world';

export function setAction(p: PlayerState, kind: ActionKind, dur: number, dx = 0, dy = 0): void {
  p.action = { kind, t: 0, dur, dx, dy, done: false };
}

function releaseBall(s: MatchState, p: PlayerState): void {
  const b = s.ball;
  b.owner = -1;
  b.lastTouch = p.idx;
  b.kicker = p.idx;
  b.kickCd = 0.28;
  b.passTarget = -1;
  b.shotActive = false;
  // Parte dal piede, non dal centro del giocatore.
  b.x = p.x + p.fx * 0.45;
  b.y = p.y + p.fy * 0.45;
  b.x = clamp(b.x, PHYS.ballRadius, FIELD.length - PHYS.ballRadius);
  b.y = clamp(b.y, PHYS.ballRadius, FIELD.width - PHYS.ballRadius);
  b.z = 0.05;
  p.charge = 0;
  p.chargeKind = 'none';
}

/**
 * Tiro verso la porta avversaria.
 * @param power 0..1 (carica)
 * @param aim -1..1 spostamento laterale del bersaglio dentro la porta (asse y)
 * @param bonus punti tiro extra (skill)
 */
export function shoot(s: MatchState, p: PlayerState, power: number, aim: number, bonus = 0): void {
  const st = { ...p.stats, shooting: Math.min(99, p.stats.shooting + bonus) };
  power = clamp(power, 0, 1);
  const gx = oppGoalX(p.team);
  let ty = CENTER_Y + clamp(aim, -1, 1) * (FIELD.goalWidth / 2 - 0.35);
  const d0 = dist(p.x, p.y, gx, ty);
  const pressure = nearestOpponent(s, p, false).d < 1.6 ? 0.5 : 0;
  const err = shotError(st) * (0.5 + power * 0.8) * (0.6 + d0 / 20) * (1 + pressure);
  ty += randSigned(s) * err;

  const vh = 9 + (maxShotSpeed(st) - 9) * power;
  const skill = st.shooting / 99;
  // Altezza all'arrivo: tiro basso con poca carica, alto (e rischioso) a piena potenza.
  const th = clamp(0.2 + power * power * 0.95 + nextRandom(s) * power * (1.25 - skill) * 0.9, 0.15, 3.5);

  releaseBall(s, p);
  const b = s.ball;
  const [dx, dy] = norm(gx - b.x, ty - b.y);
  const d = dist(b.x, b.y, gx, ty);
  const t = Math.max(0.15, d / vh);
  b.vx = dx * vh;
  b.vy = dy * vh;
  b.vz = clamp((th - b.z + 0.5 * PHYS.gravity * t * t) / t, 0.5, 14);
  b.shotId += 1;
  b.shotActive = true;
  b.shotTeam = p.team;
  s.stats[p.team].shots += 1;
  p.fx = dx;
  p.fy = dy;
  setAction(p, 'kick', 0.3, dx, dy);
  s.events.push({ type: 'shot', p: p.idx, team: p.team, power: vh, x: b.x, y: b.y });
}

/** Passaggio a un compagno (rasoterra o alto). */
export function pass(s: MatchState, p: PlayerState, target: number, lofted: boolean, bonus = 0): void {
  const r = s.players[target];
  const st = { ...p.stats, passing: Math.min(99, p.stats.passing + bonus) };
  const d0 = dist(p.x, p.y, r.x, r.y);
  // Anticipa il movimento del compagno.
  const tEst = d0 / (lofted ? 11 : 15);
  let tx = r.x + r.vx * tEst * 0.75;
  let ty = r.y + r.vy * tEst * 0.75;
  tx = clamp(tx, 0.6, FIELD.length - 0.6);
  ty = clamp(ty, 0.6, FIELD.width - 0.6);

  releaseBall(s, p);
  const b = s.ball;
  let [dx, dy] = norm(tx - b.x, ty - b.y);
  const e = passError(st) * randSigned(s) * (lofted ? 1.3 : 1);
  [dx, dy] = norm(dx - dy * e, dy + dx * e);
  const d = dist(b.x, b.y, tx, ty);

  if (lofted) {
    const vh = clamp(d / 1.05, 6, 17) * passSpeedMult(st);
    const t = d / vh;
    b.vx = dx * vh;
    b.vy = dy * vh;
    b.vz = 0.5 * PHYS.gravity * t;
  } else {
    // v0 per arrivare con ~5 m/s tenendo conto dell'attrito di rotolamento.
    const a = PHYS.rollFriction + PHYS.rollDrag * 8;
    const v = clamp(Math.sqrt(25 + 2 * a * d), 7, 21) * passSpeedMult(st);
    b.vx = dx * v;
    b.vy = dy * v;
    b.vz = 0;
    b.z = 0;
  }
  b.passTarget = target;
  p.fx = dx;
  p.fy = dy;
  s.stats[p.team].passes += 1;
  setAction(p, 'kick', 0.25, dx, dy);
  s.events.push({ type: 'pass', p: p.idx, team: p.team, power: len(b.vx, b.vy), x: b.x, y: b.y });
}

/** Valutazione di un compagno come destinatario del passaggio (più alto = meglio). */
export function passValue(s: MatchState, p: PlayerState, q: PlayerState): number {
  const dir = attackDir(p.team);
  const d = dist(p.x, p.y, q.x, q.y);
  let v = (q.x - p.x) * dir * 0.3 + openness(s, p.team, q.x, q.y) * 0.7;
  v -= Math.abs(d - 9) * 0.08; // distanza ideale ~9 m
  if (q.role === 'gk') v -= 6;
  if (!laneClear(s, p.team, p.x, p.y, q.x, q.y, 0.9)) v -= 4;
  return v;
}

/**
 * Sceglie il compagno da servire. Con una direzione (input) privilegia chi sta da quella parte,
 * altrimenti usa la valutazione tattica.
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

// --- Difesa -----------------------------------------------------------------

export function startTackle(s: MatchState, p: PlayerState): boolean {
  if (p.tackleCd > 0 || p.stun > 0 || p.action.kind === 'tackle') return false;
  const b = s.ball;
  let tx = b.x;
  let ty = b.y;
  if (b.owner >= 0) {
    const c = s.players[b.owner];
    tx = c.x;
    ty = c.y;
  }
  let [dx, dy] = norm(tx - p.x, ty - p.y);
  if (dx === 0 && dy === 0) [dx, dy] = [p.fx, p.fy];
  setAction(p, 'tackle', 0.38, dx, dy);
  p.vx = dx * 7.5;
  p.vy = dy * 7.5;
  p.fx = dx;
  p.fy = dy;
  p.tackleCd = TACKLE_COOLDOWN;
  return true;
}

/** Risolve il contrasto a metà dell'intervento. */
export function resolveTackle(s: MatchState, p: PlayerState): void {
  const a = p.action;
  if (a.kind !== 'tackle' || a.done || a.t < 0.1) return;
  a.done = true;
  const b = s.ball;
  if (b.owner < 0) {
    // Palla vagante vicina: la tocca via.
    if (dist(p.x, p.y, b.x, b.y) < 1.3 && b.z < 0.8) {
      b.vx = a.dx * 6 + b.vx * 0.3;
      b.vy = a.dy * 6 + b.vy * 0.3;
      b.lastTouch = p.idx;
      b.passTarget = -1;
      s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: b.x, y: b.y });
      return;
    }
    p.stun = 0.3;
    return;
  }
  const c = s.players[b.owner];
  if (c.team === p.team) return;
  if (c.role === 'gk') return; // il portiere con la palla in mano è intoccabile
  if (dist(p.x, p.y, c.x, c.y) > 1.45) {
    p.stun = 0.35;
    s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
    return;
  }
  if (c.evade > 0) {
    p.stun = 0.6;
    setAction(p, 'stunned', 0.6);
    s.events.push({ type: 'dodge', p: c.idx, team: c.team, x: c.x, y: c.y });
    return;
  }
  if (chance(s, tackleChance(p.stats, c.stats))) {
    // Vinto: palla via o rubata.
    b.owner = -1;
    b.lastTouch = p.idx;
    b.kicker = c.idx;
    b.kickCd = 0.4;
    b.passTarget = -1;
    b.shotActive = false;
    if (chance(s, 0.45 + (p.stats.defense - c.stats.dribbling) * 0.01)) {
      b.owner = p.idx;
    } else {
      b.vx = a.dx * 4.5 + randSigned(s) * 2;
      b.vy = a.dy * 4.5 + randSigned(s) * 2;
      b.vz = 1.5;
    }
    c.stun = 0.45;
    setAction(c, 'stunned', 0.45);
    s.stats[p.team].tackles += 1;
    s.events.push({ type: 'tackle', p: p.idx, team: p.team, x: c.x, y: c.y });
  } else {
    p.stun = 0.55;
    setAction(p, 'stunned', 0.55);
    s.events.push({ type: 'tackleMiss', p: p.idx, team: p.team, x: p.x, y: p.y });
  }
}

// --- Dribbling ----------------------------------------------------------------

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

/** Esegue la skill speciale del giocatore. Restituisce true se è partita. */
export function special(s: MatchState, p: PlayerState, side: number): boolean {
  if (!p.special || p.skillCd > 0 || p.stun > 0 || s.ball.owner !== p.idx) return false;
  const b = s.ball;
  const opp = nearestOpponent(s, p, false);
  const ev = () =>
    s.events.push({ type: 'special', p: p.idx, team: p.team, skill: p.special ?? '', x: p.x, y: p.y });

  switch (p.special) {
    case 'veronica': {
      // Giro di 360° sulla palla: intoccabile e avanza.
      setAction(p, 'veronica', 0.5, p.fx, p.fy);
      p.vx = p.fx * 3.2;
      p.vy = p.fy * 3.2;
      p.evade = 0.55;
      break;
    }
    case 'elastico': {
      const sd = side === 0 ? (s.tick % 2 === 0 ? 1 : -1) : side > 0 ? 1 : -1;
      const dx = -p.fy * sd;
      const dy = p.fx * sd;
      setAction(p, 'elastico', 0.35, dx, dy);
      p.vx = dx * 7 + p.fx * 2;
      p.vy = dy * 7 + p.fy * 2;
      p.evade = 0.45;
      // "Caviglie rotte": chi è vicino resta piantato.
      for (const q of s.players) {
        if (q.team !== p.team && q.role !== 'gk' && dist(p.x, p.y, q.x, q.y) < 2.2) {
          q.stun = Math.max(q.stun, 0.7);
          setAction(q, 'stunned', 0.7);
        }
      }
      break;
    }
    case 'sombrero': {
      // Palla alzata sopra la testa dell'avversario, poi la si rincorre.
      setAction(p, 'sombrero', 0.35, p.fx, p.fy);
      b.owner = -1;
      b.lastTouch = p.idx;
      b.kicker = -1; // può riprenderla subito
      b.kickCd = 0;
      b.passTarget = p.idx;
      b.x = p.x + p.fx * 0.4;
      b.y = p.y + p.fy * 0.4;
      b.z = 0.3;
      b.vx = p.fx * 6.5;
      b.vy = p.fy * 6.5;
      b.vz = 8;
      p.vx = p.fx * 6;
      p.vy = p.fy * 6;
      p.evade = 0.5;
      break;
    }
    case 'tunnel': {
      // Tunnel tra le gambe dell'avversario davanti.
      setAction(p, 'tunnel', 0.35, p.fx, p.fy);
      if (opp.p && opp.d < 2.8) {
        const q = opp.p;
        q.stun = Math.max(q.stun, 0.8);
        setAction(q, 'stunned', 0.8);
        b.owner = -1;
        b.lastTouch = p.idx;
        b.kicker = -1;
        b.kickCd = 0;
        b.passTarget = p.idx;
        b.vx = p.fx * 8;
        b.vy = p.fy * 8;
        b.vz = 0;
      }
      p.vx = p.fx * 5.5;
      p.vy = p.fy * 5.5;
      p.evade = 0.45;
      break;
    }
    case 'rabona': {
      // Tiro (o lancio) di rabona: più preciso e potente.
      setAction(p, 'rabona', 0.35, p.fx, p.fy);
      if (distToOppGoal(p) < 22) {
        p.skillCd = SKILL_COOLDOWN;
        ev();
        shoot(s, p, 0.88, side * 0.8, 14);
        p.action.kind = 'rabona';
        return true;
      }
      const t = pickPassTarget(s, p, attackDir(p.team), 0);
      if (t >= 0) {
        p.skillCd = SKILL_COOLDOWN;
        ev();
        pass(s, p, t, true, 14);
        p.action.kind = 'rabona';
        return true;
      }
      break;
    }
  }
  p.skillCd = SKILL_COOLDOWN;
  p.stamina = Math.max(0, p.stamina - 0.12);
  ev();
  return true;
}
