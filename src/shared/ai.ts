// IA dei giocatori di movimento (compagni e avversari).
// Struttura a livelli (skill game-ai): percezione semplice → decisione a intervalli
// (portatore / supporto / pressing / marcatura / palla vagante) → steering per tick.
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, norm } from './math';
import { chance, nextRandom } from './rng';
import { feint, pass, passValue, shoot, special, startTackle } from './actions';
import type { MatchState, PlayerState, TeamIndex } from './types';
import {
  attackDir,
  attackingTeam,
  distToOppGoal,
  keeperOf,
  laneClear,
  nearestOpponent,
  oppGoalX,
  openness,
  ownGoalX,
} from './world';

export interface Intent {
  mx: number;
  my: number;
  sprint: boolean;
}

const IDLE: Intent = { mx: 0, my: 0, sprint: false };

/** Ruolo tattico in base all'indice nella squadra (1..4). */
type Slot = 'def' | 'left' | 'right' | 'fwd';
const slotOf = (p: PlayerState): Slot => (['def', 'def', 'left', 'right', 'fwd'] as const)[p.idx % 5];

function thinkDue(s: MatchState, p: PlayerState, base: number): boolean {
  p.ai.think -= DT;
  if (p.ai.think > 0) return false;
  p.ai.think = base + nextRandom(s) * base * 0.6;
  return true;
}

function seek(p: PlayerState, tx: number, ty: number, sprintDist = 4, slowRadius = 1.2): Intent {
  const d = dist(p.x, p.y, tx, ty);
  if (d < 0.25) return IDLE;
  const [mx, my] = norm(tx - p.x, ty - p.y);
  const k = Math.min(1, d / slowRadius);
  return { mx: mx * k, my: my * k, sprint: d > sprintDist && p.stamina > 0.25 };
}

export function aiFieldPlayer(s: MatchState, p: PlayerState): Intent {
  if (s.phase !== 'play') return IDLE;
  const b = s.ball;
  if (b.owner === p.idx) return carrier(s, p);
  const att = attackingTeam(s);
  if (b.owner < 0 && b.passTarget === p.idx) return receive(s, p);
  if (b.owner < 0 && isChaser(s, p)) return chaseLoose(s, p);
  if (att === p.team) return support(s, p);
  return defend(s, p);
}

// --- Con la palla ------------------------------------------------------------

