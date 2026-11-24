// IA dei giocatori di movimento, stile FIFA Street (semplice ma credibile).
// Livelli (skill game-ai): percezione minima → decisione a intervalli → movimento ogni tick.
// - Portatore: tira se ha l'occasione, passa se pressato o se un compagno sta meglio,
//   altrimenti dribbla verso la zona di tiro schivando l'avversario. Mai fermo.
// - Compagni: si smarcano (spazio libero + linea di passaggio pulita) e si muovono di continuo.
// - Difesa: UN difensore va sul portatore (e contrasta in piedi; scivolata rara), gli altri
//   marcano un avversario o coprono la zona davanti alla porta.
// - Palla vagante: il più vicino di ogni squadra la insegue.
// - Guardia anti-blocco: chi resta fermo troppo a lungo rifà subito la scelta.
import { CENTER_Y, DT, FIELD } from './constants';
import { clamp, dist, norm } from './math';
import { chance, nextRandom, randSigned } from './rng';
import { pass, passValue, shoot, startSlide, startTackle } from './actions';
import type { MatchState, PlayerState } from './types';
import { attackDir, keeperOf, laneClear, nearestOpponent, oppGoalX, openness, ownGoalX } from './world';

export interface Intent {
  mx: number;
  my: number;
  sprint: boolean;
}

const STAND: Intent = { mx: 0, my: 0, sprint: false };

type Slot = 'def' | 'left' | 'right' | 'fwd';
const slotOf = (p: PlayerState): Slot => (['def', 'def', 'left', 'right', 'fwd'] as const)[p.idx % 5];

/** Decisione a intervalli (con un po' di variazione, così non decidono tutti insieme). */
function thinkDue(s: MatchState, p: PlayerState, base: number): boolean {
  p.ai.think -= DT;
  // Anti-blocco: fermo da troppo tempo → si decide subito.
  if (p.ai.think > 0 && p.ai.still < 1) return false;
  p.ai.think = base + nextRandom(s) * base * 0.6;
  return true;
}

function seek(p: PlayerState, tx: number, ty: number, sprintDist = 4): Intent {
  const d = dist(p.x, p.y, tx, ty);
  if (d < 0.2) return { ...STAND };
  const [mx, my] = norm(tx - p.x, ty - p.y);
  const k = Math.min(1, d / 0.8);
  return { mx: mx * k, my: my * k, sprint: d > sprintDist && p.stamina > 0.25 };
}

export function aiFieldPlayer(s: MatchState, p: PlayerState): Intent {
  if (s.phase !== 'play' || p.stun > 0) return STAND;
  const b = s.ball;
  if (b.owner === p.idx) return carrier(s, p);
  if (b.owner < 0) {
    if (b.passTarget === p.idx) return receive(s, p);
    const passTeam = b.passTarget >= 0 ? s.players[b.passTarget].team : -1;
    if (passTeam !== p.team && isChaser(s, p)) return chase(s, p);
    return passTeam === p.team ? support(s, p) : defend(s, p);
  }
  return s.players[b.owner].team === p.team ? support(s, p) : defend(s, p);
}

// --- Con la palla ------------------------------------------------------------------

