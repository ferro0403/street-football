// IA dei giocatori di movimento (compagni e avversari).
// Struttura a livelli (skill game-ai): percezione semplice → decisione a intervalli
// (portatore / supporto / pressing-contenimento / marcatura / palla vagante) → steering per tick.
// Usa le stesse azioni degli umani: trucchi a duello, muri, palle alte, Gamebreaker.
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, norm } from './math';
import { chance, nextRandom } from './rng';
import { bankShot, groundPass, lobPass, passValue, shoot, special, startSlide, startTackle, throughPass, wallPass } from './actions';
import { aerialOption, aerialPass, aerialShot } from './aerial';
import { activateGb, canActivate } from './gamebreaker';
import { challenger, startTrick } from './tricks';
import { bouncePoint, planWallOneTwo, planWallPass } from './walls';
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
  shield?: boolean;
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
  if (d < 0.25) return { ...IDLE };
  const [mx, my] = norm(tx - p.x, ty - p.y);
  const k = Math.min(1, d / slowRadius);
  return { mx: mx * k, my: my * k, sprint: d > sprintDist && p.stamina > 0.25 };
}

export function aiFieldPlayer(s: MatchState, p: PlayerState): Intent {
  if (s.phase !== 'play') return IDLE;
  const b = s.ball;
  if (b.owner === p.idx) return carrier(s, p);
  // Palla alta vicina: colpo di testa, al volo o rovesciata.
  const air = aerialOption(s, p);
  if (air && (b.passTarget === p.idx || b.passTarget < 0 || s.players[b.passTarget].team !== p.team) && thinkDue(s, p, 0.25)) {
    const attacking = distToOppGoal(p) < 14;
    const meant = b.passTarget === p.idx || chance(s, 0.25);
    if (attacking && meant && (air !== 'bicycle' || chance(s, 0.35))) {
      const k = keeperOf(s, p.team === 0 ? 1 : 0);
      aerialShot(s, p, air === 'bicycle' && !chance(s, 0.5) ? 'header' : air, k.y < CENTER_Y ? 0.7 : -0.7);
      return IDLE;
    }
    // Lontano dalla porta: di testa/al volo verso un compagno smarcato.
    if (b.passTarget !== p.idx || b.z > 1.4) {
      const t = bestMate(s, p);
      if (t) {
        aerialPass(s, p, air === 'bicycle' ? 'header' : air, t.idx);
        return IDLE;
      }
    }
  }
  const att = attackingTeam(s);
  if (b.owner < 0 && b.passTarget === p.idx) return receive(s, p);
  if (b.owner < 0 && isChaser(s, p)) return chaseLoose(s, p);
  if (att === p.team) return support(s, p);
  return defend(s, p);
}