function carrier(s: MatchState, p: PlayerState): Intent {
  const dir = attackDir(p.team);
  const gx = oppGoalX(p.team);
  const dGoal = distToOppGoal(p);
  const opp = nearestOpponent(s, p, false);
  const pressured = opp.d < 2.2;

  if (thinkDue(s, p, 0.22)) {
    // 1) Tiro: solo se l'occasione è buona (distanza, angolo, linea libera, pressione).
    const range = 6 + (p.stats.shooting / 99) * 8;
    const dx = Math.abs(gx - p.x);
    const angleOk = Math.abs(p.y - CENTER_Y) < dx * 0.9 + 1;
    if (dGoal < range && angleOk) {
      const clear = laneClear(s, p.team, p.x, p.y, gx, CENTER_Y, 0.9, true);
      const quality = (1 - dGoal / range) * (clear ? 1 : 0.35) * (pressured ? 0.75 : 1);
      if (quality > 0.35 || chance(s, quality * 0.5)) {
        const k = keeperOf(s, p.team === 0 ? 1 : 0);
        // Mira dal lato opposto al portiere, con un po' di varietà.
        const side = k.y < CENTER_Y ? 1 : -1;
        const aim = chance(s, 0.75) ? side * (0.35 + nextRandom(s) * 0.65) : -side * nextRandom(s) * 0.6;
        const power = clamp(0.35 + dGoal / 26 + nextRandom(s) * 0.25, 0.4, 0.92);
        shoot(s, p, power, aim);
        return IDLE;
      }
    }
    // 2) Passaggio.
    let best: PlayerState | null = null;
    let bv = -Infinity;
    for (const q of s.players) {
      if (q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
      const v = passValue(s, p, q);
      if (v > bv) {
        bv = v;
        best = q;
      }
    }
    const selfV = openness(s, p.team, p.x, p.y) * 0.7 + (dGoal < 12 ? 1.5 : 0);
    const threshold = pressured ? 0.2 : 2.2;
    if (best && bv > selfV + threshold && (pressured || chance(s, 0.55))) {
      const d = dist(p.x, p.y, best.x, best.y);
      const lofted = !laneClear(s, p.team, p.x, p.y, best.x, best.y, 0.9) && d > 6;
      pass(s, p, best.idx, lofted);
      return IDLE;
    }
    // 3) Finta o skill se pressato.
    if (pressured && opp.d < 1.9) {
      const side = opp.p ? ((opp.p.x - p.x) * -p.fy + (opp.p.y - p.y) * p.fx > 0 ? -1 : 1) : 0;
      if (p.skillCd <= 0 && chance(s, 0.12 + p.stats.dribbling * 0.002)) {
        if (special(s, p, side)) return IDLE;
      }
      if (p.feintCd <= 0 && chance(s, 0.15 + p.stats.dribbling * 0.004)) {
        feint(s, p, side);
        return IDLE;
      }
    }
    // 4) Conduzione: verso la porta, evitando l'avversario più vicino.
    let tx = gx - dir * 3;
    let ty = CENTER_Y + (p.y - CENTER_Y) * 0.4;
    if (opp.p && opp.d < 4) {
      const [ax, ay] = norm(p.x - opp.p.x, p.y - opp.p.y);
      const w = (4 - opp.d) * 1.6;
      tx = p.x + (tx - p.x) * 0.5 + ax * w;
      ty = p.y + (ty - p.y) * 0.5 + ay * w;
    }
    p.ai.tx = clamp(tx, 1, FIELD.length - 1);
    p.ai.ty = clamp(ty, 1, FIELD.width - 1);
  }
  const it = seek(p, p.ai.tx, p.ai.ty, 0, 0.5);
  it.sprint = !pressured && p.stamina > 0.35 && opp.d > 3;
  return it;
}

// --- Senza palla, squadra in possesso ----------------------------------------------

function baseSupportSpot(s: MatchState, p: PlayerState): [number, number] {
  const dir = attackDir(p.team);
  const b = s.ball;
  const L = FIELD.length;
  const W = FIELD.width;
  let x: number;
  let y: number;
  switch (slotOf(p)) {
    case 'def':
      x = b.x - dir * 9;
      y = CENTER_Y + (b.y - CENTER_Y) * 0.3;
      break;
    case 'left':
      x = b.x + dir * 3;
      y = W * 0.2;
      break;
    case 'right':
      x = b.x + dir * 3;
      y = W * 0.8;
      break;
    default:
      x = b.x + dir * 8;
      y = CENTER_Y + (CENTER_Y - b.y) * 0.35;
  }
  const limit = oppGoalX(p.team) - dir * 2.5;
  x = dir > 0 ? Math.min(x, limit) : Math.max(x, limit);
  return [clamp(x, 2, L - 2), clamp(y, 1.5, W - 1.5)];
}

const OFFSETS: [number, number][] = [
  [0, 0],
  [2.5, 0],
  [-2.5, 0],
  [0, 2.5],
  [0, -2.5],
  [1.8, 1.8],
  [1.8, -1.8],
];

function support(s: MatchState, p: PlayerState): Intent {
  if (thinkDue(s, p, 0.35)) {
    const [bx, by] = baseSupportSpot(s, p);
    const dir = attackDir(p.team);
    const c = s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
    let best = -Infinity;
    let btx = bx;
    let bty = by;
    for (const [ox, oy] of OFFSETS) {
      const x = clamp(bx + ox, 1.5, FIELD.length - 1.5);
      const y = clamp(by + oy, 1.2, FIELD.width - 1.2);
      let v = openness(s, p.team, x, y) * 0.8 + (x - bx) * dir * 0.12 - dist(bx, by, x, y) * 0.2;
      if (c && !laneClear(s, p.team, c.x, c.y, x, y, 0.9)) v -= 2;
      // Non ammucchiarsi sui compagni.
      for (const q of s.players) {
        if (q.team === p.team && q.idx !== p.idx && dist(q.x, q.y, x, y) < 3) v -= 1.5;
      }
      if (v > best) {
        best = v;
        btx = x;
        bty = y;
      }
    }
    // Isteresi: cambia posizione solo se nettamente meglio.
    if (best > p.ai.score + 0.4 || dist(p.ai.tx, p.ai.ty, btx, bty) > 6) {
      p.ai.tx = btx;
      p.ai.ty = bty;
    }
    p.ai.score = best;
  }
  return seek(p, p.ai.tx, p.ai.ty, 5);
}

// --- Palla vagante / ricezione ------------------------------------------------

function predictBall(s: MatchState, t: number): [number, number] {
  const b = s.ball;
  return [clamp(b.x + b.vx * t, 0.5, FIELD.length - 0.5), clamp(b.y + b.vy * t, 0.5, FIELD.width - 0.5)];
}

function receive(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + 0.1;
  const [tx, ty] = predictBall(s, Math.min(0.6, d / sp));
  // Va incontro alla palla.
  return seek(p, tx, ty, 3, 0.4);
}

/** Il più vicino della squadra (non umano, non portiere) insegue la palla vagante. */
function isChaser(s: MatchState, p: PlayerState): boolean {
  const b = s.ball;
  if (b.passTarget >= 0 && s.players[b.passTarget].team === p.team) return false;
  const [px, py] = predictBall(s, 0.3);
  const myD = dist(p.x, p.y, px, py);
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const qd = dist(q.x, q.y, px, py);
    // L'umano conta: se è più vicino, la CPU non gli si sovrappone.
    if (qd < myD - 0.01 || (qd === myD && q.idx < p.idx)) return false;
  }
  return true;
}