function carrier(s: MatchState, p: PlayerState): Intent {
  const dir = attackDir(p.team);
  const gx = oppGoalX(p.team);
  const dGoal = dist(p.x, p.y, gx, CENTER_Y);
  const opp = nearestOpponent(s, p, false);
  const pressured = opp.d < 2;

  if (thinkDue(s, p, 0.2)) {
    // 1) Tiro.
    const range = 7 + (p.stats.shooting / 99) * 7;
    const angleOk = Math.abs(p.y - CENTER_Y) < Math.abs(gx - p.x) * 1.1 + 1;
    if (dGoal < range && angleOk) {
      const clear = laneClear(s, p.team, p.x, p.y, gx, CENTER_Y, 0.8, true);
      const quality = (1 - dGoal / range) * (clear ? 1 : 0.4) * (pressured ? 0.8 : 1);
      // Con un avversario attaccato davanti il tiro verrebbe murato: meglio dribblare o passare.
      const blocked = !clear && opp.d < 2.5;
      if (!blocked && (quality > 0.3 || (clear && dGoal < 6) || chance(s, quality * 0.5))) {
        const k = keeperOf(s, p.team === 0 ? 1 : 0);
        const side = k.y < CENTER_Y ? 1 : -1;
        const aim = chance(s, 0.75) ? side * (0.4 + nextRandom(s) * 0.6) : randSigned(s) * 0.5;
        shoot(s, p, clamp(0.3 + dGoal / 20 + nextRandom(s) * 0.3, 0.2, 1), aim);
        return STAND;
      }
    }
    // 2) Passaggio: se pressato, o se un compagno è messo molto meglio.
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
    if (best && bv > selfV + (pressured ? -0.5 : 2) && (pressured || chance(s, 0.5))) {
      pass(s, p, best.idx);
      return STAND;
    }
    // 3) Dribbling: verso la zona di tiro, schivando chi ha davanti.
    let tx = gx - dir * 7;
    let ty = CENTER_Y + (p.y - CENTER_Y) * 0.5;
    if (Math.abs(p.x - gx) < 9) {
      // Già in zona: si sposta di lato per trovare l'angolo (mai fermo).
      tx = p.x + dir * 1.5;
      ty = p.y + (p.y < CENTER_Y ? 2 : -2);
    }
    if (opp.p && opp.d < 4) {
      const [ax, ay] = norm(p.x - opp.p.x, p.y - opp.p.y);
      const w = (4 - opp.d) * 1.4;
      tx = p.x + (tx - p.x) * 0.5 + ax * w + dir * 1.5;
      ty = p.y + (ty - p.y) * 0.5 + ay * w;
    }
    p.ai.tx = clamp(tx, 1, FIELD.length - 1);
    p.ai.ty = clamp(ty, 1, FIELD.width - 1);
  }
  const it = seek(p, p.ai.tx, p.ai.ty, 0);
  if (it.mx === 0 && it.my === 0) {
    // Arrivato: forza una nuova scelta al prossimo tick, intanto avanza.
    p.ai.think = 0;
    return { mx: dir, my: 0, sprint: false };
  }
  it.sprint = !pressured && p.stamina > 0.35 && opp.d > 3;
  return it;
}

// --- Senza palla, la mia squadra attacca ----------------------------------------------

function baseSpot(s: MatchState, p: PlayerState): [number, number] {
  const dir = attackDir(p.team);
  const b = s.ball;
  const W = FIELD.width;
  let x: number;
  let y: number;
  switch (slotOf(p)) {
    case 'def':
      x = b.x - dir * 8;
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
  return [clamp(x, 2, FIELD.length - 2), clamp(y, 1.5, W - 1.5)];
}

const OFFSETS: [number, number][] = [
  [0, 0],
  [2.5, 0],
  [-2.5, 0],
  [0, 2.5],
  [0, -2.5],
  [2, 2],
  [2, -2],
];

/** Smarcamento: spazio libero e linea di passaggio pulita verso chi ha palla. */
function support(s: MatchState, p: PlayerState): Intent {
  const near = dist(p.x, p.y, p.ai.tx, p.ai.ty) < 0.8;
  if (thinkDue(s, p, 0.35) || near) {
    const [bx, by] = baseSpot(s, p);
    const dir = attackDir(p.team);
    const c = s.ball.owner >= 0 ? s.players[s.ball.owner] : null;
    let best = -Infinity;
    let btx = bx;
    let bty = by;
    for (const [ox, oy] of OFFSETS) {
      const x = clamp(bx + ox, 1.5, FIELD.length - 1.5);
      const y = clamp(by + oy, 1.2, FIELD.width - 1.2);
      let v = openness(s, p.team, x, y) * 0.8 + (x - bx) * dir * 0.12 - dist(bx, by, x, y) * 0.15;
      if (c && !laneClear(s, p.team, c.x, c.y, x, y, 0.9)) v -= 2;
      // Non restare dove sono: muoversi per chiedere palla.
      if (dist(p.x, p.y, x, y) < 1) v -= 1.2;
      for (const q of s.players) if (q.team === p.team && q.idx !== p.idx && dist(q.x, q.y, x, y) < 3) v -= 1.5;
      v += nextRandom(s) * 0.3;
      if (v > best) {
        best = v;
        btx = x;
        bty = y;
      }
    }
    p.ai.tx = btx;
    p.ai.ty = bty;
    p.ai.think = Math.max(p.ai.think, 0.3);
  }
  return seek(p, p.ai.tx, p.ai.ty, 5);
}

// --- Palla vagante / ricezione ---------------------------------------------------------

function predictBall(s: MatchState, t: number): [number, number] {
  const b = s.ball;
  return [clamp(b.x + b.vx * t, 0.5, FIELD.length - 0.5), clamp(b.y + b.vy * t, 0.5, FIELD.width - 0.5)];
}

/** Il passaggio è per me: vado incontro alla palla. */
function receive(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy) + 0.1;
  const [tx, ty] = predictBall(s, Math.min(0.5, d / sp));
  return seek(p, tx, ty, 3);
}