function bestMate(s: MatchState, p: PlayerState): PlayerState | null {
  let best: PlayerState | null = null;
  let bv = -Infinity;
  for (const q of s.players) {
    if (!q.active || q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const v = passValue(s, p, q);
    if (v > bv) {
      bv = v;
      best = q;
    }
  }
  return best;
}

// --- Con la palla ------------------------------------------------------------

function carrier(s: MatchState, p: PlayerState): Intent {
  const dir = attackDir(p.team);
  const gx = oppGoalX(p.team);
  const dGoal = distToOppGoal(p);
  const opp = nearestOpponent(s, p, false);
  const pressured = opp.d < 2.2;
  const ai = s.tune.ai;

  // Protezione palla in corso.
  if (p.ai.shieldT > 0) {
    p.ai.shieldT -= DT;
    if (opp.p) {
      const [ax, ay] = norm(p.x - opp.p.x, p.y - opp.p.y);
      return { mx: ax * 0.5, my: ay * 0.5, sprint: false, shield: true };
    }
  }

  if (thinkDue(s, p, 0.2)) {
    // 0) Gamebreaker: appena pieno, nella metà campo avversaria.
    if (canActivate(s, p.team) && (gx - p.x) * dir < FIELD.length / 2 && chance(s, 0.5)) activateGb(s, p.team);

    // 1) Tiro: solo se l'occasione è buona.
    const range = 6 + (p.stats.shooting / 99) * 8;
    const angleOk = Math.abs(p.y - CENTER_Y) < Math.abs(gx - p.x) * 0.9 + 1;
    const k = keeperOf(s, p.team === 0 ? 1 : 0);
    if (dGoal < range && angleOk) {
      const clear = laneClear(s, p.team, p.x, p.y, gx, CENTER_Y, 0.9, true);
      const quality = (1 - dGoal / range) * (clear ? 1 : 0.35) * (pressured ? 0.75 : 1);
      if (quality > 0.28 || dGoal < 6 || chance(s, quality * 0.5)) {
        const side = k.y < CENTER_Y ? 1 : -1;
        const aim = chance(s, 0.75) ? side * (0.35 + nextRandom(s) * 0.65) : -side * nextRandom(s) * 0.6;
        const kOut = Math.abs(k.x - ownGoalX(k.team)) > 2.2;
        if (kOut && dGoal < 14 && chance(s, 0.5)) {
          shoot(s, p, 0.6, aim * 0.5, 0, 0, 'chip');
        } else if (dGoal < 11 && chance(s, 0.55)) {
          shoot(s, p, 0.5, aim, 0.6, 0, 'placed');
        } else {
          const power = clamp(0.35 + dGoal / 26 + nextRandom(s) * 0.25, 0.4, 0.92);
          const curl = Math.abs(aim) > 0.5 && chance(s, 0.4) ? 0.4 + nextRandom(s) * 0.5 : 0;
          shoot(s, p, power, aim, curl);
        }
        return IDLE;
      }
    }
    // 1b) Tiro di sponda: vicino al muro laterale con la linea chiusa.
    const nearWall = p.y < 4 ? -1 : p.y > FIELD.width - 4 ? 1 : 0;
    if (nearWall && dGoal < 16 && !laneClear(s, p.team, p.x, p.y, gx, CENTER_Y, 0.9, true) && chance(s, 0.25 * ai)) {
      if (bankShot(s, p, nearWall as -1 | 1, nearWall * -0.5, 0.7)) return IDLE;
    }

    // 2) Passaggio (anche al muro se la linea diretta è chiusa).
    const best = bestMate(s, p);
    const bv = best ? passValue(s, p, best) : -Infinity;
    const selfV = openness(s, p.team, p.x, p.y) * 0.7 + (dGoal < 12 ? 1.5 : 0);
    const threshold = pressured ? 0.2 : 2.2;
    if (best && bv + 4 > selfV + threshold) {
      const d = dist(p.x, p.y, best.x, best.y);
      const blocked = !laneClear(s, p.team, p.x, p.y, best.x, best.y, 0.9);
      if (blocked && opp.d > 1.7) {
        // Passaggio al muro: punta il rimbalzo che porta al compagno.
        for (const side of [p.y < CENTER_Y ? 'y0' : 'yW', p.y < CENTER_Y ? 'yW' : 'y0'] as const) {
          const h = bouncePoint(side, s.ball.x, s.ball.y, best.x, best.y, s.tune.wall);
          if (!h) continue;
          const plan = planWallPass(s, p, h[0] - s.ball.x, h[1] - s.ball.y);
          if (
            plan &&
            plan.receiver === best.idx &&
            laneClear(s, p.team, p.x, p.y, h[0], h[1], 0.8) &&
            laneClear(s, p.team, h[0], h[1], plan.tx, plan.ty, 1.3) &&
            openness(s, p.team, h[0], h[1]) > 2.5 &&
            chance(s, 0.5 * ai)
          ) {
            wallPass(s, p, plan, 4);
            return IDLE;
          }
        }
      }
      if (bv > selfV + threshold && (pressured || chance(s, 0.55))) {
        const ahead = (best.x - p.x) * dir > 2 && openness(s, p.team, best.x + dir * 4, best.y) > 2.5;
        if (ahead && !blocked && chance(s, 0.45)) throughPass(s, p, best.idx, dir, 0);
        else if (blocked && d > 6) lobPass(s, p, best.idx);
        else groundPass(s, p, best.idx, clamp(d / 18, 0, 0.8));
        return IDLE;
      }
    }

    // 3) Duello: uno-due col muro, trucco o skill contro il difensore davanti.
    const foe = challenger(s, p, 2.8, 0.2);
    if (foe && p.trickCd <= 0 && p.heat < 0.75) {
      const wallSide = p.y < 5 ? -1 : p.y > FIELD.width - 5 ? 1 : 0;
      if (wallSide && chance(s, 0.3 * ai)) {
        const plan = planWallOneTwo(s, p, 0, wallSide);
        if (plan) {
          wallPass(s, p, plan, 5);
          return IDLE;
        }
      }
      if (chance(s, (0.2 + p.stats.dribbling * 0.004) * ai)) {
        if (p.skillCd <= 0 && p.special && chance(s, 0.25)) {
          const side = sideAway(p, foe);
          if (special(s, p, side)) return IDLE;
        }
        const id = pickTrick(s, p, foe);
        if (startTrick(s, p, id, sideAway(p, foe))) return IDLE;
      }
    }

    // 4) Protezione: pressato da dietro e senza passaggi buoni.
    if (opp.p && opp.d < 1.6) {
      const [rx, ry] = norm(opp.p.x - p.x, opp.p.y - p.y);
      if (rx * p.fx + ry * p.fy < -0.3 && chance(s, 0.4)) {
        p.ai.shieldT = 0.6 + nextRandom(s) * 0.5;
        return { mx: 0, my: 0, sprint: false, shield: true };
      }
    }

    // 5) Conduzione verso una zona di tiro, evitando l'avversario.
    let tx = gx - dir * 8;
    let ty = CENTER_Y + (p.y - CENTER_Y) * 0.4;
    if (Math.abs(p.x - gx) < 9) tx = p.x;
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

/** Lato lontano dal difensore (+1 sinistra, -1 destra rispetto allo sguardo). */
function sideAway(p: PlayerState, foe: PlayerState): number {
  const left = (foe.x - p.x) * -p.fy + (foe.y - p.y) * p.fx;
  return left > 0 ? -1 : 1;
}

/** Sceglie un trucco adatto alla situazione, evitando di ripetere l'ultimo. */
function pickTrick(s: MatchState, p: PlayerState, foe: PlayerState): string {
  const d = dist(p.x, p.y, foe.x, foe.y);
  const lateral = Math.abs((foe.x - p.x) * -p.fy + (foe.y - p.y) * p.fx);
  const opts: [string, number][] = [];
  if (lateral < 0.6) {
    opts.push(['sombrero', 1], ['doppio', 1.2], ['elastico', p.stats.dribbling > 80 ? 1 : 0.4]);
    if (d < 2.3) opts.push(['panna', p.stats.dribbling > 75 ? 1.1 : 0.5]);
  } else {
    opts.push(['finta', 1.3], ['croqueta', 0.9], ['ruleta', 0.6]);
  }
  opts.push(['trascinata', 0.5], ['arcobaleno', 0.3]);
  let total = 0;
  for (const o of opts) {
    if (o[0] === p.lastTrick) o[1] *= 0.15; // anti-spam anche per la CPU
    total += o[1];
  }
  let r = nextRandom(s) * total;
  for (const [id, w] of opts) {
    r -= w;
    if (r <= 0) return id;
  }
  return opts[0][0];
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
      for (const q of s.players) {
        if (q.active && q.team === p.team && q.idx !== p.idx && dist(q.x, q.y, x, y) < 3) v -= 1.5;
      }
      if (v > best) {
        best = v;
        btx = x;
        bty = y;
      }
    }
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
  // Lancio, filtrante, passaggio al muro: corre verso il punto di arrivo (legge il rimbalzo).
  if (b.passKind >= 2) return seek(p, b.passTx, b.passTy, 1, 0.3);
  const d = dist(p.x, p.y, b.x, b.y);
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + 0.1;
  const [tx, ty] = predictBall(s, Math.min(0.6, d / sp));
  return seek(p, tx, ty, 3, 0.4);
}

function isChaser(s: MatchState, p: PlayerState): boolean {
  const b = s.ball;
  if (b.passTarget >= 0 && s.players[b.passTarget].team === p.team) return false;
  const [px, py] = predictBall(s, 0.3);
  const myD = dist(p.x, p.y, px, py);
  for (const q of s.players) {
    if (!q.active || q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const qd = dist(q.x, q.y, px, py);
    if (qd < myD - 0.01 || (qd === myD && q.idx < p.idx)) return false;
  }
  return true;
}

function chaseLoose(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  const [tx, ty] = predictBall(s, Math.min(0.5, d / 8));
  return seek(p, tx, ty, 1.5, 0.3);
}

// --- Difesa ------------------------------------------------------------------

function defend(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const team = p.team;
  const gx = ownGoalX(team);
  const carrierP = b.owner >= 0 ? s.players[b.owner] : null;
  const ai = s.tune.ai;

  let presser: PlayerState | null = null;
  let pd = Infinity;
  let humanD = Infinity;
  for (const q of s.players) {
    if (!q.active || q.team !== team || q.role === 'gk') continue;
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

  let second: PlayerState | null = null;
  if (carrierP && Math.abs(carrierP.x - gx) < 14) {
    let sd = Infinity;
    for (const q of s.players) {
      if (!q.active || q.team !== team || q.role === 'gk' || q.human || q === presser) continue;
      const d = dist(q.x, q.y, b.x, b.y);
      if (d < sd) {
        sd = d;
        second = q;
      }
    }
  }

  if ((presser === p || second === p) && carrierP) {
    const [gdx, gdy] = norm(gx - carrierP.x, CENTER_Y - carrierP.y);
    const d = dist(p.x, p.y, carrierP.x, carrierP.y);
    // Contenimento: davanti all'attaccante, tra lui e la porta, senza buttarsi.
    const jockey = presser === p && d < 3.6;
    const back = presser === p ? (humanD < pd - 1 ? 3.5 : jockey ? 1.35 : 0.7) : 2.2;
    const lead = presser === p ? 0.3 : 0.2;
    const tx = carrierP.x + carrierP.vx * lead + gdx * back;
    const ty = carrierP.y + carrierP.vy * lead + gdy * back;
    if (back < 3 && carrierP.role !== 'gk' && p.stun <= 0 && thinkDue(s, p, 0.15)) {
      const [rx, ry] = norm(p.x - carrierP.x, p.y - carrierP.y);
      const front = rx * carrierP.fx + ry * carrierP.fy;
      const nearOwnGoal = Math.abs(carrierP.x - gx) < 10;
      // Momento giusto: palla scoperta, attaccante girato o in difficoltà.
      const exposed = carrierP.ballOff > 0.7 || carrierP.stun > 0 || front < -0.2;
      const busy = carrierP.action.kind === 'trick'; // il trucco lo risolve il duello
      const tackleP = (exposed ? 0.55 : 0.18) + p.stats.defense * 0.003;
      if (!busy && d < 1.6 && p.tackleCd <= 0 && (front > -0.4 || nearOwnGoal) && chance(s, clamp(tackleP * ai, 0, 0.9))) {
        startTackle(s, p);
        return IDLE;
      }
      if (!busy && d > 1.6 && d < 3.2 && p.slideCd <= 0 && (front > -0.2 || (nearOwnGoal && chance(s, 0.3))) && chance(s, (0.06 + p.stats.defense * 0.0012) * ai)) {
        startSlide(s, p);
        return IDLE;
      }
    }
    const it = seek(p, tx, ty, jockey ? 99 : 1.5, 0.4);
    if (jockey) {
      it.shield = true;
      it.sprint = false;
    }
    return it;
  }

  // Marcatura greedy per distanza.
  const attackers = s.players.filter((q) => q.active && q.team !== team && q.role === 'field' && q.idx !== b.owner);
  const defenders = s.players.filter(
    (q) => q.active && q.team === team && q.role === 'field' && q !== presser && q !== second && !q.human,
  );
  const taken = new Set<number>();
  let mark: PlayerState | null = null;
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
    if (carrierP) {
      tx = tx * 0.8 + ((carrierP.x + mark.x) / 2) * 0.2;
      ty = ty * 0.8 + ((carrierP.y + mark.y) / 2) * 0.2;
    }
    return seek(p, tx, ty, 3.5);
  }
  const tx = gx + attackDir(team as TeamIndex) * 6;
  return seek(p, tx, CENTER_Y + (b.y - CENTER_Y) * 0.4, 4);
}