function chaseLoose(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  const [tx, ty] = predictBall(s, Math.min(0.5, d / 8));
  const it = seek(p, tx, ty, 1.5, 0.3);
  return it;
}

// --- Difesa ------------------------------------------------------------------

function defend(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const team = p.team;
  const gx = ownGoalX(team);
  const carrierP = b.owner >= 0 ? s.players[b.owner] : null;

  // Chi pressa: il difensore CPU più vicino alla palla.
  let presser: PlayerState | null = null;
  let pd = Infinity;
  let humanD = Infinity;
  for (const q of s.players) {
    if (q.team !== team || q.role === 'gk') continue;
    const d = dist(q.x, q.y, b.x, b.y);
    if (q.human) {
      humanD = Math.min(humanD, d);
      continue;
    }
    if (d < pd) {
      pd = d;
      presser = q;
    }
  }

  // Raddoppio: vicino alla nostra porta pressa anche il secondo più vicino.
  let second: PlayerState | null = null;
  if (carrierP && Math.abs(carrierP.x - gx) < 14) {
    let sd = Infinity;
    for (const q of s.players) {
      if (q.team !== team || q.role === 'gk' || q.human || q === presser) continue;
      const d = dist(q.x, q.y, b.x, b.y);
      if (d < sd) {
        sd = d;
        second = q;
      }
    }
  }

  if ((presser === p || second === p) && carrierP) {
    const [gdx, gdy] = norm(gx - carrierP.x, CENTER_Y - carrierP.y);
    // Se un umano sta già pressando, il primo copre lo spazio dietro di lui.
    const back = presser === p ? (humanD < pd - 1 ? 3.5 : 0.7) : 2.2;
    // Anticipa la corsa del portatore.
    const lead = presser === p ? 0.35 : 0.2;
    const tx = carrierP.x + carrierP.vx * lead + gdx * back;
    const ty = carrierP.y + carrierP.vy * lead + gdy * back;
    const d = dist(p.x, p.y, carrierP.x, carrierP.y);
    if (back < 3 && d < 1.8 && p.tackleCd <= 0 && carrierP.role !== 'gk' && thinkDue(s, p, 0.15)) {
      if (chance(s, 0.3 + p.stats.defense * 0.004)) {
        startTackle(s, p);
        return IDLE;
      }
    }
    return seek(p, tx, ty, 1.5, 0.4);
  }

  // Marcatura: attaccante assegnato in modo greedy per distanza.
  const attackers = s.players.filter((q) => q.team !== team && q.role === 'field' && q.idx !== b.owner);
  const defenders = s.players.filter(
    (q) => q.team === team && q.role === 'field' && q !== presser && q !== second && !q.human,
  );
  const taken = new Set<number>();
  let mark: PlayerState | null = null;
  // Ordina i difensori per indice: assegnazione stabile e deterministica.
  for (const dfn of defenders) {
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const a of attackers) {
      if (taken.has(a.idx)) continue;
      const d = dist(dfn.x, dfn.y, a.x, a.y) + Math.abs(a.x - gx) * 0.15;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) taken.add(best.idx);
    if (dfn === p) {
      mark = best;
      break;
    }
  }
  if (mark) {
    const [gdx, gdy] = norm(gx - mark.x, CENTER_Y - mark.y);
    let tx = mark.x + gdx * 1.7;
    let ty = mark.y + gdy * 1.7;
    // Un po' verso la linea di passaggio dal portatore.
    if (carrierP) {
      tx = tx * 0.8 + ((carrierP.x + mark.x) / 2) * 0.2;
      ty = ty * 0.8 + ((carrierP.y + mark.y) / 2) * 0.2;
    }
    return seek(p, tx, ty, 3.5);
  }
  // Nessuno da marcare: copertura centrale.
  const tx = gx + attackDir(team as TeamIndex) * 6;
  return seek(p, tx, CENTER_Y + (b.y - CENTER_Y) * 0.4, 4);
}