/** Inseguo la palla vagante se sono il più vicino della squadra (gli umani contano). */
function isChaser(s: MatchState, p: PlayerState): boolean {
  const [px, py] = predictBall(s, 0.3);
  const myD = dist(p.x, p.y, px, py);
  for (const q of s.players) {
    if (q.team !== p.team || q.idx === p.idx || q.role === 'gk') continue;
    const qd = dist(q.x, q.y, px, py);
    if (qd < myD || (qd === myD && q.idx < p.idx)) return false;
  }
  return true;
}

function chase(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const d = dist(p.x, p.y, b.x, b.y);
  const [tx, ty] = predictBall(s, Math.min(0.5, d / 8));
  return seek(p, tx, ty, 1.5);
}

// --- Difesa -------------------------------------------------------------------------------

function defend(s: MatchState, p: PlayerState): Intent {
  const b = s.ball;
  const team = p.team;
  const gx = ownGoalX(team);
  const c = b.owner >= 0 ? s.players[b.owner] : null;

  // Chi va sul portatore: il difensore CPU più vicino alla palla.
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

  if (presser === p && c) {
    const [gdx, gdy] = norm(gx - c.x, CENTER_Y - c.y);
    // Se ci sta già un umano, copre lo spazio alle sue spalle invece di raddoppiare.
    const back = humanD < pd - 0.5 ? 3 : 0.9;
    const tx = c.x + c.vx * 0.25 + gdx * back;
    const ty = c.y + c.vy * 0.25 + gdy * back;
    const d = dist(p.x, p.y, c.x, c.y);
    if (back < 2 && c.role !== 'gk' && thinkDue(s, p, 0.18)) {
      const [rx, ry] = norm(p.x - c.x, p.y - c.y);
      const front = rx * c.fx + ry * c.fy;
      if (d < 1.5 && p.tackleCd <= 0 && chance(s, 0.3 + p.stats.defense * 0.003 + (front > 0.3 ? 0.1 : 0))) {
        startTackle(s, p);
        return STAND;
      }
      // Scivolata con moderazione: solo se l'attaccante sta scappando ed è vicino.
      if (d > 1.6 && d < 3 && p.slideCd <= 0 && front < 0 && chance(s, 0.05)) {
        startSlide(s, p);
        return STAND;
      }
    }
    return seek(p, tx, ty, 2.5);
  }

  // Marcatura: ognuno prende l'attaccante libero più vicino (ordine stabile per indice).
  const attackers = s.players.filter((q) => q.team !== team && q.role === 'field' && q.idx !== b.owner);
  const markers = s.players.filter((q) => q.team === team && q.role === 'field' && q !== presser && !q.human);
  const taken = new Set<number>();
  let mark: PlayerState | null = null;
  for (const m of markers) {
    let best: PlayerState | null = null;
    let bd = Infinity;
    for (const a of attackers) {
      if (taken.has(a.idx)) continue;
      const d = dist(m.x, m.y, a.x, a.y) + Math.abs(a.x - gx) * 0.15;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    if (best) taken.add(best.idx);
    if (m === p) {
      mark = best;
      break;
    }
  }
  if (mark) {
    const [gdx, gdy] = norm(gx - mark.x, CENTER_Y - mark.y);
    let tx = mark.x + gdx * 1.6;
    let ty = mark.y + gdy * 1.6;
    if (c) {
      // Un po' sulla linea di passaggio dal portatore.
      tx = tx * 0.8 + ((c.x + mark.x) / 2) * 0.2;
      ty = ty * 0.8 + ((c.y + mark.y) / 2) * 0.2;
    }
    return seek(p, tx, ty, 3.5);
  }
  // Nessuno da marcare: copre davanti alla porta, verso il lato della palla.
  return seek(p, gx + attackDir(team) * 6, CENTER_Y + (b.y - CENTER_Y) * 0.4, 4);
}
